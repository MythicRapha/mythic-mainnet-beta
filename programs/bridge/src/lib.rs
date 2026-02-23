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
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token;
use thiserror::Error;

declare_id!("oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ");

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CHALLENGE_PERIOD: i64 = 604_800; // 7 days in seconds
const BRIDGE_CONFIG_SEED: &[u8] = b"bridge_config";
const VAULT_SEED: &[u8] = b"vault";
const SOL_VAULT_SEED: &[u8] = b"sol_vault";
const WITHDRAWAL_SEED: &[u8] = b"withdrawal";

// ── Instruction Discriminators ───────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_DEPOSIT: u8 = 1;
const IX_DEPOSIT_SOL: u8 = 2;
const IX_INITIATE_WITHDRAWAL: u8 = 3;
const IX_CHALLENGE_WITHDRAWAL: u8 = 4;
const IX_FINALIZE_WITHDRAWAL: u8 = 5;
const IX_UPDATE_CONFIG: u8 = 6;
const IX_PAUSE_BRIDGE: u8 = 7;
const IX_UNPAUSE_BRIDGE: u8 = 8;
const IX_SET_LIMITS: u8 = 9;

// ── Error Codes ──────────────────────────────────────────────────────────────

#[derive(Error, Debug, Clone)]
pub enum BridgeError {
    #[error("Account is not initialized")]
    UninitializedAccount,
    #[error("Account is already initialized")]
    AlreadyInitialized,
    #[error("Invalid authority")]
    InvalidAuthority,
    #[error("Invalid sequencer")]
    InvalidSequencer,
    #[error("Challenge period is still active")]
    ChallengePeriodActive,
    #[error("Challenge period has expired")]
    ChallengePeriodExpired,
    #[error("Withdrawal already finalized")]
    WithdrawalAlreadyFinalized,
    #[error("Insufficient funds")]
    InsufficientFunds,
    #[error("Invalid merkle proof")]
    InvalidMerkleProof,
    #[error("Invalid nonce")]
    InvalidNonce,
}

impl From<BridgeError> for ProgramError {
    fn from(e: BridgeError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// Custom error codes for bridge operations
pub const ERROR_BRIDGE_PAUSED: u32 = 100;
pub const ERROR_AMOUNT_TOO_LOW: u32 = 101;
pub const ERROR_AMOUNT_TOO_HIGH: u32 = 102;
pub const ERROR_DAILY_LIMIT: u32 = 103;
pub const ERROR_OVERFLOW: u32 = 104;

// ── State ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct BridgeConfig {
    pub admin: Pubkey,
    pub sequencer: Pubkey,
    pub challenge_period: i64,
    pub deposit_nonce: u64,
    pub is_initialized: bool,
    pub bump: u8,
    pub paused: bool,
    pub min_deposit_lamports: u64,
    pub max_deposit_lamports: u64,
    pub daily_limit_lamports: u64,
    pub daily_volume: u64,
    pub last_reset_slot: u64,
}

impl BridgeConfig {
    // 32 + 32 + 8 + 8 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 8 = 123
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 8;
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub enum WithdrawalStatus {
    Pending,
    Challenged,
    Finalized,
    Cancelled,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WithdrawalRequest {
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub merkle_proof: [u8; 32],
    pub challenge_deadline: i64,
    pub status: WithdrawalStatus,
    pub nonce: u64,
    pub bump: u8,
}

impl WithdrawalRequest {
    pub const LEN: usize = 32 + 8 + 32 + 32 + 8 + 1 + 8 + 1; // 122
}

// ── Instruction Payloads ─────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeParams {
    pub sequencer: Pubkey,
    pub challenge_period: i64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DepositParams {
    pub amount: u64,
    pub l2_recipient: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DepositSOLParams {
    pub amount: u64,
    pub l2_recipient: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitiateWithdrawalParams {
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub merkle_proof: [u8; 32],
    pub nonce: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ChallengeWithdrawalParams {
    pub withdrawal_nonce: u64,
    pub fraud_proof: Vec<u8>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct FinalizeWithdrawalParams {
    pub withdrawal_nonce: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateConfigParams {
    pub new_sequencer: Option<Pubkey>,
    pub new_challenge_period: Option<i64>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SetLimitsParams {
    pub min_deposit_lamports: u64,
    pub max_deposit_lamports: u64,
    pub daily_limit_lamports: u64,
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
        IX_DEPOSIT => process_deposit(program_id, accounts, data),
        IX_DEPOSIT_SOL => process_deposit_sol(program_id, accounts, data),
        IX_INITIATE_WITHDRAWAL => process_initiate_withdrawal(program_id, accounts, data),
        IX_CHALLENGE_WITHDRAWAL => process_challenge_withdrawal(program_id, accounts, data),
        IX_FINALIZE_WITHDRAWAL => process_finalize_withdrawal(program_id, accounts, data),
        IX_UPDATE_CONFIG => process_update_config(program_id, accounts, data),
        IX_PAUSE_BRIDGE => process_pause_bridge(program_id, accounts),
        IX_UNPAUSE_BRIDGE => process_unpause_bridge(program_id, accounts),
        IX_SET_LIMITS => process_set_limits(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── Initialize ───────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] admin (payer)
//   1. [writable] bridge_config PDA
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
        Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Guard against double-init
    if !config_account.data_is_empty() {
        return Err(BridgeError::AlreadyInitialized.into());
    }

    let rent = Rent::get()?;
    let space = BridgeConfig::LEN;
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
        &[&[BRIDGE_CONFIG_SEED, &[bump]]],
    )?;

    let challenge_period = if params.challenge_period > 0 {
        params.challenge_period
    } else {
        DEFAULT_CHALLENGE_PERIOD
    };

    let config = BridgeConfig {
        admin: *admin.key,
        sequencer: params.sequencer,
        challenge_period,
        deposit_nonce: 0,
        is_initialized: true,
        bump,
        paused: false,
        min_deposit_lamports: 10_000_000,           // 0.01 SOL
        max_deposit_lamports: 1_000_000_000_000,     // 1000 SOL
        daily_limit_lamports: 10_000_000_000_000,    // 10,000 SOL
        daily_volume: 0,
        last_reset_slot: 0,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:Initialize:{{\"admin\":\"{}\",\"sequencer\":\"{}\",\"challenge_period\":{}}}", admin.key, params.sequencer, challenge_period);
    Ok(())
}

// ── Deposit (SPL Token) ─────────────────────────────────────────────────────
// Accounts:
//   0. [signer] depositor
//   1. [writable] depositor token account (ATA for mint)
//   2. [writable] vault token account (PDA-owned ATA)
//   3. [] token mint
//   4. [writable] bridge_config PDA
//   5. [] token_program
//   6. [] system_program (for vault init if needed)

fn process_deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let depositor = next_account_info(accounts_iter)?;
    let depositor_token = next_account_info(accounts_iter)?;
    let vault_token = next_account_info(accounts_iter)?;
    let token_mint = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;

    if !depositor.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !depositor_token.is_writable || !vault_token.is_writable || !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = DepositParams::try_from_slice(data)?;
    if params.amount == 0 {
        return Err(BridgeError::InsufficientFunds.into());
    }

    // Validate config PDA
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    // Verify account ownership
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if config.paused {
        return Err(ProgramError::Custom(ERROR_BRIDGE_PAUSED));
    }

    // Validate vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[VAULT_SEED, token_mint.key.as_ref()], program_id);
    if vault_pda != *vault_token.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Validate token_program is the SPL Token program
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Transfer tokens from depositor to vault
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            depositor_token.key,
            vault_token.key,
            depositor.key,
            &[],
            params.amount,
        )?,
        &[
            depositor_token.clone(),
            vault_token.clone(),
            depositor.clone(),
            token_program.clone(),
        ],
    )?;

    let nonce = config.deposit_nonce;
    config.deposit_nonce = nonce.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    let l2_hex = hex_encode(&params.l2_recipient);
    msg!(
        "EVENT:Deposit:{{\"depositor\":\"{}\",\"l2_recipient\":\"{}\",\"amount\":{},\"token_mint\":\"{}\",\"nonce\":{}}}",
        depositor.key, l2_hex, params.amount, token_mint.key, nonce
    );

    Ok(())
}

// ── Deposit SOL ──────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] depositor
//   1. [writable] sol_vault PDA
//   2. [writable] bridge_config PDA
//   3. [] system_program

fn process_deposit_sol(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let depositor = next_account_info(accounts_iter)?;
    let sol_vault = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !depositor.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !depositor.is_writable || !sol_vault.is_writable || !config_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = DepositSOLParams::try_from_slice(data)?;
    if params.amount == 0 {
        return Err(BridgeError::InsufficientFunds.into());
    }

    // Validate config PDA
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if config.paused {
        return Err(ProgramError::Custom(ERROR_BRIDGE_PAUSED));
    }

    // Check deposit limits
    let clock = Clock::get()?;
    let current_slot = clock.slot;
    if params.amount < config.min_deposit_lamports {
        return Err(ProgramError::Custom(ERROR_AMOUNT_TOO_LOW));
    }
    if params.amount > config.max_deposit_lamports {
        return Err(ProgramError::Custom(ERROR_AMOUNT_TOO_HIGH));
    }
    // Reset daily volume if >216000 slots have passed (~24hrs at 400ms/slot)
    if current_slot.saturating_sub(config.last_reset_slot) > 216_000 {
        config.daily_volume = 0;
        config.last_reset_slot = current_slot;
    }
    config.daily_volume = config.daily_volume
        .checked_add(params.amount)
        .ok_or(ProgramError::Custom(ERROR_OVERFLOW))?;
    if config.daily_volume > config.daily_limit_lamports {
        return Err(ProgramError::Custom(ERROR_DAILY_LIMIT));
    }

    // Validate SOL vault PDA
    let (vault_pda, _) = Pubkey::find_program_address(&[SOL_VAULT_SEED], program_id);
    if vault_pda != *sol_vault.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Transfer SOL via system program
    invoke(
        &system_instruction::transfer(depositor.key, sol_vault.key, params.amount),
        &[depositor.clone(), sol_vault.clone(), system_program.clone()],
    )?;

    let nonce = config.deposit_nonce;
    config.deposit_nonce = nonce.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    let l2_hex = hex_encode(&params.l2_recipient);
    msg!(
        "EVENT:DepositSOL:{{\"depositor\":\"{}\",\"l2_recipient\":\"{}\",\"amount\":{},\"nonce\":{}}}",
        depositor.key, l2_hex, params.amount, nonce
    );

    Ok(())
}

// ── Initiate Withdrawal ──────────────────────────────────────────────────────
// Accounts:
//   0. [signer] sequencer
//   1. [signer, writable] payer
//   2. [writable] withdrawal_request PDA
//   3. [] bridge_config PDA
//   4. [] system_program
//   5. [] clock sysvar (optional — we use Sysvar::get)

fn process_initiate_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let sequencer = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let withdrawal_account = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !sequencer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !payer.is_signer || !payer.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !withdrawal_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = InitiateWithdrawalParams::try_from_slice(data)?;

    // Validate config
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if *sequencer.key != config.sequencer {
        return Err(BridgeError::InvalidSequencer.into());
    }

    // Derive withdrawal PDA
    let nonce_bytes = params.nonce.to_le_bytes();
    let (withdrawal_pda, bump) =
        Pubkey::find_program_address(&[WITHDRAWAL_SEED, &nonce_bytes], program_id);
    if withdrawal_pda != *withdrawal_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    if !withdrawal_account.data_is_empty() {
        return Err(BridgeError::InvalidNonce.into());
    }

    let clock = Clock::get()?;
    let challenge_deadline = clock
        .unix_timestamp
        .checked_add(config.challenge_period)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let rent = Rent::get()?;
    let space = WithdrawalRequest::LEN;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            withdrawal_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            payer.clone(),
            withdrawal_account.clone(),
            system_program.clone(),
        ],
        &[&[WITHDRAWAL_SEED, &nonce_bytes, &[bump]]],
    )?;

    let withdrawal = WithdrawalRequest {
        recipient: params.recipient,
        amount: params.amount,
        token_mint: params.token_mint,
        merkle_proof: params.merkle_proof,
        challenge_deadline,
        status: WithdrawalStatus::Pending,
        nonce: params.nonce,
        bump,
    };

    withdrawal.serialize(&mut &mut withdrawal_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:InitiateWithdrawal:{{\"recipient\":\"{}\",\"amount\":{},\"token_mint\":\"{}\",\"nonce\":{},\"challenge_deadline\":{}}}",
        params.recipient, params.amount, params.token_mint, params.nonce, challenge_deadline
    );

    Ok(())
}

// ── Challenge Withdrawal ─────────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] challenger (posts bond)
//   1. [writable] withdrawal_request PDA
//   2. [] bridge_config PDA
//   3. [] system_program

fn process_challenge_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let challenger = next_account_info(accounts_iter)?;
    let withdrawal_account = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let _system_program = next_account_info(accounts_iter)?;

    if !challenger.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !challenger.is_writable || !withdrawal_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = ChallengeWithdrawalParams::try_from_slice(data)?;

    // Validate config
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }

    // Validate withdrawal PDA
    let nonce_bytes = params.withdrawal_nonce.to_le_bytes();
    let (withdrawal_pda, _) =
        Pubkey::find_program_address(&[WITHDRAWAL_SEED, &nonce_bytes], program_id);
    if withdrawal_pda != *withdrawal_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if withdrawal_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut withdrawal =
        WithdrawalRequest::try_from_slice(&withdrawal_account.data.borrow())?;

    if withdrawal.status != WithdrawalStatus::Pending {
        return Err(BridgeError::WithdrawalAlreadyFinalized.into());
    }

    let clock = Clock::get()?;
    if clock.unix_timestamp >= withdrawal.challenge_deadline {
        return Err(BridgeError::ChallengePeriodExpired.into());
    }

    // Accept the challenge — in production, verify fraud_proof and require bond
    if params.fraud_proof.is_empty() {
        return Err(BridgeError::InvalidMerkleProof.into());
    }

    withdrawal.status = WithdrawalStatus::Challenged;
    withdrawal.serialize(&mut &mut withdrawal_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ChallengeWithdrawal:{{\"challenger\":\"{}\",\"nonce\":{},\"fraud_proof_len\":{}}}",
        challenger.key, params.withdrawal_nonce, params.fraud_proof.len()
    );

    Ok(())
}

// ── Finalize Withdrawal ──────────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] payer / anyone can finalize
//   1. [writable] withdrawal_request PDA
//   2. [writable] vault token account (PDA-owned)
//   3. [writable] recipient token account
//   4. [] token mint
//   5. [] bridge_config PDA
//   6. [] vault_authority PDA (= vault PDA itself, signer via invoke_signed)
//   7. [] token_program

fn process_finalize_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let payer = next_account_info(accounts_iter)?;
    let withdrawal_account = next_account_info(accounts_iter)?;
    let vault_token = next_account_info(accounts_iter)?;
    let recipient_token = next_account_info(accounts_iter)?;
    let token_mint = next_account_info(accounts_iter)?;
    let config_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !withdrawal_account.is_writable || !vault_token.is_writable || !recipient_token.is_writable
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let params = FinalizeWithdrawalParams::try_from_slice(data)?;

    // Validate config
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if config.paused {
        return Err(ProgramError::Custom(ERROR_BRIDGE_PAUSED));
    }

    // Validate token_program
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Validate withdrawal PDA
    let nonce_bytes = params.withdrawal_nonce.to_le_bytes();
    let (withdrawal_pda, _) =
        Pubkey::find_program_address(&[WITHDRAWAL_SEED, &nonce_bytes], program_id);
    if withdrawal_pda != *withdrawal_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if withdrawal_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut withdrawal =
        WithdrawalRequest::try_from_slice(&withdrawal_account.data.borrow())?;

    if withdrawal.status != WithdrawalStatus::Pending {
        return Err(BridgeError::WithdrawalAlreadyFinalized.into());
    }

    // Validate withdrawal amount > 0
    if withdrawal.amount == 0 {
        return Err(BridgeError::InsufficientFunds.into());
    }

    // Validate the token_mint matches the withdrawal request
    if *token_mint.key != withdrawal.token_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    let clock = Clock::get()?;
    if clock.unix_timestamp < withdrawal.challenge_deadline {
        return Err(BridgeError::ChallengePeriodActive.into());
    }

    // Validate vault PDA and transfer tokens to recipient
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[VAULT_SEED, token_mint.key.as_ref()], program_id);
    if vault_pda != *vault_token.key {
        return Err(ProgramError::InvalidSeeds);
    }

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            vault_token.key,
            recipient_token.key,
            &vault_pda,
            &[],
            withdrawal.amount,
        )?,
        &[
            vault_token.clone(),
            recipient_token.clone(),
            vault_token.clone(), // vault PDA is the authority
            token_program.clone(),
        ],
        &[&[VAULT_SEED, token_mint.key.as_ref(), &[vault_bump]]],
    )?;

    withdrawal.status = WithdrawalStatus::Finalized;
    withdrawal.serialize(&mut &mut withdrawal_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:FinalizeWithdrawal:{{\"recipient\":\"{}\",\"amount\":{},\"token_mint\":\"{}\",\"nonce\":{}}}",
        withdrawal.recipient, withdrawal.amount, withdrawal.token_mint, withdrawal.nonce
    );

    Ok(())
}

// ── Update Config ────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] bridge_config PDA

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

    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeError::InvalidAuthority.into());
    }

    let params = UpdateConfigParams::try_from_slice(data)?;

    if let Some(new_seq) = params.new_sequencer {
        config.sequencer = new_seq;
    }
    if let Some(new_period) = params.new_challenge_period {
        if new_period < 3600 {
            return Err(ProgramError::InvalidArgument);
        }
        config.challenge_period = new_period;
    }

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:UpdateConfig:{{\"sequencer\":\"{}\",\"challenge_period\":{}}}",
        config.sequencer, config.challenge_period
    );

    Ok(())
}

// ── Pause Bridge ─────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] bridge_config PDA

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

    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeError::InvalidAuthority.into());
    }

    config.paused = true;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:PauseBridge:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ── Unpause Bridge ───────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] bridge_config PDA

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

    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeError::InvalidAuthority.into());
    }

    config.paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:UnpauseBridge:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ── Set Limits ───────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] admin
//   1. [writable] bridge_config PDA

fn process_set_limits(
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

    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], program_id);
    if config_pda != *config_account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut config = BridgeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(BridgeError::UninitializedAccount.into());
    }
    if *admin.key != config.admin {
        return Err(BridgeError::InvalidAuthority.into());
    }

    let params = SetLimitsParams::try_from_slice(data)?;

    config.min_deposit_lamports = params.min_deposit_lamports;
    config.max_deposit_lamports = params.max_deposit_lamports;
    config.daily_limit_lamports = params.daily_limit_lamports;

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:SetLimits:{{\"min_deposit\":{},\"max_deposit\":{},\"daily_limit\":{}}}",
        params.min_deposit_lamports, params.max_deposit_lamports, params.daily_limit_lamports
    );

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
