//! Settlement instruction builders — state root posting, verification, finalization.
//!
//! Matches: programs/settlement/src/lib.rs
//! Program ID: MythSett1ement11111111111111111111111111111
//!
//! Instructions:
//!   0 = Initialize
//!   1 = PostStateRoot
//!   2 = ChallengeStateRoot
//!   3 = ResolveChallenge
//!   4 = FinalizeStateRoot
//!   5 = UpdateConfig
//!   6 = GetLatestFinalized

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_POST_STATE_ROOT: u8 = 1;
const IX_CHALLENGE_STATE_ROOT: u8 = 2;
const IX_RESOLVE_CHALLENGE: u8 = 3;
const IX_FINALIZE_STATE_ROOT: u8 = 4;
const IX_UPDATE_CONFIG: u8 = 5;
const IX_GET_LATEST_FINALIZED: u8 = 6;

// ── Param Structs (exact Borsh match to program) ────────────────────────────

/// FraudProofType matching the program's on-chain enum.
#[derive(BorshSerialize, Clone, Copy)]
#[repr(u8)]
pub enum FraudProofType {
    InvalidStateTransition = 0,
    InvalidMerkleProof = 1,
    InvalidAIAttestation = 2,
    DoubleSequencing = 3,
}

#[derive(BorshSerialize)]
pub struct InitializeArgs {
    pub challenge_period_slots: u64,
    pub l2_chain_id: [u8; 16],
    pub min_challenger_bond: u64,
}

#[derive(BorshSerialize)]
pub struct PostStateRootArgs {
    pub l2_slot: u64,
    pub state_root: [u8; 32],
    pub transaction_count: u32,
    pub transaction_batch_hash: [u8; 32],
    pub ai_attestation_count: u16,
    pub previous_state_root: [u8; 32],
}

#[derive(BorshSerialize)]
pub struct ChallengeStateRootArgs {
    pub l2_slot: u64,
    pub fraud_proof_type: FraudProofType,
    pub proof_data: Vec<u8>,
}

#[derive(BorshSerialize)]
pub struct ResolveChallengeArgs {
    pub l2_slot: u64,
    pub challenger: Pubkey,
    pub is_valid: bool,
}

#[derive(BorshSerialize)]
pub struct FinalizeStateRootArgs {
    pub l2_slot: u64,
}

#[derive(BorshSerialize)]
pub struct UpdateConfigArgs {
    pub sequencer: Option<Pubkey>,
    pub challenge_period_slots: Option<u64>,
    pub min_challenger_bond: Option<u64>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_settlement_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], &SETTLEMENT_PROGRAM_ID)
}

pub fn find_state_root(l2_slot: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[STATE_ROOT_SEED, &l2_slot.to_le_bytes()],
        &SETTLEMENT_PROGRAM_ID,
    )
}

pub fn find_challenge(l2_slot: u64, challenger: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CHALLENGE_SEED, &l2_slot.to_le_bytes(), challenger.as_ref()],
        &SETTLEMENT_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

/// Initialize the settlement program.
///
/// Accounts:
///   0. `[signer, writable]` admin (payer)
///   1. `[]` sequencer
///   2. `[writable]` settlement_config PDA
///   3. `[]` system_program
pub fn create_initialize_instruction(
    admin: &Pubkey,
    sequencer: &Pubkey,
    challenge_period_slots: u64,
    l2_chain_id: [u8; 16],
    min_challenger_bond: u64,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();

    let args = InitializeArgs {
        challenge_period_slots,
        l2_chain_id,
        min_challenger_bond,
    };
    let mut data = vec![IX_INITIALIZE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(*sequencer, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Post a new state root.
///
/// Accounts:
///   0. `[signer, writable]` sequencer (payer)
///   1. `[writable]` settlement_config PDA
///   2. `[writable]` state_root PDA (seeds: ["state_root", l2_slot_bytes])
///   3. `[]` system_program
pub fn create_post_state_root_instruction(
    sequencer: &Pubkey,
    l2_slot: u64,
    state_root: [u8; 32],
    transaction_count: u32,
    transaction_batch_hash: [u8; 32],
    ai_attestation_count: u16,
    previous_state_root: [u8; 32],
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(l2_slot);

    let args = PostStateRootArgs {
        l2_slot,
        state_root,
        transaction_count,
        transaction_batch_hash,
        ai_attestation_count,
        previous_state_root,
    };
    let mut data = vec![IX_POST_STATE_ROOT];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*sequencer, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(state_root_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Challenge a state root.
///
/// Accounts:
///   0. `[signer, writable]` challenger (payer)
///   1. `[]` settlement_config PDA
///   2. `[writable]` state_root PDA
///   3. `[writable]` challenge PDA (seeds: ["challenge", l2_slot_bytes, challenger])
///   4. `[]` system_program
pub fn create_challenge_state_root_instruction(
    challenger: &Pubkey,
    l2_slot: u64,
    fraud_proof_type: FraudProofType,
    proof_data: Vec<u8>,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(l2_slot);
    let (challenge_pda, _) = find_challenge(l2_slot, challenger);

    let args = ChallengeStateRootArgs {
        l2_slot,
        fraud_proof_type,
        proof_data,
    };
    let mut data = vec![IX_CHALLENGE_STATE_ROOT];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*challenger, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(state_root_pda, false),
            AccountMeta::new(challenge_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Resolve a challenge (admin only).
///
/// Accounts:
///   0. `[signer]` admin
///   1. `[]` settlement_config PDA
///   2. `[writable]` state_root PDA
///   3. `[writable]` challenge PDA
///   4. `[writable]` challenger account
pub fn create_resolve_challenge_instruction(
    admin: &Pubkey,
    l2_slot: u64,
    challenger: &Pubkey,
    is_valid: bool,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(l2_slot);
    let (challenge_pda, _) = find_challenge(l2_slot, challenger);

    let args = ResolveChallengeArgs {
        l2_slot,
        challenger: *challenger,
        is_valid,
    };
    let mut data = vec![IX_RESOLVE_CHALLENGE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(state_root_pda, false),
            AccountMeta::new(challenge_pda, false),
            AccountMeta::new(*challenger, false),
        ],
        data,
    }
}

/// Finalize a state root after the challenge period.
///
/// Accounts:
///   0. `[]` caller (anyone)
///   1. `[writable]` settlement_config PDA
///   2. `[writable]` state_root PDA
pub fn create_finalize_state_root_instruction(
    caller: &Pubkey,
    l2_slot: u64,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(l2_slot);

    let args = FinalizeStateRootArgs { l2_slot };
    let mut data = vec![IX_FINALIZE_STATE_ROOT];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*caller, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(state_root_pda, false),
        ],
        data,
    }
}

/// Update settlement configuration (admin only).
///
/// Accounts:
///   0. `[signer]` admin
///   1. `[writable]` settlement_config PDA
pub fn create_update_config_instruction(
    admin: &Pubkey,
    sequencer: Option<Pubkey>,
    challenge_period_slots: Option<u64>,
    min_challenger_bond: Option<u64>,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();

    let args = UpdateConfigArgs {
        sequencer,
        challenge_period_slots,
        min_challenger_bond,
    };
    let mut data = vec![IX_UPDATE_CONFIG];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}

/// Get latest finalized state root (read-only, logs result).
///
/// Accounts:
///   0. `[]` settlement_config PDA
pub fn create_get_latest_finalized_instruction() -> Instruction {
    let (config_pda, _) = find_settlement_config();

    let data = vec![IX_GET_LATEST_FINALIZED];

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(config_pda, false),
        ],
        data,
    }
}
