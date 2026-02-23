//! AI Precompiles instruction builders — model registration, inference, verification.
//!
//! Matches: programs/ai-precompiles/src/lib.rs
//! Program ID: CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ
//!
//! Instructions:
//!   0 = Initialize
//!   1 = RegisterModel
//!   2 = RegisterValidator
//!   3 = RequestInference
//!   4 = SubmitResult
//!   5 = VerifyLogits
//!   6 = ClaimInferenceFee

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_REGISTER_MODEL: u8 = 1;
const IX_REGISTER_VALIDATOR: u8 = 2;
const IX_REQUEST_INFERENCE: u8 = 3;
const IX_SUBMIT_RESULT: u8 = 4;
const IX_VERIFY_LOGITS: u8 = 5;
const IX_CLAIM_INFERENCE_FEE: u8 = 6;

// ── Param Structs (exact Borsh match to program) ────────────────────────────

#[derive(BorshSerialize)]
pub struct InitializeArgs {
    pub registration_fee: u64,
    pub min_stake: u64,
    pub burn_address: Pubkey,
    pub foundation: Pubkey,
}

#[derive(BorshSerialize)]
pub struct RegisterModelArgs {
    pub model_weights_hash: [u8; 32],
    pub model_name: String,
    pub model_version: String,
    pub parameter_count: u64,
    pub architecture: String,
    pub storage_uri: String,
}

#[derive(BorshSerialize)]
pub struct RegisterValidatorArgs {
    pub stake_amount: u64,
    pub gpu_model: String,
    pub vram_gb: u16,
    pub supported_models: Vec<[u8; 32]>,
}

#[derive(BorshSerialize)]
pub struct RequestInferenceArgs {
    pub model_hash: [u8; 32],
    pub input_data: Vec<u8>,
    pub max_output_len: u32,
    pub callback_program: Option<Pubkey>,
    pub max_fee: u64,
}

#[derive(BorshSerialize)]
pub struct SubmitResultArgs {
    pub output_hash: [u8; 32],
    pub logit_fingerprint: Vec<[f32; 4]>,
    pub compute_units_used: u64,
}

#[derive(BorshSerialize)]
pub struct VerifyLogitsArgs {
    pub token_position: u32,
    pub expected_logits: [f32; 4],
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_ai_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AI_CONFIG_SEED], &AI_PRECOMPILES_PROGRAM_ID)
}

pub fn find_model(model_weights_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[MODEL_SEED, model_weights_hash.as_ref()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

pub fn find_ai_validator(authority: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[AI_VALIDATOR_SEED, authority.as_ref()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

pub fn find_inference_request(nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[INFERENCE_SEED, &nonce.to_le_bytes()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

pub fn find_inference_result(request_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[RESULT_SEED, request_key.as_ref()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

pub fn find_verification(request_key: &Pubkey, verifier: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VERIFICATION_SEED, request_key.as_ref(), verifier.as_ref()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

/// Initialize the AI precompiles config.
///
/// Accounts:
///   0. `[signer, writable]` admin (payer)
///   1. `[writable]` ai_config PDA
///   2. `[]` system_program
pub fn create_initialize_instruction(
    admin: &Pubkey,
    registration_fee: u64,
    min_stake: u64,
    burn_address: &Pubkey,
    foundation: &Pubkey,
) -> Instruction {
    let (config_pda, _) = find_ai_config();

    let args = InitializeArgs {
        registration_fee,
        min_stake,
        burn_address: *burn_address,
        foundation: *foundation,
    };
    let mut data = vec![IX_INITIALIZE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Register an AI model.
///
/// Accounts:
///   0. `[signer, writable]` owner (payer)
///   1. `[writable]` model PDA (seeds: ["model", model_weights_hash])
///   2. `[writable]` ai_config PDA
///   3. `[writable]` burn_address
///   4. `[]` system_program
pub fn create_register_model_instruction(
    owner: &Pubkey,
    model_weights_hash: [u8; 32],
    model_name: String,
    model_version: String,
    parameter_count: u64,
    architecture: String,
    storage_uri: String,
    burn_address: &Pubkey,
) -> Instruction {
    let (model_pda, _) = find_model(&model_weights_hash);
    let (config_pda, _) = find_ai_config();

    let args = RegisterModelArgs {
        model_weights_hash,
        model_name,
        model_version,
        parameter_count,
        architecture,
        storage_uri,
    };
    let mut data = vec![IX_REGISTER_MODEL];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new(model_pda, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(*burn_address, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Register an AI validator.
///
/// Accounts:
///   0. `[signer, writable]` authority (payer)
///   1. `[writable]` ai_validator PDA (seeds: ["ai_validator", authority])
///   2. `[]` ai_config PDA
///   3. `[writable]` stake_vault
///   4. `[]` system_program
pub fn create_register_validator_instruction(
    authority: &Pubkey,
    stake_amount: u64,
    gpu_model: String,
    vram_gb: u16,
    supported_models: Vec<[u8; 32]>,
    stake_vault: &Pubkey,
) -> Instruction {
    let (validator_pda, _) = find_ai_validator(authority);
    let (config_pda, _) = find_ai_config();

    let args = RegisterValidatorArgs {
        stake_amount,
        gpu_model,
        vram_gb,
        supported_models,
    };
    let mut data = vec![IX_REGISTER_VALIDATOR];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(validator_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(*stake_vault, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Request an AI inference.
///
/// Accounts:
///   0. `[signer, writable]` requester (payer)
///   1. `[writable]` inference_request PDA (seeds: ["inference", nonce_bytes])
///   2. `[writable]` ai_config PDA
///   3. `[writable]` escrow_vault
///   4. `[]` system_program
pub fn create_request_inference_instruction(
    requester: &Pubkey,
    nonce: u64,
    model_hash: [u8; 32],
    input_data: Vec<u8>,
    max_output_len: u32,
    callback_program: Option<Pubkey>,
    max_fee: u64,
    escrow_vault: &Pubkey,
) -> Instruction {
    let (request_pda, _) = find_inference_request(nonce);
    let (config_pda, _) = find_ai_config();

    let args = RequestInferenceArgs {
        model_hash,
        input_data,
        max_output_len,
        callback_program,
        max_fee,
    };
    let mut data = vec![IX_REQUEST_INFERENCE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*requester, true),
            AccountMeta::new(request_pda, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(*escrow_vault, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Submit an inference result.
///
/// Accounts:
///   0. `[signer, writable]` validator_authority (payer)
///   1. `[writable]` inference_request PDA
///   2. `[writable]` inference_result PDA (seeds: ["result", request_key])
///   3. `[]` ai_validator PDA
///   4. `[]` system_program
pub fn create_submit_result_instruction(
    validator_authority: &Pubkey,
    request_key: &Pubkey,
    output_hash: [u8; 32],
    logit_fingerprint: Vec<[f32; 4]>,
    compute_units_used: u64,
) -> Instruction {
    let (result_pda, _) = find_inference_result(request_key);
    let (validator_pda, _) = find_ai_validator(validator_authority);

    let args = SubmitResultArgs {
        output_hash,
        logit_fingerprint,
        compute_units_used,
    };
    let mut data = vec![IX_SUBMIT_RESULT];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*validator_authority, true),
            AccountMeta::new(*request_key, false),
            AccountMeta::new(result_pda, false),
            AccountMeta::new_readonly(validator_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Verify logits for a completed inference.
///
/// Accounts:
///   0. `[signer, writable]` verifier_authority (payer)
///   1. `[writable]` inference_request PDA
///   2. `[]` inference_result PDA
///   3. `[writable]` verification_record PDA (seeds: ["verification", request_key, verifier])
///   4. `[writable]` verifier_validator PDA
///   5. `[writable]` submitter_validator PDA
///   6. `[]` system_program
pub fn create_verify_logits_instruction(
    verifier_authority: &Pubkey,
    request_key: &Pubkey,
    result_key: &Pubkey,
    submitter_validator_key: &Pubkey,
    token_position: u32,
    expected_logits: [f32; 4],
) -> Instruction {
    let (verification_pda, _) = find_verification(request_key, verifier_authority);
    let (verifier_validator_pda, _) = find_ai_validator(verifier_authority);

    let args = VerifyLogitsArgs {
        token_position,
        expected_logits,
    };
    let mut data = vec![IX_VERIFY_LOGITS];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*verifier_authority, true),
            AccountMeta::new(*request_key, false),
            AccountMeta::new_readonly(*result_key, false),
            AccountMeta::new(verification_pda, false),
            AccountMeta::new(verifier_validator_pda, false),
            AccountMeta::new(*submitter_validator_key, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Claim the inference fee after the challenge window.
///
/// Accounts:
///   0. `[signer]` validator_authority
///   1. `[writable]` inference_request PDA
///   2. `[writable]` escrow_vault
///   3. `[]` ai_config PDA
///   4. `[writable]` foundation account
///   5. `[writable]` burn_address
pub fn create_claim_inference_fee_instruction(
    validator_authority: &Pubkey,
    request_key: &Pubkey,
    escrow_vault: &Pubkey,
    config_key: &Pubkey,
    foundation: &Pubkey,
    burn_address: &Pubkey,
) -> Instruction {
    // No instruction data beyond discriminator
    let data = vec![IX_CLAIM_INFERENCE_FEE];

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*validator_authority, true),
            AccountMeta::new(*request_key, false),
            AccountMeta::new(*escrow_vault, false),
            AccountMeta::new_readonly(*config_key, false),
            AccountMeta::new(*foundation, false),
            AccountMeta::new(*burn_address, false),
        ],
        data,
    }
}
