//! Compute Marketplace instruction builders — provider registration, job lifecycle.
//!
//! Matches: programs/compute-market/src/lib.rs
//! Program ID: AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh
//!
//! Instructions:
//!   0  = Initialize
//!   1  = RegisterProvider
//!   2  = UpdateProvider
//!   3  = DeactivateProvider
//!   4  = WithdrawStake
//!   5  = RequestCompute
//!   6  = AcceptJob
//!   7  = SubmitProof
//!   8  = VerifyAndRelease
//!   9  = DisputeLease
//!   10 = ResolveDispute
//!   11 = SlashProvider

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_REGISTER_PROVIDER: u8 = 1;
const IX_UPDATE_PROVIDER: u8 = 2;
const IX_DEACTIVATE_PROVIDER: u8 = 3;
const IX_WITHDRAW_STAKE: u8 = 4;
const IX_REQUEST_COMPUTE: u8 = 5;
const IX_ACCEPT_JOB: u8 = 6;
const IX_SUBMIT_PROOF: u8 = 7;
const IX_VERIFY_AND_RELEASE: u8 = 8;
const IX_DISPUTE_LEASE: u8 = 9;
const IX_RESOLVE_DISPUTE: u8 = 10;
const IX_SLASH_PROVIDER: u8 = 11;

// ── Param Structs (exact Borsh match to program) ────────────────────────────

/// JobType enum matching the program's on-chain enum.
#[derive(BorshSerialize, Clone, Copy)]
#[repr(u8)]
pub enum JobType {
    Inference = 0,
    Training = 1,
    GeneralCompute = 2,
    Storage = 3,
}

#[derive(BorshSerialize)]
pub struct InitializeArgs {
    pub min_provider_stake: u64,
    pub foundation_wallet: Pubkey,
    pub protocol_fee_bps: u16,
}

#[derive(BorshSerialize)]
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

#[derive(BorshSerialize)]
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

#[derive(BorshSerialize)]
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

#[derive(BorshSerialize)]
pub struct SubmitProofArgs {
    pub output_hash: [u8; 32],
    pub proof_data: Vec<u8>,
}

#[derive(BorshSerialize)]
pub struct ResolveDisputeArgs {
    pub provider_at_fault: bool,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_market_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MARKET_CONFIG_SEED], &COMPUTE_MARKET_PROGRAM_ID)
}

pub fn find_provider(authority: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PROVIDER_SEED, authority.as_ref()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

pub fn find_compute_request(nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[REQUEST_SEED, &nonce.to_le_bytes()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

pub fn find_lease(request_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[LEASE_SEED, request_key.as_ref()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

pub fn find_dispute(lease_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[DISPUTE_SEED, lease_key.as_ref()],
        &COMPUTE_MARKET_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

/// Initialize the compute marketplace.
///
/// Accounts:
///   0. `[signer, writable]` admin (payer)
///   1. `[writable]` market_config PDA
///   2. `[]` system_program
pub fn create_initialize_instruction(
    admin: &Pubkey,
    min_provider_stake: u64,
    foundation_wallet: &Pubkey,
    protocol_fee_bps: u16,
) -> Instruction {
    let (config_pda, _) = find_market_config();

    let args = InitializeArgs {
        min_provider_stake,
        foundation_wallet: *foundation_wallet,
        protocol_fee_bps,
    };
    let mut data = vec![IX_INITIALIZE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Register a compute provider.
///
/// Accounts:
///   0. `[signer, writable]` authority (payer)
///   1. `[writable]` provider PDA (seeds: ["provider", authority])
///   2. `[]` market_config PDA
///   3. `[writable]` stake_vault
///   4. `[]` system_program
pub fn create_register_provider_instruction(
    authority: &Pubkey,
    stake_vault: &Pubkey,
    args: RegisterProviderArgs,
) -> Instruction {
    let (provider_pda, _) = find_provider(authority);
    let (config_pda, _) = find_market_config();

    let mut data = vec![IX_REGISTER_PROVIDER];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(provider_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(*stake_vault, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Update provider configuration.
///
/// Accounts:
///   0. `[signer]` authority
///   1. `[writable]` provider PDA
pub fn create_update_provider_instruction(
    authority: &Pubkey,
    args: UpdateProviderArgs,
) -> Instruction {
    let (provider_pda, _) = find_provider(authority);

    let mut data = vec![IX_UPDATE_PROVIDER];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(provider_pda, false),
        ],
        data,
    }
}

/// Deactivate a provider.
///
/// Accounts:
///   0. `[signer]` authority
///   1. `[writable]` provider PDA
pub fn create_deactivate_provider_instruction(authority: &Pubkey) -> Instruction {
    let (provider_pda, _) = find_provider(authority);

    let data = vec![IX_DEACTIVATE_PROVIDER];

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(provider_pda, false),
        ],
        data,
    }
}

/// Withdraw stake after cooldown.
///
/// Accounts:
///   0. `[signer]` authority
///   1. `[writable]` provider PDA
///   2. `[writable]` stake_vault
pub fn create_withdraw_stake_instruction(
    authority: &Pubkey,
    stake_vault: &Pubkey,
) -> Instruction {
    let (provider_pda, _) = find_provider(authority);

    let data = vec![IX_WITHDRAW_STAKE];

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(provider_pda, false),
            AccountMeta::new(*stake_vault, false),
        ],
        data,
    }
}

/// Request compute resources.
///
/// Accounts:
///   0. `[signer, writable]` requester (payer)
///   1. `[writable]` compute_request PDA (seeds: ["request", nonce_bytes])
///   2. `[writable]` market_config PDA
///   3. `[writable]` escrow_vault
///   4. `[]` system_program
pub fn create_request_compute_instruction(
    requester: &Pubkey,
    nonce: u64,
    escrow_vault: &Pubkey,
    args: RequestComputeArgs,
) -> Instruction {
    let (request_pda, _) = find_compute_request(nonce);
    let (config_pda, _) = find_market_config();

    let mut data = vec![IX_REQUEST_COMPUTE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
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

/// Accept a compute job.
///
/// Accounts:
///   0. `[signer, writable]` provider_authority (payer)
///   1. `[writable]` provider PDA
///   2. `[writable]` compute_request PDA
///   3. `[writable]` lease PDA (seeds: ["lease", request_key])
///   4. `[]` system_program
pub fn create_accept_job_instruction(
    provider_authority: &Pubkey,
    request_key: &Pubkey,
) -> Instruction {
    let (provider_pda, _) = find_provider(provider_authority);
    let (lease_pda, _) = find_lease(request_key);

    let data = vec![IX_ACCEPT_JOB];

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*provider_authority, true),
            AccountMeta::new(provider_pda, false),
            AccountMeta::new(*request_key, false),
            AccountMeta::new(lease_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Submit proof of work for a lease.
///
/// Accounts:
///   0. `[signer]` provider_authority
///   1. `[writable]` lease PDA
pub fn create_submit_proof_instruction(
    provider_authority: &Pubkey,
    lease_key: &Pubkey,
    output_hash: [u8; 32],
    proof_data: Vec<u8>,
) -> Instruction {
    let args = SubmitProofArgs {
        output_hash,
        proof_data,
    };
    let mut data = vec![IX_SUBMIT_PROOF];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*provider_authority, true),
            AccountMeta::new(*lease_key, false),
        ],
        data,
    }
}

/// Verify proof and release payment (crank).
///
/// Accounts:
///   0. `[signer]` crank
///   1. `[writable]` lease PDA
///   2. `[writable]` compute_request PDA
///   3. `[writable]` provider PDA
///   4. `[writable]` escrow_vault
///   5. `[writable]` provider_wallet (= provider authority)
///   6. `[]` market_config PDA
///   7. `[writable]` foundation account
///   8. `[writable]` burn address
///   (optional) 9. `[writable]` requester (for excess refund)
pub fn create_verify_and_release_instruction(
    crank: &Pubkey,
    lease_key: &Pubkey,
    request_key: &Pubkey,
    provider_key: &Pubkey,
    escrow_vault: &Pubkey,
    provider_wallet: &Pubkey,
    config_key: &Pubkey,
    foundation: &Pubkey,
    burn_address: &Pubkey,
    requester: Option<&Pubkey>,
) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(*crank, true),
        AccountMeta::new(*lease_key, false),
        AccountMeta::new(*request_key, false),
        AccountMeta::new(*provider_key, false),
        AccountMeta::new(*escrow_vault, false),
        AccountMeta::new(*provider_wallet, false),
        AccountMeta::new_readonly(*config_key, false),
        AccountMeta::new(*foundation, false),
        AccountMeta::new(*burn_address, false),
    ];
    if let Some(req) = requester {
        accounts.push(AccountMeta::new(*req, false));
    }

    let data = vec![IX_VERIFY_AND_RELEASE];

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts,
        data,
    }
}

/// Dispute a lease.
///
/// Accounts:
///   0. `[signer, writable]` requester (payer)
///   1. `[writable]` lease PDA
///   2. `[writable]` dispute PDA (seeds: ["dispute", lease_key])
///   3. `[]` market_config PDA
///   4. `[]` system_program
pub fn create_dispute_lease_instruction(
    requester: &Pubkey,
    lease_key: &Pubkey,
) -> Instruction {
    let (dispute_pda, _) = find_dispute(lease_key);
    let (config_pda, _) = find_market_config();

    let data = vec![IX_DISPUTE_LEASE];

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*requester, true),
            AccountMeta::new(*lease_key, false),
            AccountMeta::new(dispute_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Resolve a dispute (admin only).
///
/// Accounts:
///   0. `[signer]` admin
///   1. `[]` market_config PDA
///   2. `[writable]` dispute PDA
///   3. `[writable]` lease PDA
///   4. `[writable]` compute_request PDA
///   5. `[writable]` provider PDA
///   6. `[writable]` escrow_vault
///   7. `[writable]` requester account
pub fn create_resolve_dispute_instruction(
    admin: &Pubkey,
    config_key: &Pubkey,
    dispute_key: &Pubkey,
    lease_key: &Pubkey,
    request_key: &Pubkey,
    provider_key: &Pubkey,
    escrow_vault: &Pubkey,
    requester: &Pubkey,
    provider_at_fault: bool,
) -> Instruction {
    let args = ResolveDisputeArgs { provider_at_fault };
    let mut data = vec![IX_RESOLVE_DISPUTE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new_readonly(*config_key, false),
            AccountMeta::new(*dispute_key, false),
            AccountMeta::new(*lease_key, false),
            AccountMeta::new(*request_key, false),
            AccountMeta::new(*provider_key, false),
            AccountMeta::new(*escrow_vault, false),
            AccountMeta::new(*requester, false),
        ],
        data,
    }
}

/// Slash a provider for timeout.
///
/// Accounts:
///   0. `[signer]` crank
///   1. `[writable]` lease PDA
///   2. `[writable]` compute_request PDA
///   3. `[writable]` provider PDA
///   4. `[writable]` escrow_vault
///   5. `[writable]` requester account
pub fn create_slash_provider_instruction(
    crank: &Pubkey,
    lease_key: &Pubkey,
    request_key: &Pubkey,
    provider_key: &Pubkey,
    escrow_vault: &Pubkey,
    requester: &Pubkey,
) -> Instruction {
    let data = vec![IX_SLASH_PROVIDER];

    Instruction {
        program_id: COMPUTE_MARKET_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*crank, true),
            AccountMeta::new(*lease_key, false),
            AccountMeta::new(*request_key, false),
            AccountMeta::new(*provider_key, false),
            AccountMeta::new(*escrow_vault, false),
            AccountMeta::new(*requester, false),
        ],
        data,
    }
}
