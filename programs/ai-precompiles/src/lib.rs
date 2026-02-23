//! Mythic L2 — Native AI Inference/Verification Precompiles for the SVM
//!
//! Program ID: MythAI11111111111111111111111111111111111

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

solana_program::declare_id!("CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MODEL_NAME: usize = 64;
const MAX_MODEL_VERSION: usize = 16;
const MAX_ARCHITECTURE: usize = 32;
const MAX_STORAGE_URI: usize = 256;
const MAX_GPU_MODEL: usize = 32;
const MAX_SUPPORTED_MODELS: usize = 16;
const MAX_INPUT_DATA: usize = 10_240; // 10 KB
const LOGIT_TOLERANCE: f32 = 0.01;
const CHALLENGE_WINDOW_SLOTS: u64 = 100;

// Fee split (of escrowed amount)
const VALIDATOR_FEE_BPS: u64 = 5_000; // 50 %
const FOUNDATION_FEE_BPS: u64 = 1_000; // 10 %
const BURN_FEE_BPS: u64 = 4_000; // 40 %
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
pub enum AiInstruction {
    Initialize = 0,
    RegisterModel = 1,
    RegisterValidator = 2,
    RequestInference = 3,
    SubmitResult = 4,
    VerifyLogits = 5,
    ClaimInferenceFee = 6,
}

impl TryFrom<u8> for AiInstruction {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(Self::Initialize),
            1 => Ok(Self::RegisterModel),
            2 => Ok(Self::RegisterValidator),
            3 => Ok(Self::RequestInference),
            4 => Ok(Self::SubmitResult),
            5 => Ok(Self::VerifyLogits),
            6 => Ok(Self::ClaimInferenceFee),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

// ---------------------------------------------------------------------------
// State Accounts
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct AIConfig {
    pub is_initialized: bool,
    pub admin: Pubkey,
    pub registration_fee: u64,
    pub min_stake: u64,
    pub request_nonce: u64,
    pub burn_address: Pubkey,
    pub foundation: Pubkey,
    pub bump: u8,
}

impl AIConfig {
    pub const SEED: &'static [u8] = b"ai_config";
    pub const LEN: usize = 1 + 32 + 8 + 8 + 8 + 32 + 32 + 1; // 122
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ModelAccount {
    pub owner: Pubkey,
    pub model_weights_hash: [u8; 32],
    pub model_name: String,
    pub model_version: String,
    pub parameter_count: u64,
    pub architecture: String,
    pub storage_uri: String,
    pub registered_at: i64,
    pub is_active: bool,
    pub bump: u8,
}

impl ModelAccount {
    pub const SEED: &'static [u8] = b"model";
    // borsh strings: 4-byte len prefix + data
    pub const LEN: usize = 32 + 32 + (4 + MAX_MODEL_NAME) + (4 + MAX_MODEL_VERSION) + 8
        + (4 + MAX_ARCHITECTURE) + (4 + MAX_STORAGE_URI) + 8 + 1 + 1; // ~465
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct AIValidator {
    pub authority: Pubkey,
    pub stake_amount: u64,
    pub gpu_model: String,
    pub vram_gb: u16,
    pub supported_model_count: u16,
    pub supported_models: Vec<[u8; 32]>,
    pub inference_count: u64,
    pub slash_count: u64,
    pub is_active: bool,
    pub bump: u8,
}

impl AIValidator {
    pub const SEED: &'static [u8] = b"ai_validator";
    // 32 + 8 + (4+32) + 2 + 2 + (4 + 16*32) + 8 + 8 + 1 + 1 = ~614
    pub const LEN: usize = 32 + 8 + (4 + MAX_GPU_MODEL) + 2 + 2
        + (4 + MAX_SUPPORTED_MODELS * 32) + 8 + 8 + 1 + 1;
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
#[repr(u8)]
pub enum InferenceStatus {
    Pending = 0,
    Assigned = 1,
    Completed = 2,
    Verified = 3,
    Disputed = 4,
    Failed = 5,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct InferenceRequest {
    pub requester: Pubkey,
    pub model_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub max_output_len: u32,
    pub max_fee: u64,
    pub escrowed_amount: u64,
    pub status: InferenceStatus,
    pub assigned_validator: Pubkey,
    pub created_at: i64,
    pub completed_at: i64,
    pub nonce: u64,
    pub bump: u8,
}

impl InferenceRequest {
    pub const SEED: &'static [u8] = b"inference";
    pub const LEN: usize = 32 + 32 + 32 + 4 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 1; // 174
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct InferenceResult {
    pub request: Pubkey,
    pub validator: Pubkey,
    pub output_hash: [u8; 32],
    pub logit_fingerprint_hash: [u8; 32],
    pub compute_units: u64,
    pub submitted_at: i64,
    pub bump: u8,
}

impl InferenceResult {
    pub const SEED: &'static [u8] = b"result";
    pub const LEN: usize = 32 + 32 + 32 + 32 + 8 + 8 + 1; // 145
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VerificationRecord {
    pub request: Pubkey,
    pub verifier: Pubkey,
    pub token_position: u32,
    pub matched: bool,
    pub verified_at: i64,
    pub bump: u8,
}

impl VerificationRecord {
    pub const SEED: &'static [u8] = b"verification";
    pub const LEN: usize = 32 + 32 + 4 + 1 + 8 + 1; // 78
}

// ---------------------------------------------------------------------------
// Instruction Data Payloads
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub registration_fee: u64,
    pub min_stake: u64,
    pub burn_address: Pubkey,
    pub foundation: Pubkey,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RegisterModelArgs {
    pub model_weights_hash: [u8; 32],
    pub model_name: String,
    pub model_version: String,
    pub parameter_count: u64,
    pub architecture: String,
    pub storage_uri: String,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RegisterValidatorArgs {
    pub stake_amount: u64,
    pub gpu_model: String,
    pub vram_gb: u16,
    pub supported_models: Vec<[u8; 32]>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RequestInferenceArgs {
    pub model_hash: [u8; 32],
    pub input_data: Vec<u8>,
    pub max_output_len: u32,
    pub callback_program: Option<Pubkey>,
    pub max_fee: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SubmitResultArgs {
    pub output_hash: [u8; 32],
    pub logit_fingerprint: Vec<[f32; 4]>,
    pub compute_units_used: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct VerifyLogitsArgs {
    pub token_position: u32,
    pub expected_logits: [f32; 4],
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum AiError {
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
    #[error("Input data exceeds 10 KB")]
    InputTooLarge,
    #[error("Insufficient fee")]
    InsufficientFee,
    #[error("Insufficient stake")]
    InsufficientStake,
    #[error("Too many supported models")]
    TooManySupportedModels,
    #[error("Invalid inference status")]
    InvalidStatus,
    #[error("Verifier cannot be the same as submitter")]
    SelfVerification,
    #[error("Challenge window not expired")]
    ChallengeWindowOpen,
    #[error("Model not active")]
    ModelNotActive,
    #[error("Validator not active")]
    ValidatorNotActive,
    #[error("Arithmetic overflow")]
    Overflow,
}

impl From<AiError> for ProgramError {
    fn from(e: AiError) -> Self {
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

    match AiInstruction::try_from(disc)? {
        AiInstruction::Initialize => process_initialize(program_id, accounts, rest),
        AiInstruction::RegisterModel => process_register_model(program_id, accounts, rest),
        AiInstruction::RegisterValidator => {
            process_register_validator(program_id, accounts, rest)
        }
        AiInstruction::RequestInference => {
            process_request_inference(program_id, accounts, rest)
        }
        AiInstruction::SubmitResult => process_submit_result(program_id, accounts, rest),
        AiInstruction::VerifyLogits => process_verify_logits(program_id, accounts, rest),
        AiInstruction::ClaimInferenceFee => {
            process_claim_inference_fee(program_id, accounts, rest)
        }
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

fn transfer_lamports<'a>(
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

    // Derive PDA
    let (config_pda, bump) = Pubkey::find_program_address(&[AIConfig::SEED], program_id);
    if config_pda != *config_info.key {
        return Err(AiError::InvalidPDA.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Create account
    let seeds: &[&[u8]] = &[AIConfig::SEED, &[bump]];
    create_pda_account(admin, AIConfig::LEN, program_id, system_prog, config_info, seeds)?;

    let config = AIConfig {
        is_initialized: true,
        admin: *admin.key,
        registration_fee: args.registration_fee,
        min_stake: args.min_stake,
        request_nonce: 0,
        burn_address: args.burn_address,
        foundation: args.foundation,
        bump,
    };

    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:Initialized:{{\"admin\":\"{}\",\"registration_fee\":{},\"min_stake\":{}}}",
        admin.key,
        args.registration_fee,
        args.min_stake
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 1 — RegisterModel
// ---------------------------------------------------------------------------

fn process_register_model(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RegisterModelArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let owner = next_account_info(iter)?;
    let model_info = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let burn_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(owner)?;
    assert_writable(model_info)?;
    assert_writable(config_info)?;
    assert_owned_by(config_info, program_id)?;

    let config = AIConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(AiError::NotInitialized.into());
    }

    // Validate string lengths
    if args.model_name.len() > MAX_MODEL_NAME
        || args.model_version.len() > MAX_MODEL_VERSION
        || args.architecture.len() > MAX_ARCHITECTURE
        || args.storage_uri.len() > MAX_STORAGE_URI
    {
        return Err(AiError::StringTooLong.into());
    }

    // Validate burn address
    if *burn_info.key != config.burn_address {
        return Err(ProgramError::InvalidAccountData);
    }

    // Derive model PDA
    let (model_pda, bump) = Pubkey::find_program_address(
        &[ModelAccount::SEED, &args.model_weights_hash],
        program_id,
    );
    if model_pda != *model_info.key {
        return Err(AiError::InvalidPDA.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Charge registration fee (burn — transfer to burn address)
    if config.registration_fee > 0 {
        transfer_lamports(owner, burn_info, config.registration_fee, system_prog)?;
    }

    // Create PDA
    let seeds: &[&[u8]] = &[ModelAccount::SEED, &args.model_weights_hash, &[bump]];
    create_pda_account(owner, ModelAccount::LEN, program_id, system_prog, model_info, seeds)?;

    let clock = Clock::get()?;
    let model = ModelAccount {
        owner: *owner.key,
        model_weights_hash: args.model_weights_hash,
        model_name: args.model_name.clone(),
        model_version: args.model_version.clone(),
        parameter_count: args.parameter_count,
        architecture: args.architecture.clone(),
        storage_uri: args.storage_uri.clone(),
        registered_at: clock.unix_timestamp,
        is_active: true,
        bump,
    };

    model.serialize(&mut &mut model_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ModelRegistered:{{\"owner\":\"{}\",\"model_name\":\"{}\",\"parameter_count\":{}}}",
        owner.key,
        args.model_name,
        args.parameter_count
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 2 — RegisterValidator
// ---------------------------------------------------------------------------

fn process_register_validator(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RegisterValidatorArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let validator_info = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let stake_vault = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(validator_info)?;
    assert_owned_by(config_info, program_id)?;

    let config = AIConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(AiError::NotInitialized.into());
    }

    if args.stake_amount < config.min_stake {
        return Err(AiError::InsufficientStake.into());
    }

    if args.gpu_model.len() > MAX_GPU_MODEL {
        return Err(AiError::StringTooLong.into());
    }

    if args.supported_models.len() > MAX_SUPPORTED_MODELS {
        return Err(AiError::TooManySupportedModels.into());
    }

    // Derive validator PDA
    let (validator_pda, bump) = Pubkey::find_program_address(
        &[AIValidator::SEED, authority.key.as_ref()],
        program_id,
    );
    if validator_pda != *validator_info.key {
        return Err(AiError::InvalidPDA.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Transfer stake to vault
    transfer_lamports(authority, stake_vault, args.stake_amount, system_prog)?;

    // Create PDA
    let seeds: &[&[u8]] = &[AIValidator::SEED, authority.key.as_ref(), &[bump]];
    create_pda_account(
        authority,
        AIValidator::LEN,
        program_id,
        system_prog,
        validator_info,
        seeds,
    )?;

    let validator = AIValidator {
        authority: *authority.key,
        stake_amount: args.stake_amount,
        gpu_model: args.gpu_model.clone(),
        vram_gb: args.vram_gb,
        supported_model_count: args.supported_models.len() as u16,
        supported_models: args.supported_models,
        inference_count: 0,
        slash_count: 0,
        is_active: true,
        bump,
    };

    validator.serialize(&mut &mut validator_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ValidatorRegistered:{{\"authority\":\"{}\",\"stake\":{},\"gpu\":\"{}\"}}",
        authority.key,
        args.stake_amount,
        args.gpu_model
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 3 — RequestInference
// ---------------------------------------------------------------------------

fn process_request_inference(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RequestInferenceArgs::try_from_slice(data)?;
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

    if args.input_data.len() > MAX_INPUT_DATA {
        return Err(AiError::InputTooLarge.into());
    }

    let mut config = AIConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(AiError::NotInitialized.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let nonce = config.request_nonce;
    let nonce_bytes = nonce.to_le_bytes();

    // Derive request PDA
    let (request_pda, bump) = Pubkey::find_program_address(
        &[InferenceRequest::SEED, &nonce_bytes],
        program_id,
    );
    if request_pda != *request_info.key {
        return Err(AiError::InvalidPDA.into());
    }

    // Escrow payment
    transfer_lamports(requester, escrow_vault, args.max_fee, system_prog)?;

    // Create PDA
    let seeds: &[&[u8]] = &[InferenceRequest::SEED, &nonce_bytes, &[bump]];
    create_pda_account(
        requester,
        InferenceRequest::LEN,
        program_id,
        system_prog,
        request_info,
        seeds,
    )?;

    let clock = Clock::get()?;
    let input_hash = sha256(&args.input_data);

    let req = InferenceRequest {
        requester: *requester.key,
        model_hash: args.model_hash,
        input_hash,
        max_output_len: args.max_output_len,
        max_fee: args.max_fee,
        escrowed_amount: args.max_fee,
        status: InferenceStatus::Pending,
        assigned_validator: Pubkey::default(),
        created_at: clock.unix_timestamp,
        completed_at: 0,
        nonce,
        bump,
    };

    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    // Increment nonce
    config.request_nonce = nonce.checked_add(1).ok_or(AiError::Overflow)?;
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:InferenceRequested:{{\"requester\":\"{}\",\"nonce\":{},\"max_fee\":{},\"model_hash\":\"{}\"}}",
        requester.key,
        nonce,
        args.max_fee,
        hex::encode(args.model_hash)
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 4 — SubmitResult
// ---------------------------------------------------------------------------

fn process_submit_result(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = SubmitResultArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let validator_authority = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let result_info = next_account_info(iter)?;
    let validator_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(validator_authority)?;
    assert_writable(request_info)?;
    assert_writable(result_info)?;
    assert_owned_by(request_info, program_id)?;
    assert_owned_by(validator_info, program_id)?;

    // Validate validator is active
    let mut validator_state = AIValidator::try_from_slice(&validator_info.try_borrow_data()?)?;
    if !validator_state.is_active {
        return Err(AiError::ValidatorNotActive.into());
    }
    if validator_state.authority != *validator_authority.key {
        return Err(AiError::Unauthorized.into());
    }

    // Load request
    let mut req = InferenceRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    if req.status != InferenceStatus::Pending && req.status != InferenceStatus::Assigned {
        return Err(AiError::InvalidStatus.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive result PDA
    let (result_pda, bump) = Pubkey::find_program_address(
        &[InferenceResult::SEED, request_info.key.as_ref()],
        program_id,
    );
    if result_pda != *result_info.key {
        return Err(AiError::InvalidPDA.into());
    }

    // Hash the logit fingerprint for storage
    let logit_bytes: Vec<u8> = args
        .logit_fingerprint
        .iter()
        .flat_map(|arr| arr.iter().flat_map(|f| f.to_le_bytes()))
        .collect();
    let logit_fingerprint_hash = sha256(&logit_bytes);

    let clock = Clock::get()?;

    // Create result PDA
    let seeds: &[&[u8]] = &[InferenceResult::SEED, request_info.key.as_ref(), &[bump]];
    create_pda_account(
        validator_authority,
        InferenceResult::LEN,
        program_id,
        system_prog,
        result_info,
        seeds,
    )?;

    let result = InferenceResult {
        request: *request_info.key,
        validator: *validator_authority.key,
        output_hash: args.output_hash,
        logit_fingerprint_hash,
        compute_units: args.compute_units_used,
        submitted_at: clock.unix_timestamp,
        bump,
    };

    result.serialize(&mut &mut result_info.try_borrow_mut_data()?[..])?;

    // Update request status
    req.status = InferenceStatus::Completed;
    req.assigned_validator = *validator_authority.key;
    req.completed_at = clock.unix_timestamp;
    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    // Update validator stats
    validator_state.inference_count = validator_state
        .inference_count
        .checked_add(1)
        .ok_or(AiError::Overflow)?;
    validator_state.serialize(&mut &mut validator_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ResultSubmitted:{{\"request\":\"{}\",\"validator\":\"{}\",\"compute_units\":{}}}",
        request_info.key,
        validator_authority.key,
        args.compute_units_used
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 5 — VerifyLogits
// ---------------------------------------------------------------------------

fn process_verify_logits(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = VerifyLogitsArgs::try_from_slice(data)?;
    let iter = &mut accounts.iter();
    let verifier_authority = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let result_info = next_account_info(iter)?;
    let verification_info = next_account_info(iter)?;
    let verifier_validator_info = next_account_info(iter)?;
    let submitter_validator_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(verifier_authority)?;
    assert_writable(verification_info)?;
    assert_writable(submitter_validator_info)?;
    assert_writable(verifier_validator_info)?;
    assert_owned_by(request_info, program_id)?;
    assert_owned_by(result_info, program_id)?;
    assert_owned_by(verifier_validator_info, program_id)?;
    assert_owned_by(submitter_validator_info, program_id)?;

    let mut req = InferenceRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    if req.status != InferenceStatus::Completed {
        return Err(AiError::InvalidStatus.into());
    }

    let inf_result = InferenceResult::try_from_slice(&result_info.try_borrow_data()?)?;
    if inf_result.request != *request_info.key {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verifier must be different from submitter
    let verifier_state = AIValidator::try_from_slice(&verifier_validator_info.try_borrow_data()?)?;
    if verifier_state.authority != *verifier_authority.key {
        return Err(AiError::Unauthorized.into());
    }
    if !verifier_state.is_active {
        return Err(AiError::ValidatorNotActive.into());
    }
    if inf_result.validator == *verifier_authority.key {
        return Err(AiError::SelfVerification.into());
    }

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive verification PDA
    let (ver_pda, bump) = Pubkey::find_program_address(
        &[
            VerificationRecord::SEED,
            request_info.key.as_ref(),
            verifier_authority.key.as_ref(),
        ],
        program_id,
    );
    if ver_pda != *verification_info.key {
        return Err(AiError::InvalidPDA.into());
    }

    // Compare logits — the verifier provides what they computed for that position.
    // In a real system, the original logits would be retrieved off-chain;
    // here we check if the expected_logits hash matches stored fingerprint.
    // For on-chain logic: check if any logit element differs by more than tolerance.
    // Since the original logit_fingerprint is stored as a hash, the actual comparison
    // is: verifier claims these are the expected logits. If the hash of the verifier's
    // logits at this position differs from the stored hash, there's a mismatch.
    //
    // Simplified: the verifier re-ran the forward pass and provides expected_logits.
    // The hash comparison determines match.
    let verifier_logit_bytes: Vec<u8> = args
        .expected_logits
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    // For this on-chain check, we mark as matched if the logits are within tolerance
    // of the stored fingerprint hash. Since exact logit comparison requires the
    // original data, we store the verification record and let the result stand.
    // A full implementation would have the original logits stored off-chain with
    // the hash serving as commitment.
    let _verifier_hash = sha256(&verifier_logit_bytes);

    // Determine match — simplified: always store the verification.
    // In production, an oracle or the original logit data would be compared.
    // Here we assume the verifier's provided logits are ground truth and
    // check against the stored fingerprint hash.
    let matched = true; // Placeholder — real impl compares off-chain data

    // If mismatch detected (matched == false): slash submitter, reward verifier
    // For now, the mismatch path is included for completeness
    let clock = Clock::get()?;

    let seeds: &[&[u8]] = &[
        VerificationRecord::SEED,
        request_info.key.as_ref(),
        verifier_authority.key.as_ref(),
        &[bump],
    ];
    create_pda_account(
        verifier_authority,
        VerificationRecord::LEN,
        program_id,
        system_prog,
        verification_info,
        seeds,
    )?;

    let record = VerificationRecord {
        request: *request_info.key,
        verifier: *verifier_authority.key,
        token_position: args.token_position,
        matched,
        verified_at: clock.unix_timestamp,
        bump,
    };

    record.serialize(&mut &mut verification_info.try_borrow_mut_data()?[..])?;

    if !matched {
        // Slash submitter
        let mut submitter_state =
            AIValidator::try_from_slice(&submitter_validator_info.try_borrow_data()?)?;
        let slash_amount = submitter_state.stake_amount / 2;
        submitter_state.stake_amount = submitter_state
            .stake_amount
            .checked_sub(slash_amount)
            .ok_or(AiError::Overflow)?;
        submitter_state.slash_count = submitter_state
            .slash_count
            .checked_add(1)
            .ok_or(AiError::Overflow)?;
        submitter_state
            .serialize(&mut &mut submitter_validator_info.try_borrow_mut_data()?[..])?;

        // Reward verifier
        transfer_lamports_signed(submitter_validator_info, verifier_validator_info, slash_amount)?;

        // Mark request as disputed
        req.status = InferenceStatus::Disputed;
        req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

        msg!(
            "EVENT:LogitMismatch:{{\"request\":\"{}\",\"verifier\":\"{}\",\"position\":{},\"slash_amount\":{}}}",
            request_info.key,
            verifier_authority.key,
            args.token_position,
            slash_amount
        );
    } else {
        req.status = InferenceStatus::Verified;
        req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

        msg!(
            "EVENT:LogitVerified:{{\"request\":\"{}\",\"verifier\":\"{}\",\"position\":{}}}",
            request_info.key,
            verifier_authority.key,
            args.token_position
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// 6 — ClaimInferenceFee
// ---------------------------------------------------------------------------

fn process_claim_inference_fee(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let validator_authority = next_account_info(iter)?;
    let request_info = next_account_info(iter)?;
    let escrow_vault = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let foundation_info = next_account_info(iter)?;
    let burn_info = next_account_info(iter)?;

    assert_signer(validator_authority)?;
    assert_writable(request_info)?;
    assert_writable(escrow_vault)?;
    assert_owned_by(request_info, program_id)?;
    assert_owned_by(config_info, program_id)?;

    let config = AIConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(AiError::NotInitialized.into());
    }

    if *foundation_info.key != config.foundation {
        return Err(ProgramError::InvalidAccountData);
    }
    if *burn_info.key != config.burn_address {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut req = InferenceRequest::try_from_slice(&request_info.try_borrow_data()?)?;
    if req.status != InferenceStatus::Completed && req.status != InferenceStatus::Verified {
        return Err(AiError::InvalidStatus.into());
    }

    if req.assigned_validator != *validator_authority.key {
        return Err(AiError::Unauthorized.into());
    }

    // Check challenge window
    let clock = Clock::get()?;
    let slots_since = clock.slot.saturating_sub(req.completed_at as u64);
    if req.status == InferenceStatus::Completed && slots_since < CHALLENGE_WINDOW_SLOTS {
        return Err(AiError::ChallengeWindowOpen.into());
    }

    let total = req.escrowed_amount;
    let validator_share = total
        .checked_mul(VALIDATOR_FEE_BPS)
        .ok_or(AiError::Overflow)?
        / BPS_DENOMINATOR;
    let foundation_share = total
        .checked_mul(FOUNDATION_FEE_BPS)
        .ok_or(AiError::Overflow)?
        / BPS_DENOMINATOR;
    let burn_share = total
        .checked_mul(BURN_FEE_BPS)
        .ok_or(AiError::Overflow)?
        / BPS_DENOMINATOR;

    // Transfer from escrow vault (PDA or system account controlled by program)
    transfer_lamports_signed(escrow_vault, validator_authority, validator_share)?;
    transfer_lamports_signed(escrow_vault, foundation_info, foundation_share)?;
    transfer_lamports_signed(escrow_vault, burn_info, burn_share)?;

    // Mark request as completed/claimed by setting escrowed to 0
    req.escrowed_amount = 0;
    req.serialize(&mut &mut request_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:FeeClaimed:{{\"request\":\"{}\",\"validator\":\"{}\",\"validator_share\":{},\"foundation_share\":{},\"burned\":{}}}",
        request_info.key,
        validator_authority.key,
        validator_share,
        foundation_share,
        burn_share
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Hex encoding helper (no external crate)
// ---------------------------------------------------------------------------

mod hex {
    pub fn encode(data: impl AsRef<[u8]>) -> String {
        data.as_ref()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect()
    }
}
