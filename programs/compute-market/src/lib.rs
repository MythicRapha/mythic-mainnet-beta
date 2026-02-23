//! Mythic L2 — Decentralized GPU/CPU/Storage Compute Marketplace
//!
//! Program ID: MythComp1111111111111111111111111111111111

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

solana_program::declare_id!("AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_GPU_MODEL: usize = 32;
const MAX_JOB_METADATA: usize = 1_024; // 1 KB
const MAX_PROOF_DATA: usize = 1_024; // 1 KB
const DISPUTE_WINDOW_SLOTS: u64 = 50;
const UNSTAKE_COOLDOWN_EPOCHS: u64 = 100;
const GRACE_PERIOD_HOURS: u32 = 1;
const BPS_DENOMINATOR: u64 = 10_000;

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

// ---------------------------------------------------------------------------
// Instruction Discriminators
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ComputeInstruction {
    Initialize = 0,
    RegisterProvider = 1,
    UpdateProvider = 2,
    DeactivateProvider = 3,
    WithdrawStake = 4,
    RequestCompute = 5,
    AcceptJob = 6,
    SubmitProof = 7,
    VerifyAndRelease = 8,
    DisputeLease = 9,
    ResolveDispute = 10,
    SlashProvider = 11,
}

impl TryFrom<u8> for ComputeInstruction {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(Self::Initialize),
            1 => Ok(Self::RegisterProvider),
            2 => Ok(Self::UpdateProvider),
            3 => Ok(Self::DeactivateProvider),
            4 => Ok(Self::WithdrawStake),
            5 => Ok(Self::RequestCompute),
            6 => Ok(Self::AcceptJob),
            7 => Ok(Self::SubmitProof),
            8 => Ok(Self::VerifyAndRelease),
            9 => Ok(Self::DisputeLease),
            10 => Ok(Self::ResolveDispute),
            11 => Ok(Self::SlashProvider),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

// ---------------------------------------------------------------------------
// State Accounts
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct MarketConfig {
    pub is_initialized: bool,
    pub admin: Pubkey,
    pub min_provider_stake: u64,
    pub foundation: Pubkey,
    pub protocol_fee_bps: u16,
    pub request_nonce: u64,
    pub dispute_window_slots: u64,
    pub bump: u8,
}

impl MarketConfig {
    pub const SEED: &'static [u8] = b"market_config";
    pub const LEN: usize = 1 + 32 + 8 + 32 + 2 + 8 + 8 + 1; // 92
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ProviderAccount {
    pub authority: Pubkey,
    pub gpu_model: String,
    pub vram_gb: u16,
    pub cpu_cores: u16,
    pub ram_gb: u16,
    pub storage_tb: u16,
    pub bandwidth_gbps: u16,
    pub price_per_gpu_hour: u64,
    pub price_per_cpu_hour: u64,
    pub price_per_gb_storage_month: u64,
    pub stake_amount: u64,
    pub active_leases: u32,
    pub completed_leases: u32,
    pub slashes: u32,
    pub is_active: bool,
    pub deactivation_epoch: u64,
    pub registered_at: i64,
    pub bump: u8,
}

impl ProviderAccount {
    pub const SEED: &'static [u8] = b"provider";
    // 32 + (4+32) + 2*5 + 8*3 + 8 + 4*3 + 1 + 8 + 8 + 1 = ~130
    pub const LEN: usize = 32 + (4 + MAX_GPU_MODEL) + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 4
        + 4 + 4 + 1 + 8 + 8 + 1; // 138
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq, Copy)]
#[repr(u8)]
pub enum JobType {
    Inference = 0,
    Training = 1,
    GeneralCompute = 2,
    Storage = 3,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq, Copy)]
#[repr(u8)]
pub enum RequestStatus {
    Open = 0,
    Matched = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
    Expired = 5,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ComputeRequest {
    pub requester: Pubkey,
    pub min_gpu: u16,
    pub min_vram: u16,
    pub min_cpu_cores: u16,
    pub min_ram_gb: u16,
    pub duration_hours: u32,
    pub max_price_per_hour: u64,
    pub job_type: JobType,
    pub job_metadata_hash: [u8; 32],
    pub escrowed_amount: u64,
    pub status: RequestStatus,
    pub created_at: i64,
    pub nonce: u64,
    pub bump: u8,
}

impl ComputeRequest {
    pub const SEED: &'static [u8] = b"request";
    // 32 + 2*4 + 4 + 8 + 1 + 32 + 8 + 1 + 8 + 8 + 1 = ~111
    pub const LEN: usize = 32 + 2 + 2 + 2 + 2 + 4 + 8 + 1 + 32 + 8 + 1 + 8 + 8 + 1; // 111
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq, Copy)]
#[repr(u8)]
pub enum LeaseStatus {
    Active = 0,
    ProofSubmitted = 1,
    Verified = 2,
    Disputed = 3,
    Slashed = 4,
    Completed = 5,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Lease {
    pub request: Pubkey,
    pub provider: Pubkey,
    pub requester: Pubkey,
    pub actual_price_per_hour: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub status: LeaseStatus,
    pub proof_hash: [u8; 32],
    pub proof_submitted_at: i64,
    pub bump: u8,
}

impl Lease {
    pub const SEED: &'static [u8] = b"lease";
    // 32*3 + 8 + 8 + 8 + 1 + 32 + 8 + 1 = 162
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 1 + 32 + 8 + 1; // 162
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Dispute {
    pub lease: Pubkey,
    pub requester: Pubkey,
    pub reason_hash: [u8; 32],
    pub created_at: i64,
    pub resolved: bool,
    pub provider_at_fault: bool,
    pub bump: u8,
}

impl Dispute {
    pub const SEED: &'static [u8] = b"dispute";
    pub const LEN: usize = 32 + 32 + 32 + 8 + 1 + 1 + 1; // 107
}

// ---------------------------------------------------------------------------
// Instruction Data Payloads
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub min_provider_stake: u64,
    pub foundation_wallet: Pubkey,
    pub protocol_fee_bps: u16,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RegisterProviderArgs {
    pub gpu_model: String,
    pub vram_gb: u16,
    pub cpu_cores: u16,
    pub ram_gb: u16,
    pub storage_tb: u16,
    pub bandwidth_gbps: u16,
    pub price_per_gpu_hour: u64,
    pub price_per_cpu_hour: u64,
    pub price_per_gb_storage_month: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateProviderArgs {
    pub gpu_model: Option<String>,
    pub vram_gb: Option<u16>,
    pub cpu_cores: Option<u16>,
    pub ram_gb: Option<u16>,
    pub storage_tb: Option<u16>,
    pub bandwidth_gbps: Option<u16>,
    pub price_per_gpu_hour: Option<u64>,
    pub price_per_cpu_hour: Option<u64>,
    pub price_per_gb_storage_month: Option<u64>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RequestComputeArgs {
    pub min_gpu: u16,
    pub min_vram: u16,
    pub min_cpu_cores: u16,
    pub min_ram_gb: u16,
    pub duration_hours: u32,
    pub max_price_per_hour: u64,
    pub job_type: JobType,
    pub job_metadata: Vec<u8>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SubmitProofArgs {
    pub output_hash: [u8; 32],
    pub proof_data: Vec<u8>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ResolveDisputeArgs {
    pub provider_at_fault: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum MarketError {
    #[error("Already initialized")]
    AlreadyInitialized,
    #[error("Not initialized")]
    NotInitialized,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("String too long")]
    StringTooLong,
    #[error("Invalid PDA")]
    InvalidPDA,
    #[error("Insufficient stake")]
    InsufficientStake,
    #[error("Provider not active")]
    ProviderNotActive,
    #[error("Provider still active — deactivate first")]
    ProviderStillActive,
    #[error("Cooldown not expired")]
    CooldownNotExpired,
    #[error("Job metadata too large")]
    MetadataTooLarge,
    #[error("Proof data too large")]
    ProofTooLarge,
    #[error("Invalid request status")]
    InvalidRequestStatus,
    #[error("Invalid lease status")]
    InvalidLeaseStatus,
    #[error("Provider specs insufficient")]
    SpecsInsufficient,
    #[error("Price exceeds max")]
    PriceExceedsMax,
    #[error("Dispute window expired")]
    DisputeWindowExpired,
    #[error("Dispute window still open")]
    DisputeWindowOpen,
    #[error("Lease not timed out")]
    LeaseNotTimedOut,
    #[error("Arithmetic overflow")]
    Overflow,
}

impl From<MarketError> for ProgramError {
    fn from(e: MarketError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// Entrypoint Dispatch
// ---------------------------------------------------------------------------

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&disc, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match ComputeInstruction::try_from(disc)? {
        ComputeInstruction::Initialize => process_initialize(program_id, accounts, rest),
        ComputeInstruction::RegisterProvider => {
            process_register_provider(program_id, accounts, rest)
        }
        ComputeInstruction::UpdateProvider => process_update_provider(program_id, accounts, rest),
        ComputeInstruction::DeactivateProvider => {
            process_deactivate_provider(program_id, accounts, rest)
        }
        ComputeInstruction::WithdrawStake => process_withdraw_stake(program_id, accounts, rest),
        ComputeInstruction::RequestCompute => {
            process_request_compute(program_id, accounts, rest)
        }
        ComputeInstruction::AcceptJob => process_accept_job(program_id, accounts, rest),
        ComputeInstruction::SubmitProof => process_submit_proof(program_id, accounts, rest),
        ComputeInstruction::VerifyAndRelease => {
            process_verify_and_release(program_id, accounts, rest)
        }
        ComputeInstruction::DisputeLease => process_dispute_lease(program_id, accounts, rest),
        ComputeInstruction::ResolveDispute => {
            process_resolve_dispute(program_id, accounts, rest)
        }
        ComputeInstruction::SlashProvider => process_slash_provider(program_id, accounts, rest),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(info: &AccountInfo) -> ProgramResult {
    if !info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn assert_writable(info: &AccountInfo) -> ProgramResult {
    if !info.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn assert_owned_by(info: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if info.owner != owner {
        return Err(ProgramError::IllegalOwner);
    }
    Ok(())
}

fn create_pda_account<'a>(
    payer: &AccountInfo<'a>,
    space: usize,
    owner: &Pubkey,
    system_program: &AccountInfo<'a>,
    pda: &AccountInfo<'a>,
    seeds: &[&[u8]],
) -> ProgramResult {
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(payer.key, pda.key, lamports, space as u64, owner),
        &[payer.clone(), pda.clone(), system_program.clone()],
        &[seeds],
    )
}

fn sha256(data: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn transfer_lamports_cpi<'a>(
    from: &AccountInfo<'a>,
    to: &AccountInfo<'a>,
    amount: u64,
    system_program: &AccountInfo<'a>,
) -> ProgramResult {
    invoke(
        &system_instruction::transfer(from.key, to.key, amount),
        &[from.clone(), to.clone(), system_program.clone()],
    )
}

fn transfer_lamports_signed<'a>(
    from: &AccountInfo<'a>,
    to: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}

// ---------------------------------------------------------------------------
// 0 — Initialize
// ---------------------------------------------------------------------------

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let admin = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(admin)?;
    assert_writable(config_info)?;

    let (config_pda, bump) = Pubkey::find_program_address(&[MarketConfig::SEED], program_id);
    if config_pda != *config_info.key {
        return Err(MarketError::InvalidPDA.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let seeds: &[&[u8]] = &[MarketConfig::SEED, &[bump]];
    create_pda_account(admin, MarketConfig::LEN, program_id, system_prog, config_info, seeds)?;

    let config = MarketConfig {
        is_initialized: true,
        admin: *admin.key,
        min_provider_stake: args.min_provider_stake,
        foundation: args.foundation_wallet,
        protocol_fee_bps: args.protocol_fee_bps,
        request_nonce: 0,
        dispute_window_slots: DISPUTE_WINDOW_SLOTS,
        bump,
    };

    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:MarketInitialized:{{\"admin\":\"{}\",\"min_stake\":{},\"fee_bps\":{}}}",
        admin.key,
        args.min_provider_stake,
        args.protocol_fee_bps
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 1 — RegisterProvider
// ---------------------------------------------------------------------------

fn process_register_provider(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RegisterProviderArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let stake_vault = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(provider_info)?;
    assert_owned_by(config_info, program_id)?;

    let config = MarketConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(MarketError::NotInitialized.into());
    }

    if args.gpu_model.len() > MAX_GPU_MODEL {
        return Err(MarketError::StringTooLong.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive provider PDA
    let (provider_pda, bump) = Pubkey::find_program_address(
        &[ProviderAccount::SEED, authority.key.as_ref()],
        program_id,
    );
    if provider_pda != *provider_info.key {
        return Err(MarketError::InvalidPDA.into());
    }

    // Transfer stake
    let stake = config.min_provider_stake;
    transfer_lamports_cpi(authority, stake_vault, stake, system_prog)?;

    // Create PDA
    let seeds: &[&[u8]] = &[ProviderAccount::SEED, authority.key.as_ref(), &[bump]];
    create_pda_account(
        authority,
        ProviderAccount::LEN,
        program_id,
        system_prog,
        provider_info,
        seeds,
    )?;

    let clock = Clock::get()?;
    let provider = ProviderAccount {
        authority: *authority.key,
        gpu_model: args.gpu_model.clone(),
        vram_gb: args.vram_gb,
        cpu_cores: args.cpu_cores,
        ram_gb: args.ram_gb,
        storage_tb: args.storage_tb,
        bandwidth_gbps: args.bandwidth_gbps,
        price_per_gpu_hour: args.price_per_gpu_hour,
        price_per_cpu_hour: args.price_per_cpu_hour,
        price_per_gb_storage_month: args.price_per_gb_storage_month,
        stake_amount: stake,
        active_leases: 0,
        completed_leases: 0,
        slashes: 0,
        is_active: true,
        deactivation_epoch: 0,
        registered_at: clock.unix_timestamp,
        bump,
    };

    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ProviderRegistered:{{\"authority\":\"{}\",\"gpu\":\"{}\",\"stake\":{}}}",
        authority.key,
        args.gpu_model,
        stake
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 2 — UpdateProvider
// ---------------------------------------------------------------------------

fn process_update_provider(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateProviderArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(provider_info)?;
    assert_owned_by(provider_info, program_id)?;

    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;
    if provider.authority != *authority.key {
        return Err(MarketError::Unauthorized.into());
    }

    if let Some(ref gpu) = args.gpu_model {
        if gpu.len() > MAX_GPU_MODEL {
            return Err(MarketError::StringTooLong.into());
        }
        provider.gpu_model = gpu.clone();
    }
    if let Some(v) = args.vram_gb {
        provider.vram_gb = v;
    }
    if let Some(v) = args.cpu_cores {
        provider.cpu_cores = v;
    }
    if let Some(v) = args.ram_gb {
        provider.ram_gb = v;
    }
    if let Some(v) = args.storage_tb {
        provider.storage_tb = v;
    }
    if let Some(v) = args.bandwidth_gbps {
        provider.bandwidth_gbps = v;
    }
    if let Some(v) = args.price_per_gpu_hour {
        provider.price_per_gpu_hour = v;
    }
    if let Some(v) = args.price_per_cpu_hour {
        provider.price_per_cpu_hour = v;
    }
    if let Some(v) = args.price_per_gb_storage_month {
        provider.price_per_gb_storage_month = v;
    }

    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ProviderUpdated:{{\"authority\":\"{}\"}}",
        authority.key
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 3 — DeactivateProvider
// ---------------------------------------------------------------------------

fn process_deactivate_provider(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(provider_info)?;
    assert_owned_by(provider_info, program_id)?;

    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;
    if provider.authority != *authority.key {
        return Err(MarketError::Unauthorized.into());
    }

    let clock = Clock::get()?;
    provider.is_active = false;
    provider.deactivation_epoch = clock.epoch;
    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ProviderDeactivated:{{\"authority\":\"{}\",\"epoch\":{}}}",
        authority.key,
        clock.epoch
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 4 — WithdrawStake
// ---------------------------------------------------------------------------

fn process_withdraw_stake(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;
    let stake_vault = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(provider_info)?;
    assert_writable(stake_vault)?;
    assert_owned_by(provider_info, program_id)?;

    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;
    if provider.authority != *authority.key {
        return Err(MarketError::Unauthorized.into());
    }

    if provider.is_active {
        return Err(MarketError::ProviderStillActive.into());
    }

    let clock = Clock::get()?;
    let epochs_since = clock.epoch.saturating_sub(provider.deactivation_epoch);
    if epochs_since < UNSTAKE_COOLDOWN_EPOCHS {
        return Err(MarketError::CooldownNotExpired.into());
    }

    let amount = provider.stake_amount;
    if amount == 0 {
        return Err(MarketError::InsufficientStake.into());
    }

    transfer_lamports_signed(stake_vault, authority, amount)?;

    provider.stake_amount = 0;
    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:StakeWithdrawn:{{\"authority\":\"{}\",\"amount\":{}}}",
        authority.key,
        amount
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 5 — RequestCompute
// ---------------------------------------------------------------------------

fn process_request_compute(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RequestComputeArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let requester = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let escrow_vault = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(requester)?;
    assert_writable(request_info)?;
    assert_writable(config_info)?;
    assert_owned_by(config_info, program_id)?;

    if args.job_metadata.len() > MAX_JOB_METADATA {
        return Err(MarketError::MetadataTooLarge.into());
    }

    let mut config = MarketConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(MarketError::NotInitialized.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let nonce = config.request_nonce;
    let nonce_bytes = nonce.to_le_bytes();

    let (request_pda, bump) = Pubkey::find_program_address(
        &[ComputeRequest::SEED, &nonce_bytes],
        program_id,
    );
    if request_pda != *request_info.key {
        return Err(MarketError::InvalidPDA.into());
    }

    // Calculate max escrow: max_price_per_hour * duration_hours
    let escrow_amount = args
        .max_price_per_hour
        .checked_mul(args.duration_hours as u64)
        .ok_or(MarketError::Overflow)?;

    transfer_lamports_cpi(requester, escrow_vault, escrow_amount, system_prog)?;

    let seeds: &[&[u8]] = &[ComputeRequest::SEED, &nonce_bytes, &[bump]];
    create_pda_account(
        requester,
        ComputeRequest::LEN,
        program_id,
        system_prog,
        request_info,
        seeds,
    )?;

    let clock = Clock::get()?;
    let job_metadata_hash = sha256(&args.job_metadata);

    let req = ComputeRequest {
        requester: *requester.key,
        min_gpu: args.min_gpu,
        min_vram: args.min_vram,
        min_cpu_cores: args.min_cpu_cores,
        min_ram_gb: args.min_ram_gb,
        duration_hours: args.duration_hours,
        max_price_per_hour: args.max_price_per_hour,
        job_type: args.job_type,
        job_metadata_hash,
        escrowed_amount: escrow_amount,
        status: RequestStatus::Open,
        created_at: clock.unix_timestamp,
        nonce,
        bump,
    };

    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    config.request_nonce = nonce.checked_add(1).ok_or(MarketError::Overflow)?;
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ComputeRequested:{{\"requester\":\"{}\",\"nonce\":{},\"job_type\":{},\"escrow\":{}}}",
        requester.key,
        nonce,
        args.job_type as u8,
        escrow_amount
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 6 — AcceptJob
// ---------------------------------------------------------------------------

fn process_accept_job(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let provider_authority = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let lease_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(provider_authority)?;
    assert_writable(provider_info)?;
    assert_writable(request_info)?;
    assert_writable(lease_info)?;
    assert_owned_by(provider_info, program_id)?;
    assert_owned_by(request_info, program_id)?;

    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;
    if provider.authority != *provider_authority.key {
        return Err(MarketError::Unauthorized.into());
    }
    if !provider.is_active {
        return Err(MarketError::ProviderNotActive.into());
    }

    let mut req = ComputeRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    if req.status != RequestStatus::Open {
        return Err(MarketError::InvalidRequestStatus.into());
    }

    // Check specs
    if provider.vram_gb < req.min_vram
        || provider.cpu_cores < req.min_cpu_cores
        || provider.ram_gb < req.min_ram_gb
    {
        return Err(MarketError::SpecsInsufficient.into());
    }

    if provider.price_per_gpu_hour > req.max_price_per_hour {
        return Err(MarketError::PriceExceedsMax.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive lease PDA
    let (lease_pda, bump) = Pubkey::find_program_address(
        &[Lease::SEED, request_info.key.as_ref()],
        program_id,
    );
    if lease_pda != *lease_info.key {
        return Err(MarketError::InvalidPDA.into());
    }

    let seeds: &[&[u8]] = &[Lease::SEED, request_info.key.as_ref(), &[bump]];
    create_pda_account(
        provider_authority,
        Lease::LEN,
        program_id,
        system_prog,
        lease_info,
        seeds,
    )?;

    let clock = Clock::get()?;
    let end_time = clock
        .unix_timestamp
        .checked_add((req.duration_hours as i64) * 3600)
        .ok_or(MarketError::Overflow)?;

    let lease = Lease {
        request: *request_info.key,
        provider: *provider_authority.key,
        requester: req.requester,
        actual_price_per_hour: provider.price_per_gpu_hour,
        start_time: clock.unix_timestamp,
        end_time,
        status: LeaseStatus::Active,
        proof_hash: [0u8; 32],
        proof_submitted_at: 0,
        bump,
    };

    lease.serialize(&mut &mut lease_info.try_borrow_mut_data()?[..])?;

    // Update request status
    req.status = RequestStatus::Matched;
    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    // Update provider stats
    provider.active_leases = provider
        .active_leases
        .checked_add(1)
        .ok_or(MarketError::Overflow)?;
    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:JobAccepted:{{\"provider\":\"{}\",\"request\":\"{}\",\"price_per_hour\":{}}}",
        provider_authority.key,
        request_info.key,
        provider.price_per_gpu_hour
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 7 — SubmitProof
// ---------------------------------------------------------------------------

fn process_submit_proof(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = SubmitProofArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let provider_authority = next_account_info(iter)?;
    let lease_info = next_account_info(iter)?;

    assert_signer(provider_authority)?;
    assert_writable(lease_info)?;
    assert_owned_by(lease_info, program_id)?;

    if args.proof_data.len() > MAX_PROOF_DATA {
        return Err(MarketError::ProofTooLarge.into());
    }

    let mut lease = Lease::try_from_slice(&lease_info.try_borrow_data()?)?;
    if lease.provider != *provider_authority.key {
        return Err(MarketError::Unauthorized.into());
    }
    if lease.status != LeaseStatus::Active {
        return Err(MarketError::InvalidLeaseStatus.into());
    }

    let clock = Clock::get()?;
    lease.proof_hash = args.output_hash;
    lease.proof_submitted_at = clock.unix_timestamp;
    lease.status = LeaseStatus::ProofSubmitted;
    lease.serialize(&mut &mut lease_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ProofSubmitted:{{\"lease\":\"{}\",\"provider\":\"{}\"}}",
        lease_info.key,
        provider_authority.key
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 8 — VerifyAndRelease
// ---------------------------------------------------------------------------

fn process_verify_and_release(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let crank = next_account_info(iter)?;
    let lease_info = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;
    let escrow_vault = next_account_info(iter)?;
    let provider_wallet = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let foundation_info = next_account_info(iter)?;
    let burn_info = next_account_info(iter)?;

    assert_signer(crank)?;
    assert_writable(lease_info)?;
    assert_writable(request_info)?;
    assert_writable(provider_info)?;
    assert_writable(escrow_vault)?;
    assert_owned_by(lease_info, program_id)?;
    assert_owned_by(request_info, program_id)?;
    assert_owned_by(provider_info, program_id)?;
    assert_owned_by(config_info, program_id)?;

    let config = MarketConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(MarketError::NotInitialized.into());
    }

    let mut lease = Lease::try_from_slice(&lease_info.try_borrow_data()?)?;
    if lease.status != LeaseStatus::ProofSubmitted {
        return Err(MarketError::InvalidLeaseStatus.into());
    }

    // Ensure dispute window has passed
    let clock = Clock::get()?;
    let slots_since_proof = clock.slot.saturating_sub(lease.proof_submitted_at as u64);
    if slots_since_proof < config.dispute_window_slots {
        return Err(MarketError::DisputeWindowOpen.into());
    }

    if *foundation_info.key != config.foundation {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut req = ComputeRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;

    if lease.provider != provider.authority {
        return Err(ProgramError::InvalidAccountData);
    }
    if *provider_wallet.key != provider.authority {
        return Err(ProgramError::InvalidAccountData);
    }

    // Calculate actual cost
    let duration_secs = lease.end_time.saturating_sub(lease.start_time);
    let duration_hours = (duration_secs as u64).checked_add(3599).ok_or(MarketError::Overflow)? / 3600; // round up
    let actual_cost = lease
        .actual_price_per_hour
        .checked_mul(duration_hours)
        .ok_or(MarketError::Overflow)?
        .min(req.escrowed_amount);

    // Protocol fee
    let protocol_fee = actual_cost
        .checked_mul(config.protocol_fee_bps as u64)
        .ok_or(MarketError::Overflow)?
        / BPS_DENOMINATOR;
    let provider_payment = actual_cost
        .checked_sub(protocol_fee)
        .ok_or(MarketError::Overflow)?;

    // Fee split: 10% foundation, rest burned
    let foundation_share = protocol_fee / 10;
    let burn_share = protocol_fee.saturating_sub(foundation_share);

    // Excess refund to requester
    let excess = req
        .escrowed_amount
        .checked_sub(actual_cost)
        .ok_or(MarketError::Overflow)?;

    // Transfer from escrow vault
    transfer_lamports_signed(escrow_vault, provider_wallet, provider_payment)?;
    if foundation_share > 0 {
        transfer_lamports_signed(escrow_vault, foundation_info, foundation_share)?;
    }
    if burn_share > 0 {
        transfer_lamports_signed(escrow_vault, burn_info, burn_share)?;
    }

    // Refund excess to requester (requester account needed)
    // The requester address is in the request; we need their account passed in
    if excess > 0 {
        let requester_info = next_account_info(iter)?;
        if *requester_info.key != req.requester {
            return Err(ProgramError::InvalidAccountData);
        }
        transfer_lamports_signed(escrow_vault, requester_info, excess)?;
    }

    // Update state
    lease.status = LeaseStatus::Completed;
    lease.serialize(&mut &mut lease_info.try_borrow_mut_data()?[..])?;

    req.status = RequestStatus::Completed;
    req.escrowed_amount = 0;
    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    provider.active_leases = provider.active_leases.saturating_sub(1);
    provider.completed_leases = provider
        .completed_leases
        .checked_add(1)
        .ok_or(MarketError::Overflow)?;
    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:LeaseVerified:{{\"lease\":\"{}\",\"provider_payment\":{},\"protocol_fee\":{},\"excess_refund\":{}}}",
        lease_info.key,
        provider_payment,
        protocol_fee,
        excess
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 9 — DisputeLease
// ---------------------------------------------------------------------------

fn process_dispute_lease(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let requester = next_account_info(iter)?;
    let lease_info = next_account_info(iter)?;
    let dispute_info = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(requester)?;
    assert_writable(lease_info)?;
    assert_writable(dispute_info)?;
    assert_owned_by(lease_info, program_id)?;
    assert_owned_by(config_info, program_id)?;

    let config = MarketConfig::try_from_slice(&config_info.try_borrow_data()?)?;

    let mut lease = Lease::try_from_slice(&lease_info.try_borrow_data()?)?;
    if lease.requester != *requester.key {
        return Err(MarketError::Unauthorized.into());
    }
    if lease.status != LeaseStatus::ProofSubmitted {
        return Err(MarketError::InvalidLeaseStatus.into());
    }

    // Check within dispute window
    let clock = Clock::get()?;
    let slots_since_proof = clock.slot.saturating_sub(lease.proof_submitted_at as u64);
    if slots_since_proof > config.dispute_window_slots {
        return Err(MarketError::DisputeWindowExpired.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive dispute PDA
    let (dispute_pda, bump) = Pubkey::find_program_address(
        &[Dispute::SEED, lease_info.key.as_ref()],
        program_id,
    );
    if dispute_pda != *dispute_info.key {
        return Err(MarketError::InvalidPDA.into());
    }

    let seeds: &[&[u8]] = &[Dispute::SEED, lease_info.key.as_ref(), &[bump]];
    create_pda_account(
        requester,
        Dispute::LEN,
        program_id,
        system_prog,
        dispute_info,
        seeds,
    )?;

    let dispute = Dispute {
        lease: *lease_info.key,
        requester: *requester.key,
        reason_hash: [0u8; 32], // could accept reason data
        created_at: clock.unix_timestamp,
        resolved: false,
        provider_at_fault: false,
        bump,
    };

    dispute.serialize(&mut &mut dispute_info.try_borrow_mut_data()?[..])?;

    lease.status = LeaseStatus::Disputed;
    lease.serialize(&mut &mut lease_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:LeaseDisputed:{{\"lease\":\"{}\",\"requester\":\"{}\"}}",
        lease_info.key,
        requester.key
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 10 — ResolveDispute
// ---------------------------------------------------------------------------

fn process_resolve_dispute(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = ResolveDisputeArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let admin = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let dispute_info = next_account_info(iter)?;
    let lease_info = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;
    let escrow_vault = next_account_info(iter)?;
    let requester_info = next_account_info(iter)?;

    assert_signer(admin)?;
    assert_writable(dispute_info)?;
    assert_writable(lease_info)?;
    assert_writable(request_info)?;
    assert_writable(provider_info)?;
    assert_writable(escrow_vault)?;
    assert_owned_by(config_info, program_id)?;
    assert_owned_by(dispute_info, program_id)?;
    assert_owned_by(lease_info, program_id)?;
    assert_owned_by(request_info, program_id)?;
    assert_owned_by(provider_info, program_id)?;

    let config = MarketConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if config.admin != *admin.key {
        return Err(MarketError::Unauthorized.into());
    }

    let mut dispute = Dispute::try_from_slice(&dispute_info.try_borrow_data()?)?;
    if dispute.resolved {
        return Err(MarketError::InvalidLeaseStatus.into());
    }

    let mut lease = Lease::try_from_slice(&lease_info.try_borrow_data()?)?;
    if lease.status != LeaseStatus::Disputed {
        return Err(MarketError::InvalidLeaseStatus.into());
    }

    let mut req = ComputeRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;

    if *requester_info.key != req.requester {
        return Err(ProgramError::InvalidAccountData);
    }

    dispute.resolved = true;
    dispute.provider_at_fault = args.provider_at_fault;

    if args.provider_at_fault {
        // Slash provider stake, refund requester
        let slash_amount = provider.stake_amount / 2;
        provider.stake_amount = provider
            .stake_amount
            .saturating_sub(slash_amount);
        provider.slashes = provider
            .slashes
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;

        // Refund full escrow to requester
        let refund = req.escrowed_amount;
        if refund > 0 {
            transfer_lamports_signed(escrow_vault, requester_info, refund)?;
            req.escrowed_amount = 0;
        }

        lease.status = LeaseStatus::Slashed;

        msg!(
            "EVENT:DisputeResolved:{{\"lease\":\"{}\",\"provider_at_fault\":true,\"slashed\":{},\"refunded\":{}}}",
            lease_info.key,
            slash_amount,
            refund
        );
    } else {
        // Frivolous dispute — requester loses dispute bond (escrow proceeds normally)
        lease.status = LeaseStatus::ProofSubmitted; // revert to allow normal verification

        msg!(
            "EVENT:DisputeResolved:{{\"lease\":\"{}\",\"provider_at_fault\":false}}",
            lease_info.key
        );
    }

    dispute.serialize(&mut &mut dispute_info.try_borrow_mut_data()?[..])?;
    lease.serialize(&mut &mut lease_info.try_borrow_mut_data()?[..])?;
    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;
    provider.active_leases = provider.active_leases.saturating_sub(1);
    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    Ok(())
}

// ---------------------------------------------------------------------------
// 11 — SlashProvider (timeout)
// ---------------------------------------------------------------------------

fn process_slash_provider(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let crank = next_account_info(iter)?;
    let lease_info = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let provider_info = next_account_info(iter)?;
    let escrow_vault = next_account_info(iter)?;
    let requester_info = next_account_info(iter)?;

    assert_signer(crank)?;
    assert_writable(lease_info)?;
    assert_writable(request_info)?;
    assert_writable(provider_info)?;
    assert_writable(escrow_vault)?;
    assert_owned_by(lease_info, program_id)?;
    assert_owned_by(request_info, program_id)?;
    assert_owned_by(provider_info, program_id)?;

    let mut lease = Lease::try_from_slice(&lease_info.try_borrow_data()?)?;
    if lease.status != LeaseStatus::Active {
        return Err(MarketError::InvalidLeaseStatus.into());
    }

    let mut req = ComputeRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    if *requester_info.key != req.requester {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut provider = ProviderAccount::try_from_slice(&provider_info.try_borrow_data()?)?;
    if lease.provider != provider.authority {
        return Err(ProgramError::InvalidAccountData);
    }

    // Check if lease has timed out (end_time + grace period)
    let clock = Clock::get()?;
    let deadline = lease
        .end_time
        .checked_add((GRACE_PERIOD_HOURS as i64) * 3600)
        .ok_or(MarketError::Overflow)?;

    if clock.unix_timestamp <= deadline {
        return Err(MarketError::LeaseNotTimedOut.into());
    }

    // Slash provider
    let slash_amount = provider.stake_amount / 2;
    provider.stake_amount = provider.stake_amount.saturating_sub(slash_amount);
    provider.slashes = provider
        .slashes
        .checked_add(1)
        .ok_or(MarketError::Overflow)?;
    provider.is_active = false;
    provider.active_leases = provider.active_leases.saturating_sub(1);
    provider.serialize(&mut &mut provider_info.try_borrow_mut_data()?[..])?;

    // Refund requester
    let refund = req.escrowed_amount;
    if refund > 0 {
        transfer_lamports_signed(escrow_vault, requester_info, refund)?;
        req.escrowed_amount = 0;
    }
    req.status = RequestStatus::Cancelled;
    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    lease.status = LeaseStatus::Slashed;
    lease.serialize(&mut &mut lease_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ProviderSlashed:{{\"lease\":\"{}\",\"provider\":\"{}\",\"slashed\":{},\"refunded\":{}}}",
        lease_info.key,
        provider.authority,
        slash_amount,
        refund
    );

    Ok(())
}
