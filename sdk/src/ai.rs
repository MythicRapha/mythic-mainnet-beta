//! AI Precompiles instruction builders — model registration, inference, verification.

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
const IX_REQUEST_INFERENCE: u8 = 2;
const IX_SUBMIT_RESULT: u8 = 3;
const IX_VERIFY_RESULT: u8 = 4;
const IX_DISPUTE_RESULT: u8 = 5;

// ── Param Structs ───────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct RegisterModelParams {
    model_hash: [u8; 32],
    model_type: u8,
    max_input_size: u32,
    cost_per_inference: u64,
    uri: String,
}

#[derive(BorshSerialize)]
struct RequestInferenceParams {
    model_id: u64,
    input_hash: [u8; 32],
    max_cost: u64,
}

#[derive(BorshSerialize)]
struct SubmitResultParams {
    job_id: u64,
    output_hash: [u8; 32],
    proof: Vec<u8>,
}

#[derive(BorshSerialize)]
struct VerifyResultParams {
    job_id: u64,
}

#[derive(BorshSerialize)]
struct DisputeResultParams {
    job_id: u64,
    counter_proof: Vec<u8>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_ai_registry() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AI_REGISTRY_SEED], &AI_PRECOMPILES_PROGRAM_ID)
}

pub fn find_ai_job(job_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[AI_JOB_SEED, &job_id.to_le_bytes()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

pub fn find_ai_result(job_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[AI_RESULT_SEED, &job_id.to_le_bytes()],
        &AI_PRECOMPILES_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

pub fn create_initialize_instruction(admin: &Pubkey) -> Instruction {
    let (registry_pda, _) = find_ai_registry();

    let mut data = vec![IX_INITIALIZE];
    admin.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(registry_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_register_model_instruction(
    provider: &Pubkey,
    model_hash: [u8; 32],
    model_type: u8,
    max_input_size: u32,
    cost_per_inference: u64,
    uri: &str,
) -> Instruction {
    let (registry_pda, _) = find_ai_registry();

    let params = RegisterModelParams {
        model_hash,
        model_type,
        max_input_size,
        cost_per_inference,
        uri: uri.to_string(),
    };
    let mut data = vec![IX_REGISTER_MODEL];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*provider, true),
            AccountMeta::new(registry_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_request_inference_instruction(
    requester: &Pubkey,
    model_id: u64,
    input_hash: [u8; 32],
    max_cost: u64,
    job_id: u64,
) -> Instruction {
    let (registry_pda, _) = find_ai_registry();
    let (job_pda, _) = find_ai_job(job_id);

    let params = RequestInferenceParams {
        model_id,
        input_hash,
        max_cost,
    };
    let mut data = vec![IX_REQUEST_INFERENCE];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*requester, true),
            AccountMeta::new_readonly(registry_pda, false),
            AccountMeta::new(job_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_submit_result_instruction(
    provider: &Pubkey,
    job_id: u64,
    output_hash: [u8; 32],
    proof: Vec<u8>,
) -> Instruction {
    let (job_pda, _) = find_ai_job(job_id);
    let (result_pda, _) = find_ai_result(job_id);

    let params = SubmitResultParams {
        job_id,
        output_hash,
        proof,
    };
    let mut data = vec![IX_SUBMIT_RESULT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*provider, true),
            AccountMeta::new(job_pda, false),
            AccountMeta::new(result_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_verify_result_instruction(
    verifier: &Pubkey,
    job_id: u64,
) -> Instruction {
    let (job_pda, _) = find_ai_job(job_id);
    let (result_pda, _) = find_ai_result(job_id);

    let params = VerifyResultParams { job_id };
    let mut data = vec![IX_VERIFY_RESULT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*verifier, true),
            AccountMeta::new(job_pda, false),
            AccountMeta::new(result_pda, false),
        ],
        data,
    }
}

pub fn create_dispute_result_instruction(
    disputer: &Pubkey,
    job_id: u64,
    counter_proof: Vec<u8>,
) -> Instruction {
    let (job_pda, _) = find_ai_job(job_id);
    let (result_pda, _) = find_ai_result(job_id);

    let params = DisputeResultParams {
        job_id,
        counter_proof,
    };
    let mut data = vec![IX_DISPUTE_RESULT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: AI_PRECOMPILES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*disputer, true),
            AccountMeta::new(job_pda, false),
            AccountMeta::new(result_pda, false),
        ],
        data,
    }
}
