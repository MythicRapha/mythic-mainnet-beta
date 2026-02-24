// Mythic L2 Bridge — Native Transfer Model
//
// This bridge uses native MYTH token transfers (no SPL wrapping/minting).
// A bridge reserve PDA holds native MYTH. When users bridge from L1,
// the reserve sends native MYTH to the recipient. When users bridge to L1,
// they send native MYTH back to the reserve.
//
// Supply conservation: L1_circulating + L1_vault = L1_supply
//                      L2_circulating + L2_reserve = L2_genesis
//                      Total usable supply across both chains = 1B MYTH

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    declare_id,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use thiserror::Error;

declare_id!("5t8JwXzGQ3c7PCY6p6oJqZgFt8gff2d6uTLrqa1jFrKP");

// ── Constants ────────────────────────────────────────────────────────────────

const L2_BRIDGE_CONFIG_SEED: &[u8] = b"l2_bridge_config";
const BRIDGE_RESERVE_SEED: &[u8] = b"bridge_reserve";
const PROCESSED_SEED: &[u8] = b"processed";

/// Decimal scaling factor: L1 MYTH has 6 decimals, L2 has 9.
/// L2 amounts must be divisible by this factor when bridging back to L1.
const DECIMAL_SCALING_FACTOR: u64 = 1_000;

// ── Instruction Discriminators ───────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_FUND_RESERVE: u8 = 1;
const IX_RELEASE_BRIDGED: u8 = 2;
const IX_BRIDGE_TO_L1: u8 = 3;
const IX_UPDATE_CONFIG: u8 = 4;
const IX_PAUSE_BRIDGE: u8 = 5;
const IX_UNPAUSE_BRIDGE: u8 = 6;

// ── Error Codes ──────────────────────────────────────────────────────────────

#[derive(Error, Debug, Clone)]
pub enum BridgeL2Error {
    #[error("Account is not initialized")]
    UninitializedAccount,
    #[error("Account is already initialized")]
    AlreadyInitialized,
    #[error("Invalid relayer")]
    InvalidRelayer,
    #[error("Invalid authority")]
    InvalidAuthority,
    #[error("Deposit already processed")]
    DepositAlreadyProcessed,
    #[error("Insufficient reserve balance")]
    InsufficientReserve,
    #[error("Amount must be greater than zero")]
    ZeroAmount,
    #[error("Amount not divisible by decimal scaling factor")]
    IndivisibleAmount,
}

impl From<BridgeL2Error> for ProgramError {
    fn from(e: BridgeL2Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}

pub const ERROR_BRIDGE_PAUSED: u32 = 100;

// ── State ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct L2BridgeConfig {
    pub admin: Pubkey,
    pub relayer: Pubkey,
    pub withdraw_nonce: u64,
    pub total_released: u64,
    pub total_received: u64,
    pub is_initialized: bool,
    pub bump: u8,
    pub paused: bool,
    pub reserve_bump: u8,
}

impl L2BridgeConfig {
    // 32 + 32 + 8 + 8 + 8 + 1 + 1 + 1 + 1 = 92
    pub const LEN: usize = 92;
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ProcessedDeposit {
    pub nonce: u64,
    pub l1_tx_signature: [u8; 64],
    pub processed_at: i64,
    pub bump: u8,
}

impl ProcessedDeposit {
    pub const LEN: usize = 8 + 64 + 8 + 1; // 81
}

// ── Instruction Payloads ─────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeParams {
    pub relayer: Pubkey,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct FundReserveParams {
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ReleaseBridgedParams {
    pub l1_deposit_nonce: u64,
    pub recipient: Pubkey,
    pub amount: u64,
    pub l1_tx_signature: [u8; 64],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BridgeToL1Params {
    pub amount: u64,
    pub l1_recipient: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateConfigParams {
    pub new_relayer: Option<Pubkey>,
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let (discriminator, data) = instruction_data.split_at(1);

    match discriminator[0] {
        IX_INITIALIZE => process_initialize(program_id, accounts, data),
        IX_FUND_RESERVE => process_fund_reserve(program_id, accounts, data),
        IX_RELEASE_BRIDGED => process_release_bridged(program_id, accounts, data),
        IX_BRIDGE_TO_L1 => process_bridge_to_l1(program_id, accounts, data),
        IX_UPDATE_CONFIG => process_update_config(program_id, accounts, data),
        IX_PAUSE_BRIDGE => process_pause_bridge(program_id, accounts),
        IX_UNPAUSE_BRIDGE => process_unpause_bridge(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── Initialize ───────────────────────────────────────────────────────────────
// Creates the bridge config PDA and records the reserve PDA bump.
// Accounts:
//   0. [signer, writable] admin (payer)
//   1. [writable] l2_bridge_config PDA
//   2. [] system_program

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let admin = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let system_program_info = next_account_info(accounts_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = InitializeParams::try_from_slice(data)?;

    let (config_pda, bump) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    if !config_account.data_is_empty() {
        return Err(BridgeL2Error::AlreadyInitialized.into());
    }

    // Derive the reserve PDA bump for future invoke_signed calls
    let (_, reserve_bump) =
        Pubkey::find_program_address(&[BRIDGE_RESERVE_SEED], program_id);

    let rent = Rent::get()?;
    let space = L2BridgeConfig::LEN;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            config_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[admin.clone(), config_account.clone(), system_program_info.clone()],
        &[&[L2_BRIDGE_CONFIG_SEED, &[bump]]],
    )?;

    let config = L2BridgeConfig {
        admin: *admin.key,
        relayer: params.relayer,
        withdraw_nonce: 0,
        total_released: 0,
        total_received: 0,
        is_initialized: true,
        bump,
        paused: false,
        reserve_bump,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    let (reserve_pda, _) =
        Pubkey::find_program_address(&[BRIDGE_RESERVE_SEED], program_id);

    msg!(
        "EVENT:Initialize:{{\"admin\":\"{}\",\"relayer\":\"{}\",\"reserve\":\"{}\"}}",
        admin.key,
        params.relayer,
        reserve_pda
    );

    Ok(())
}

// ── Fund Reserve ─────────────────────────────────────────────────────────────
// Anyone can send native MYTH to the bridge reserve PDA.
// The Foundation should call this to seed the reserve with genesis MYTH.
// Accounts:
//   0. [signer, writable] funder
//   1. [writable] bridge_reserve PDA
//   2. [] l2_bridge_config PDA (for pause check)
//   3. [] system_program

fn process_fund_reserve(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let funder = next_account_info(accounts_iter)?;
    let reserve_account = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let system_program_info = next_account_info(accounts_iter)?;

    if !funder.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !funder.is_writable || !reserve_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = FundReserveParams::try_from_slice(data)?;
    if params.amount == 0 {
        return Err(BridgeL2Error::ZeroAmount.into());
    }

    // Validate config
    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let config = L2BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeL2Error::UninitializedAccount.into());
    }

    // Validate reserve PDA
    let (reserve_pda, _) =
        Pubkey::find_program_address(&[BRIDGE_RESERVE_SEED], program_id);
    if reserve_pda != *reserve_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Transfer native tokens from funder to reserve
    solana_program::program::invoke(
        &system_instruction::transfer(funder.key, reserve_account.key, params.amount),
        &[funder.clone(), reserve_account.clone(), system_program_info.clone()],
    )?;

    msg!(
        "EVENT:FundReserve:{{\"funder\":\"{}\",\"amount\":{},\"reserve_balance\":{}}}",
        funder.key,
        params.amount,
        reserve_account.lamports()
    );

    Ok(())
}

// ── Release Bridged ──────────────────────────────────────────────────────────
// Relayer-only: transfers native MYTH from the bridge reserve PDA to a
// recipient when an L1 deposit has been confirmed.
// Accounts:
//   0. [signer] relayer
//   1. [signer, writable] payer (for processed_deposit PDA rent)
//   2. [] l2_bridge_config PDA
//   3. [writable] bridge_reserve PDA
//   4. [writable] recipient
//   5. [writable] processed_deposit PDA
//   6. [] system_program

fn process_release_bridged(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let relayer = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let reserve_account = next_account_info(accounts_iter)?;
    let recipient = next_account_info(accounts_iter)?;
    let processed_account = next_account_info(accounts_iter)?;
    let system_program_info = next_account_info(accounts_iter)?;

    if !relayer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !payer.is_signer || !payer.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !reserve_account.is_writable || !recipient.is_writable || !processed_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = ReleaseBridgedParams::try_from_slice(data)?;

    if params.amount == 0 {
        return Err(BridgeL2Error::ZeroAmount.into());
    }

    // Validate config
    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let mut config = L2BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeL2Error::UninitializedAccount.into());
    }
    if config.paused {
        return Err(ProgramError::Custom(ERROR_BRIDGE_PAUSED));
    }
    if *relayer.key != config.relayer {
        return Err(BridgeL2Error::InvalidRelayer.into());
    }

    // Validate recipient matches params
    if *recipient.key != params.recipient {
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate reserve PDA
    let (reserve_pda, reserve_bump) =
        Pubkey::find_program_address(&[BRIDGE_RESERVE_SEED], program_id);
    if reserve_pda != *reserve_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Ensure reserve has sufficient balance (leave rent-exempt minimum)
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(0);
    let available = reserve_account
        .lamports()
        .saturating_sub(min_balance);
    if params.amount > available {
        return Err(BridgeL2Error::InsufficientReserve.into());
    }

    // Ensure this deposit nonce hasn't been processed yet
    let nonce_bytes = params.l1_deposit_nonce.to_le_bytes();
    let (processed_pda, processed_bump) =
        Pubkey::find_program_address(&[PROCESSED_SEED, &nonce_bytes], program_id);
    if processed_pda != *processed_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !processed_account.data_is_empty() {
        return Err(BridgeL2Error::DepositAlreadyProcessed.into());
    }

    // Transfer native MYTH from reserve PDA to recipient
    invoke_signed(
        &system_instruction::transfer(reserve_account.key, recipient.key, params.amount),
        &[
            reserve_account.clone(),
            recipient.clone(),
            system_program_info.clone(),
        ],
        &[&[BRIDGE_RESERVE_SEED, &[reserve_bump]]],
    )?;

    // Create processed_deposit PDA to prevent double-release
    let space = ProcessedDeposit::LEN;
    let pd_lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            processed_account.key,
            pd_lamports,
            space as u64,
            program_id,
        ),
        &[
            payer.clone(),
            processed_account.clone(),
            system_program_info.clone(),
        ],
        &[&[PROCESSED_SEED, &nonce_bytes, &[processed_bump]]],
    )?;

    let clock = Clock::get()?;
    let processed = ProcessedDeposit {
        nonce: params.l1_deposit_nonce,
        l1_tx_signature: params.l1_tx_signature,
        processed_at: clock.unix_timestamp,
        bump: processed_bump,
    };
    processed.serialize(&mut &mut processed_account.data.borrow_mut()[..])?;

    // Update accounting
    config.total_released = config
        .total_released
        .checked_add(params.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ReleaseBridged:{{\"recipient\":\"{}\",\"amount\":{},\"l1_deposit_nonce\":{},\"reserve_balance\":{}}}",
        params.recipient, params.amount, params.l1_deposit_nonce, reserve_account.lamports()
    );

    Ok(())
}

// ── Bridge To L1 ─────────────────────────────────────────────────────────────
// User sends native MYTH to the bridge reserve PDA and specifies their
// L1 wallet address. The relayer watches for this event and initiates
// a withdrawal on L1.
// Accounts:
//   0. [signer, writable] sender
//   1. [writable] bridge_reserve PDA
//   2. [writable] l2_bridge_config PDA
//   3. [] system_program

fn process_bridge_to_l1(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let sender = next_account_info(accounts_iter)?;
    let reserve_account = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let system_program_info = next_account_info(accounts_iter)?;

    if !sender.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !sender.is_writable || !reserve_account.is_writable || !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = BridgeToL1Params::try_from_slice(data)?;
    if params.amount == 0 {
        return Err(BridgeL2Error::ZeroAmount.into());
    }

    // L2→L1 amounts must be divisible by the scaling factor (1000)
    // so they map cleanly to L1's 6-decimal precision
    if params.amount % DECIMAL_SCALING_FACTOR != 0 {
        return Err(BridgeL2Error::IndivisibleAmount.into());
    }

    // Validate config
    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let mut config = L2BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeL2Error::UninitializedAccount.into());
    }
    if config.paused {
        return Err(ProgramError::Custom(ERROR_BRIDGE_PAUSED));
    }

    // Validate reserve PDA
    let (reserve_pda, _) =
        Pubkey::find_program_address(&[BRIDGE_RESERVE_SEED], program_id);
    if reserve_pda != *reserve_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Transfer native MYTH from sender to reserve
    solana_program::program::invoke(
        &system_instruction::transfer(sender.key, reserve_account.key, params.amount),
        &[sender.clone(), reserve_account.clone(), system_program_info.clone()],
    )?;

    let nonce = config.withdraw_nonce;
    config.withdraw_nonce = nonce
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    config.total_received = config
        .total_received
        .checked_add(params.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    let l1_hex = hex_encode(&params.l1_recipient);
    msg!(
        "EVENT:BridgeToL1:{{\"sender\":\"{}\",\"l1_recipient\":\"{}\",\"amount\":{},\"withdraw_nonce\":{}}}",
        sender.key, l1_hex, params.amount, nonce
    );

    Ok(())
}

// ── Update Config ────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] l2_bridge_config PDA

fn process_update_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let admin = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = L2BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeL2Error::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeL2Error::InvalidAuthority.into());
    }

    let params = UpdateConfigParams::try_from_slice(data)?;

    if let Some(new_relayer) = params.new_relayer {
        config.relayer = new_relayer;
    }

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:UpdateConfig:{{\"relayer\":\"{}\"}}",
        config.relayer
    );

    Ok(())
}

// ── Pause Bridge ─────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] l2_bridge_config PDA

fn process_pause_bridge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let admin = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = L2BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeL2Error::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeL2Error::InvalidAuthority.into());
    }

    config.paused = true;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:PauseBridge:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ── Unpause Bridge ───────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] l2_bridge_config PDA

fn process_unpause_bridge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let admin = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = L2BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeL2Error::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeL2Error::InvalidAuthority.into());
    }

    config.paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:UnpauseBridge:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}
