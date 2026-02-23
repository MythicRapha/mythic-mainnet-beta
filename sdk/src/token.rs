//! MYTH Token instruction builders — fee distribution, burn, and config management.

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_DISTRIBUTE_FEES: u8 = 1;
const IX_BURN: u8 = 2;
const IX_UPDATE_CONFIG: u8 = 3;

// ── Param Structs ───────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct InitializeParams {
    foundation_wallet: Pubkey,
    sequencer_wallet: Pubkey,
    burn_bps: u16,
    sequencer_bps: u16,
    foundation_bps: u16,
}

#[derive(BorshSerialize)]
struct DistributeFeesParams {
    amount: u64,
}

#[derive(BorshSerialize)]
struct BurnParams {
    amount: u64,
}

#[derive(BorshSerialize)]
struct UpdateConfigParams {
    new_foundation_wallet: Option<Pubkey>,
    new_sequencer_wallet: Option<Pubkey>,
    new_burn_bps: Option<u16>,
    new_sequencer_bps: Option<u16>,
    new_foundation_bps: Option<u16>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_fee_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FEE_CONFIG_SEED], &MYTH_TOKEN_PROGRAM_ID)
}

pub fn find_fee_vault() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FEE_VAULT_SEED], &MYTH_TOKEN_PROGRAM_ID)
}

// ── Instruction Builders ────────────────────────────────────────────────────

pub fn create_initialize_instruction(
    admin: &Pubkey,
    foundation_wallet: &Pubkey,
    sequencer_wallet: &Pubkey,
) -> Instruction {
    let (config_pda, _) = find_fee_config();
    let (vault_pda, _) = find_fee_vault();

    let params = InitializeParams {
        foundation_wallet: *foundation_wallet,
        sequencer_wallet: *sequencer_wallet,
        burn_bps: FEE_BURN_BPS,
        sequencer_bps: FEE_SEQUENCER_BPS,
        foundation_bps: FEE_FOUNDATION_BPS,
    };
    let mut data = vec![IX_INITIALIZE];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_distribute_fees_instruction(
    payer: &Pubkey,
    foundation_wallet: &Pubkey,
    sequencer_wallet: &Pubkey,
    amount: u64,
) -> Instruction {
    let (config_pda, _) = find_fee_config();
    let (vault_pda, _) = find_fee_vault();

    let params = DistributeFeesParams { amount };
    let mut data = vec![IX_DISTRIBUTE_FEES];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new(*foundation_wallet, false),
            AccountMeta::new(*sequencer_wallet, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_burn_instruction(
    burner: &Pubkey,
    amount: u64,
) -> Instruction {
    let (config_pda, _) = find_fee_config();

    let params = BurnParams { amount };
    let mut data = vec![IX_BURN];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*burner, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_update_config_instruction(
    admin: &Pubkey,
    new_foundation_wallet: Option<Pubkey>,
    new_sequencer_wallet: Option<Pubkey>,
    new_burn_bps: Option<u16>,
    new_sequencer_bps: Option<u16>,
    new_foundation_bps: Option<u16>,
) -> Instruction {
    let (config_pda, _) = find_fee_config();

    let params = UpdateConfigParams {
        new_foundation_wallet,
        new_sequencer_wallet,
        new_burn_bps,
        new_sequencer_bps,
        new_foundation_bps,
    };
    let mut data = vec![IX_UPDATE_CONFIG];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}
