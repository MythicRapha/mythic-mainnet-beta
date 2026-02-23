//! L2 Bridge instruction builders — wrapped token management, mint/burn lifecycle.
//!
//! Matches: programs/bridge-l2/src/lib.rs
//! Program ID: MythBrdgL2111111111111111111111111111111111
//!
//! Instructions:
//!   0 = Initialize
//!   1 = RegisterWrappedToken
//!   2 = MintWrapped
//!   3 = BurnWrapped
//!   4 = UpdateConfig

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
    sysvar,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_REGISTER_WRAPPED_TOKEN: u8 = 1;
const IX_MINT_WRAPPED: u8 = 2;
const IX_BURN_WRAPPED: u8 = 3;
const IX_UPDATE_CONFIG: u8 = 4;

// ── Param Structs (exact Borsh match to program) ────────────────────────────

#[derive(BorshSerialize)]
pub struct InitializeParams {
    pub relayer: Pubkey,
}

#[derive(BorshSerialize)]
pub struct RegisterWrappedTokenParams {
    pub l1_mint: Pubkey,
    pub decimals: u8,
}

#[derive(BorshSerialize)]
pub struct MintWrappedParams {
    pub l1_deposit_nonce: u64,
    pub recipient: Pubkey,
    pub amount: u64,
    pub l1_mint: Pubkey,
    pub l1_tx_signature: [u8; 64],
}

#[derive(BorshSerialize)]
pub struct BurnWrappedParams {
    pub amount: u64,
    pub l1_recipient: [u8; 32],
    pub l1_mint: Pubkey,
}

#[derive(BorshSerialize)]
pub struct UpdateConfigParams {
    pub new_relayer: Option<Pubkey>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_l2_bridge_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], &BRIDGE_L2_PROGRAM_ID)
}

pub fn find_wrapped_token_info(l1_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[WRAPPED_MINT_SEED, l1_mint.as_ref()],
        &BRIDGE_L2_PROGRAM_ID,
    )
}

pub fn find_l2_mint(l1_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[L2_MINT_SEED, l1_mint.as_ref()],
        &BRIDGE_L2_PROGRAM_ID,
    )
}

pub fn find_processed_deposit(l1_deposit_nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PROCESSED_DEPOSIT_SEED, &l1_deposit_nonce.to_le_bytes()],
        &BRIDGE_L2_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

/// Initialize the L2 bridge.
///
/// Accounts:
///   0. `[signer, writable]` admin (payer)
///   1. `[writable]` l2_bridge_config PDA
///   2. `[]` system_program
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

/// Register a new wrapped token for an L1 mint.
///
/// Accounts:
///   0. `[signer, writable]` admin (payer)
///   1. `[]` l2_bridge_config PDA
///   2. `[writable]` wrapped_token_info PDA (seeds: ["wrapped_mint", l1_mint])
///   3. `[writable]` l2_mint account (SPL mint, PDA seeds: ["mint", l1_mint])
///   4. `[]` token_program
///   5. `[]` system_program
///   6. `[]` rent sysvar
pub fn create_register_wrapped_token_instruction(
    admin: &Pubkey,
    l1_mint: &Pubkey,
    decimals: u8,
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();
    let (wrapped_info_pda, _) = find_wrapped_token_info(l1_mint);
    let (l2_mint_pda, _) = find_l2_mint(l1_mint);

    let params = RegisterWrappedTokenParams {
        l1_mint: *l1_mint,
        decimals,
    };
    let mut data = vec![IX_REGISTER_WRAPPED_TOKEN];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(wrapped_info_pda, false),
            AccountMeta::new(l2_mint_pda, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(sysvar::rent::id(), false),
        ],
        data,
    }
}

/// Mint wrapped tokens on L2 for a processed L1 deposit.
///
/// Accounts:
///   0. `[signer]` relayer
///   1. `[signer, writable]` payer
///   2. `[]` l2_bridge_config PDA
///   3. `[]` wrapped_token_info PDA
///   4. `[writable]` l2_mint account
///   5. `[writable]` recipient token account (ATA)
///   6. `[writable]` processed_deposit PDA
///   7. `[]` token_program
///   8. `[]` system_program
pub fn create_mint_wrapped_instruction(
    relayer: &Pubkey,
    payer: &Pubkey,
    recipient: &Pubkey,
    l1_deposit_nonce: u64,
    amount: u64,
    l1_mint: &Pubkey,
    l1_tx_signature: [u8; 64],
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();
    let (wrapped_info_pda, _) = find_wrapped_token_info(l1_mint);
    let (l2_mint_pda, _) = find_l2_mint(l1_mint);
    let (processed_pda, _) = find_processed_deposit(l1_deposit_nonce);

    let recipient_ata =
        spl_associated_token_account::get_associated_token_address(recipient, &l2_mint_pda);

    let params = MintWrappedParams {
        l1_deposit_nonce,
        recipient: *recipient,
        amount,
        l1_mint: *l1_mint,
        l1_tx_signature,
    };
    let mut data = vec![IX_MINT_WRAPPED];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*relayer, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(wrapped_info_pda, false),
            AccountMeta::new(l2_mint_pda, false),
            AccountMeta::new(recipient_ata, false),
            AccountMeta::new(processed_pda, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Burn wrapped tokens to initiate L1 withdrawal.
///
/// Accounts:
///   0. `[signer]` burner (token owner)
///   1. `[writable]` burner token account (ATA)
///   2. `[writable]` l2_mint account
///   3. `[]` wrapped_token_info PDA
///   4. `[writable]` l2_bridge_config PDA
///   5. `[]` token_program
pub fn create_burn_wrapped_instruction(
    burner: &Pubkey,
    amount: u64,
    l1_mint: &Pubkey,
    l1_recipient: [u8; 32],
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();
    let (wrapped_info_pda, _) = find_wrapped_token_info(l1_mint);
    let (l2_mint_pda, _) = find_l2_mint(l1_mint);

    let burner_ata =
        spl_associated_token_account::get_associated_token_address(burner, &l2_mint_pda);

    let params = BurnWrappedParams {
        amount,
        l1_recipient,
        l1_mint: *l1_mint,
    };
    let mut data = vec![IX_BURN_WRAPPED];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_L2_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*burner, true),
            AccountMeta::new(burner_ata, false),
            AccountMeta::new(l2_mint_pda, false),
            AccountMeta::new_readonly(wrapped_info_pda, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

/// Update L2 bridge configuration (admin only).
///
/// Accounts:
///   0. `[signer]` admin
///   1. `[writable]` l2_bridge_config PDA
pub fn create_update_config_instruction(
    admin: &Pubkey,
    new_relayer: Option<Pubkey>,
) -> Instruction {
    let (config_pda, _) = find_l2_bridge_config();

    let params = UpdateConfigParams { new_relayer };
    let mut data = vec![IX_UPDATE_CONFIG];
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
