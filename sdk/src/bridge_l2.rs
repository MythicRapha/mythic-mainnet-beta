//! L2 Bridge instruction builders — mint wrapped tokens, burn for withdrawal.

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_MINT_WRAPPED: u8 = 1;
const IX_BURN_WRAPPED: u8 = 2;
const IX_UPDATE_RELAYER: u8 = 3;

// ── Param Structs ───────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct InitializeParams {
    relayer: Pubkey,
}

#[derive(BorshSerialize)]
struct MintWrappedParams {
    amount: u64,
    l1_token_mint: [u8; 32],
    deposit_nonce: u64,
}

#[derive(BorshSerialize)]
struct BurnWrappedParams {
    amount: u64,
    l1_recipient: [u8; 32],
}

#[derive(BorshSerialize)]
struct UpdateRelayerParams {
    new_relayer: Pubkey,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_l2_bridge_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], &BRIDGE_L2_PROGRAM_ID)
}

pub fn find_wrapped_mint(l1_token_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[WRAPPED_MINT_SEED, l1_token_mint.as_ref()],
        &BRIDGE_L2_PROGRAM_ID,
    )
}

pub fn find_mint_authority() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &BRIDGE_L2_PROGRAM_ID)
}

pub fn find_burn_record(nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[BURN_RECORD_SEED, &nonce.to_le_bytes()],
        &BRIDGE_L2_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

pub fn create_initialize_instruction(admin: &Pubkey, relayer: &Pubkey) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();

    let params = InitializeParams {
        relayer: *relayer,
    };
    let mut data = vec![IX_INITIALIZE];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_mint_wrapped_instruction(
    relayer: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
    l1_token_mint: &Pubkey,
    deposit_nonce: u64,
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();
    let (wrapped_mint, _) = find_wrapped_mint(l1_token_mint);
    let (mint_authority, _) = find_mint_authority();

    let recipient_ata =
        spl_associated_token_account::get_associated_token_address(recipient, &wrapped_mint);

    let params = MintWrappedParams {
        amount,
        l1_token_mint: l1_token_mint.to_bytes(),
        deposit_nonce,
    };
    let mut data = vec![IX_MINT_WRAPPED];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*relayer, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(wrapped_mint, false),
            AccountMeta::new(mint_authority, false),
            AccountMeta::new(*recipient, false),
            AccountMeta::new(recipient_ata, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(
                spl_associated_token_account::id(),
                false,
            ),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_burn_wrapped_instruction(
    burner: &Pubkey,
    amount: u64,
    l1_token_mint: &Pubkey,
    l1_recipient: [u8; 32],
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();
    let (wrapped_mint, _) = find_wrapped_mint(l1_token_mint);

    let burner_ata =
        spl_associated_token_account::get_associated_token_address(burner, &wrapped_mint);

    let params = BurnWrappedParams {
        amount,
        l1_recipient,
    };
    let mut data = vec![IX_BURN_WRAPPED];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*burner, true),
            AccountMeta::new(burner_ata, false),
            AccountMeta::new(wrapped_mint, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

pub fn create_update_relayer_instruction(
    admin: &Pubkey,
    new_relayer: &Pubkey,
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();

    let params = UpdateRelayerParams {
        new_relayer: *new_relayer,
    };
    let mut data = vec![IX_UPDATE_RELAYER];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}
