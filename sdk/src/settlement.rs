//! Settlement instruction builders — state root posting, verification, finalization.

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
const IX_FINALIZE_STATE_ROOT: u8 = 3;
const IX_UPDATE_CONFIG: u8 = 4;

// ── Param Structs ───────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct InitializeParams {
    sequencer: Pubkey,
    challenge_period: i64,
}

#[derive(BorshSerialize)]
struct PostStateRootParams {
    slot: u64,
    state_root: [u8; 32],
    transaction_root: [u8; 32],
    num_transactions: u64,
}

#[derive(BorshSerialize)]
struct ChallengeStateRootParams {
    slot: u64,
    fraud_proof: Vec<u8>,
}

#[derive(BorshSerialize)]
struct FinalizeStateRootParams {
    slot: u64,
}

#[derive(BorshSerialize)]
struct UpdateConfigParams {
    new_sequencer: Option<Pubkey>,
    new_challenge_period: Option<i64>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_settlement_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], &SETTLEMENT_PROGRAM_ID)
}

pub fn find_state_root(slot: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[STATE_ROOT_SEED, &slot.to_le_bytes()],
        &SETTLEMENT_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

pub fn create_initialize_instruction(
    admin: &Pubkey,
    sequencer: &Pubkey,
    challenge_period: i64,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();

    let params = InitializeParams {
        sequencer: *sequencer,
        challenge_period,
    };
    let mut data = vec![IX_INITIALIZE];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_post_state_root_instruction(
    sequencer: &Pubkey,
    payer: &Pubkey,
    slot: u64,
    state_root: [u8; 32],
    transaction_root: [u8; 32],
    num_transactions: u64,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(slot);

    let params = PostStateRootParams {
        slot,
        state_root,
        transaction_root,
        num_transactions,
    };
    let mut data = vec![IX_POST_STATE_ROOT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*sequencer, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(state_root_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_challenge_state_root_instruction(
    challenger: &Pubkey,
    slot: u64,
    fraud_proof: Vec<u8>,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(slot);

    let params = ChallengeStateRootParams { slot, fraud_proof };
    let mut data = vec![IX_CHALLENGE_STATE_ROOT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*challenger, true),
            AccountMeta::new(state_root_pda, false),
            AccountMeta::new_readonly(config_pda, false),
        ],
        data,
    }
}

pub fn create_finalize_state_root_instruction(
    payer: &Pubkey,
    slot: u64,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();
    let (state_root_pda, _) = find_state_root(slot);

    let params = FinalizeStateRootParams { slot };
    let mut data = vec![IX_FINALIZE_STATE_ROOT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(state_root_pda, false),
            AccountMeta::new_readonly(config_pda, false),
        ],
        data,
    }
}

pub fn create_update_config_instruction(
    admin: &Pubkey,
    new_sequencer: Option<Pubkey>,
    new_challenge_period: Option<i64>,
) -> Instruction {
    let (config_pda, _) = find_settlement_config();

    let params = UpdateConfigParams {
        new_sequencer,
        new_challenge_period,
    };
    let mut data = vec![IX_UPDATE_CONFIG];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: SETTLEMENT_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}
