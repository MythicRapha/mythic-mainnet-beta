//! Compute Marketplace instruction builders — provider registration, job lifecycle.

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_REGISTER_PROVIDER: u8 = 0;
const IX_UPDATE_PROVIDER: u8 = 1;
const IX_CREATE_JOB: u8 = 2;
const IX_ACCEPT_JOB: u8 = 3;
const IX_SUBMIT_RESULT: u8 = 4;
const IX_COMPLETE_JOB: u8 = 5;
const IX_CANCEL_JOB: u8 = 6;

// ── Param Structs ───────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct RegisterProviderParams {
    gpu_vram_mb: u32,
    cpu_cores: u16,
    storage_gb: u32,
    price_per_cu: u64,
    uri: String,
}

#[derive(BorshSerialize)]
struct UpdateProviderParams {
    price_per_cu: Option<u64>,
    available: Option<bool>,
}

#[derive(BorshSerialize)]
struct CreateJobParams {
    compute_units: u64,
    max_cost: u64,
    input_hash: [u8; 32],
    timeout_slots: u64,
}

#[derive(BorshSerialize)]
struct SubmitResultParams {
    output_hash: [u8; 32],
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_provider(owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PROVIDER_SEED, owner.as_ref()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

pub fn find_compute_job(job_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[COMPUTE_JOB_SEED, &job_id.to_le_bytes()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

pub fn find_escrow(job_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ESCROW_SEED, &job_id.to_le_bytes()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

pub fn create_register_provider_instruction(
    owner: &Pubkey,
    gpu_vram_mb: u32,
    cpu_cores: u16,
    storage_gb: u32,
    price_per_cu: u64,
    uri: &str,
) -> Instruction {
    let (provider_pda, _) = find_provider(owner);

    let params = RegisterProviderParams {
        gpu_vram_mb,
        cpu_cores,
        storage_gb,
        price_per_cu,
        uri: uri.to_string(),
    };
    let mut data = vec![IX_REGISTER_PROVIDER];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new(provider_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_update_provider_instruction(
    owner: &Pubkey,
    price_per_cu: Option<u64>,
    available: Option<bool>,
) -> Instruction {
    let (provider_pda, _) = find_provider(owner);

    let params = UpdateProviderParams {
        price_per_cu,
        available,
    };
    let mut data = vec![IX_UPDATE_PROVIDER];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new(provider_pda, false),
        ],
        data,
    }
}

pub fn create_job_instruction(
    requester: &Pubkey,
    job_id: u64,
    compute_units: u64,
    max_cost: u64,
    input_hash: [u8; 32],
    timeout_slots: u64,
) -> Instruction {
    let (job_pda, _) = find_compute_job(job_id);
    let (escrow_pda, _) = find_escrow(job_id);

    let params = CreateJobParams {
        compute_units,
        max_cost,
        input_hash,
        timeout_slots,
    };
    let mut data = vec![IX_CREATE_JOB];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*requester, true),
            AccountMeta::new(job_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_accept_job_instruction(
    provider_owner: &Pubkey,
    job_id: u64,
) -> Instruction {
    let (job_pda, _) = find_compute_job(job_id);
    let (provider_pda, _) = find_provider(provider_owner);

    let mut data = vec![IX_ACCEPT_JOB];
    job_id.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*provider_owner, true),
            AccountMeta::new(provider_pda, false),
            AccountMeta::new(job_pda, false),
        ],
        data,
    }
}

pub fn create_submit_result_instruction(
    provider_owner: &Pubkey,
    job_id: u64,
    output_hash: [u8; 32],
) -> Instruction {
    let (job_pda, _) = find_compute_job(job_id);

    let params = SubmitResultParams { output_hash };
    let mut data = vec![IX_SUBMIT_RESULT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*provider_owner, true),
            AccountMeta::new(job_pda, false),
        ],
        data,
    }
}

pub fn create_complete_job_instruction(
    requester: &Pubkey,
    provider_owner: &Pubkey,
    job_id: u64,
) -> Instruction {
    let (job_pda, _) = find_compute_job(job_id);
    let (escrow_pda, _) = find_escrow(job_id);
    let (provider_pda, _) = find_provider(provider_owner);

    let mut data = vec![IX_COMPLETE_JOB];
    job_id.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*requester, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(job_pda, false),
            AccountMeta::new(*provider_owner, false),
            AccountMeta::new_readonly(provider_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_cancel_job_instruction(
    requester: &Pubkey,
    job_id: u64,
) -> Instruction {
    let (job_pda, _) = find_compute_job(job_id);
    let (escrow_pda, _) = find_escrow(job_id);

    let mut data = vec![IX_CANCEL_JOB];
    job_id.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*requester, true),
            AccountMeta::new(job_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}
