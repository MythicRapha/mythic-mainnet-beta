use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    declare_id,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token;
use thiserror::Error;

declare_id!("3HsETxbcFZ5DnGiLWy3fEvpwQFzb2ThqLXY1eWQjjMLS");

// ── Constants ────────────────────────────────────────────────────────────────

const L2_BRIDGE_CONFIG_SEED: &[u8] = b"l2_bridge_config";
const WRAPPED_MINT_SEED: &[u8] = b"wrapped_mint";
const PROCESSED_SEED: &[u8] = b"processed";

// ── Instruction Discriminators ───────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_REGISTER_WRAPPED_TOKEN: u8 = 1;
const IX_MINT_WRAPPED: u8 = 2;
const IX_BURN_WRAPPED: u8 = 3;
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
    #[error("Token not registered")]
    TokenNotRegistered,
    #[error("Insufficient balance")]
    InsufficientBalance,
    #[error("Invalid mint")]
    InvalidMint,
}

impl From<BridgeL2Error> for ProgramError {
    fn from(e: BridgeL2Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// Custom error codes for bridge operations
pub const ERROR_BRIDGE_PAUSED: u32 = 100;
pub const ERROR_AMOUNT_TOO_LOW: u32 = 101;
pub const ERROR_AMOUNT_TOO_HIGH: u32 = 102;

// ── State ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct L2BridgeConfig {
    pub admin: Pubkey,
    pub relayer: Pubkey,
    pub burn_nonce: u64,
    pub is_initialized: bool,
    pub bump: u8,
    pub paused: bool,
}

impl L2BridgeConfig {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 1 + 1; // 75
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WrappedTokenInfo {
    pub l1_mint: Pubkey,
    pub l2_mint: Pubkey,
    pub is_active: bool,
    pub bump: u8,
}

impl WrappedTokenInfo {
    pub const LEN: usize = 32 + 32 + 1 + 1; // 66
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
pub struct RegisterWrappedTokenParams {
    pub l1_mint: Pubkey,
    pub decimals: u8,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct MintWrappedParams {
    pub l1_deposit_nonce: u64,
    pub recipient: Pubkey,
    pub amount: u64,
    pub l1_mint: Pubkey,
    pub l1_tx_signature: [u8; 64],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BurnWrappedParams {
    pub amount: u64,
    pub l1_recipient: [u8; 32],
    pub l1_mint: Pubkey,
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
        IX_REGISTER_WRAPPED_TOKEN => process_register_wrapped_token(program_id, accounts, data),
        IX_MINT_WRAPPED => process_mint_wrapped(program_id, accounts, data),
        IX_BURN_WRAPPED => process_burn_wrapped(program_id, accounts, data),
        IX_UPDATE_CONFIG => process_update_config(program_id, accounts, data),
        IX_PAUSE_BRIDGE => process_pause_bridge(program_id, accounts),
        IX_UNPAUSE_BRIDGE => process_unpause_bridge(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── Initialize ───────────────────────────────────────────────────────────────
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
    let system_program = next_account_info(accounts_iter)?;

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
        &[admin.clone(), config_account.clone(), system_program.clone()],
        &[&[L2_BRIDGE_CONFIG_SEED, &[bump]]],
    )?;

    let config = L2BridgeConfig {
        admin: *admin.key,
        relayer: params.relayer,
        burn_nonce: 0,
        is_initialized: true,
        bump,
        paused: false,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:Initialize:{{\"admin\":\"{}\",\"relayer\":\"{}\"}}",
        admin.key,
        params.relayer
    );

    Ok(())
}

// ── Register Wrapped Token ───────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] admin (payer)
//   1. [] l2_bridge_config PDA
//   2. [writable] wrapped_token_info PDA (seeds: ["wrapped_mint", l1_mint])
//   3. [writable] l2_mint account (the SPL mint, PDA-derived)
//   4. [] token_program
//   5. [] system_program
//   6. [] rent sysvar

fn process_register_wrapped_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let admin = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let wrapped_info_account = next_account_info(accounts_iter)?;
    let l2_mint_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let rent_sysvar = next_account_info(accounts_iter)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !wrapped_info_account.is_writable || !l2_mint_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = RegisterWrappedTokenParams::try_from_slice(data)?;

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
    if *admin.key != config.admin {
        return Err(BridgeL2Error::InvalidAuthority.into());
    }

    // Validate token_program
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive wrapped_token_info PDA
    let (info_pda, info_bump) =
        Pubkey::find_program_address(&[WRAPPED_MINT_SEED, params.l1_mint.as_ref()], program_id);
    if info_pda != *wrapped_info_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !wrapped_info_account.data_is_empty() {
        return Err(BridgeL2Error::AlreadyInitialized.into());
    }

    // The l2_mint PDA uses the same seeds — its address IS the wrapped_mint PDA
    // But we need a separate actual SPL Token Mint. We use a second derivation
    // with a distinct seed for the mint account itself.
    let mint_seed: &[u8] = b"mint";
    let (l2_mint_pda, mint_bump) = Pubkey::find_program_address(
        &[mint_seed, params.l1_mint.as_ref()],
        program_id,
    );
    if l2_mint_pda != *l2_mint_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = Rent::get()?;

    // Create the SPL Token Mint account
    let mint_space = spl_token::state::Mint::LEN;
    let mint_lamports = rent.minimum_balance(mint_space);

    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            l2_mint_account.key,
            mint_lamports,
            mint_space as u64,
            &spl_token::ID,
        ),
        &[
            admin.clone(),
            l2_mint_account.clone(),
            system_program.clone(),
        ],
        &[&[mint_seed, params.l1_mint.as_ref(), &[mint_bump]]],
    )?;

    // Initialize the mint — mint authority = wrapped_info PDA (the bridge controls it)
    invoke(
        &spl_token::instruction::initialize_mint(
            &spl_token::ID,
            l2_mint_account.key,
            &info_pda, // mint authority = the wrapped_info PDA
            Some(&info_pda), // freeze authority
            params.decimals,
        )?,
        &[
            l2_mint_account.clone(),
            rent_sysvar.clone(),
            token_program.clone(),
        ],
    )?;

    // Create wrapped_token_info PDA
    let info_space = WrappedTokenInfo::LEN;
    let info_lamports = rent.minimum_balance(info_space);

    invoke_signed(
        &system_instruction::create_account(
            admin.key,
            wrapped_info_account.key,
            info_lamports,
            info_space as u64,
            program_id,
        ),
        &[
            admin.clone(),
            wrapped_info_account.clone(),
            system_program.clone(),
        ],
        &[&[WRAPPED_MINT_SEED, params.l1_mint.as_ref(), &[info_bump]]],
    )?;

    let info = WrappedTokenInfo {
        l1_mint: params.l1_mint,
        l2_mint: l2_mint_pda,
        is_active: true,
        bump: info_bump,
    };

    info.serialize(&mut &mut wrapped_info_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:RegisterWrappedToken:{{\"l1_mint\":\"{}\",\"l2_mint\":\"{}\",\"decimals\":{}}}",
        params.l1_mint,
        l2_mint_pda,
        params.decimals
    );

    Ok(())
}

// ── Mint Wrapped ─────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] relayer
//   1. [signer, writable] payer
//   2. [] l2_bridge_config PDA
//   3. [] wrapped_token_info PDA
//   4. [writable] l2_mint account
//   5. [writable] recipient token account (ATA)
//   6. [writable] processed_deposit PDA
//   7. [] token_program
//   8. [] system_program

fn process_mint_wrapped(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let relayer = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let wrapped_info_account = next_account_info(accounts_iter)?;
    let l2_mint_account = next_account_info(accounts_iter)?;
    let recipient_token = next_account_info(accounts_iter)?;
    let processed_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !relayer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !payer.is_signer || !payer.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !l2_mint_account.is_writable || !recipient_token.is_writable || !processed_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = MintWrappedParams::try_from_slice(data)?;

    // Validate amount > 0
    if params.amount == 0 {
        return Err(BridgeL2Error::InsufficientBalance.into());
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
    if config.paused {
        return Err(ProgramError::Custom(ERROR_BRIDGE_PAUSED));
    }
    if *relayer.key != config.relayer {
        return Err(BridgeL2Error::InvalidRelayer.into());
    }

    // Validate token_program
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Validate wrapped_token_info
    let (info_pda, info_bump) =
        Pubkey::find_program_address(&[WRAPPED_MINT_SEED, params.l1_mint.as_ref()], program_id);
    if info_pda != *wrapped_info_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if wrapped_info_account.data_is_empty() {
        return Err(BridgeL2Error::TokenNotRegistered.into());
    }
    if wrapped_info_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let wrapped_info =
        WrappedTokenInfo::try_from_slice(&wrapped_info_account.data.borrow())?;
    if !wrapped_info.is_active {
        return Err(BridgeL2Error::TokenNotRegistered.into());
    }
    if wrapped_info.l2_mint != *l2_mint_account.key {
        return Err(BridgeL2Error::InvalidMint.into());
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

    // Mint wrapped tokens to recipient
    // The mint authority is the wrapped_info PDA
    invoke_signed(
        &spl_token::instruction::mint_to(
            &spl_token::ID,
            l2_mint_account.key,
            recipient_token.key,
            &info_pda, // mint authority
            &[],
            params.amount,
        )?,
        &[
            l2_mint_account.clone(),
            recipient_token.clone(),
            wrapped_info_account.clone(), // authority PDA
            token_program.clone(),
        ],
        &[&[WRAPPED_MINT_SEED, params.l1_mint.as_ref(), &[info_bump]]],
    )?;

    // Create processed_deposit PDA to prevent double-minting
    let rent = Rent::get()?;
    let space = ProcessedDeposit::LEN;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            processed_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            payer.clone(),
            processed_account.clone(),
            system_program.clone(),
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

    msg!(
        "EVENT:MintWrapped:{{\"recipient\":\"{}\",\"amount\":{},\"l1_mint\":\"{}\",\"l1_deposit_nonce\":{}}}",
        params.recipient, params.amount, params.l1_mint, params.l1_deposit_nonce
    );

    Ok(())
}

// ── Burn Wrapped ─────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] burner (token owner)
//   1. [writable] burner token account (ATA)
//   2. [writable] l2_mint account
//   3. [] wrapped_token_info PDA
//   4. [writable] l2_bridge_config PDA
//   5. [] token_program

fn process_burn_wrapped(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let burner = next_account_info(accounts_iter)?;
    let burner_token = next_account_info(accounts_iter)?;
    let l2_mint_account = next_account_info(accounts_iter)?;
    let wrapped_info_account = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;

    if !burner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !burner_token.is_writable || !l2_mint_account.is_writable || !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = BurnWrappedParams::try_from_slice(data)?;
    if params.amount == 0 {
        return Err(BridgeL2Error::InsufficientBalance.into());
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

    // Validate token_program
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Validate wrapped_token_info
    let (info_pda, _) =
        Pubkey::find_program_address(&[WRAPPED_MINT_SEED, params.l1_mint.as_ref()], program_id);
    if info_pda != *wrapped_info_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if wrapped_info_account.data_is_empty() {
        return Err(BridgeL2Error::TokenNotRegistered.into());
    }
    if wrapped_info_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let wrapped_info =
        WrappedTokenInfo::try_from_slice(&wrapped_info_account.data.borrow())?;
    if !wrapped_info.is_active {
        return Err(BridgeL2Error::TokenNotRegistered.into());
    }
    if wrapped_info.l2_mint != *l2_mint_account.key {
        return Err(BridgeL2Error::InvalidMint.into());
    }

    // Burn tokens from burner's account
    invoke(
        &spl_token::instruction::burn(
            &spl_token::ID,
            burner_token.key,
            l2_mint_account.key,
            burner.key,
            &[],
            params.amount,
        )?,
        &[
            burner_token.clone(),
            l2_mint_account.clone(),
            burner.clone(),
            token_program.clone(),
        ],
    )?;

    let burn_nonce = config.burn_nonce;
    config.burn_nonce = burn_nonce
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    let l1_hex = hex_encode(&params.l1_recipient);
    msg!(
        "EVENT:BurnWrapped:{{\"burner\":\"{}\",\"l1_recipient\":\"{}\",\"amount\":{},\"l1_mint\":\"{}\",\"burn_nonce\":{}}}",
        burner.key, l1_hex, params.amount, params.l1_mint, burn_nonce
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
