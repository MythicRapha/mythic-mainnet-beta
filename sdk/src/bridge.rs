//! L1 Bridge instruction builders — deposits, withdrawals, config management.

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_DEPOSIT: u8 = 1;
const IX_DEPOSIT_SOL: u8 = 2;
const IX_INITIATE_WITHDRAWAL: u8 = 3;
const IX_CHALLENGE_WITHDRAWAL: u8 = 4;
const IX_FINALIZE_WITHDRAWAL: u8 = 5;
const IX_UPDATE_CONFIG: u8 = 6;

// ── Param Structs ───────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct InitializeParams {
    sequencer: Pubkey,
    challenge_period: i64,
}

#[derive(BorshSerialize)]
struct DepositParams {
    amount: u64,
    l2_recipient: [u8; 32],
}

#[derive(BorshSerialize)]
struct DepositSOLParams {
    amount: u64,
    l2_recipient: [u8; 32],
}

#[derive(BorshSerialize)]
struct InitiateWithdrawalParams {
    recipient: Pubkey,
    amount: u64,
    token_mint: Pubkey,
    merkle_proof: [u8; 32],
    nonce: u64,
}

#[derive(BorshSerialize)]
struct ChallengeWithdrawalParams {
    withdrawal_nonce: u64,
    fraud_proof: Vec<u8>,
}

#[derive(BorshSerialize)]
struct FinalizeWithdrawalParams {
    withdrawal_nonce: u64,
}

#[derive(BorshSerialize)]
struct UpdateConfigParams {
    new_sequencer: Option<Pubkey>,
    new_challenge_period: Option<i64>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_bridge_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], &BRIDGE_PROGRAM_ID)
}

pub fn find_vault(token_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, token_mint.as_ref()], &BRIDGE_PROGRAM_ID)
}

pub fn find_sol_vault() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SOL_VAULT_SEED], &BRIDGE_PROGRAM_ID)
}

pub fn find_withdrawal(nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[WITHDRAWAL_SEED, &nonce.to_le_bytes()],
        &BRIDGE_PROGRAM_ID,
    )
}

// ── Instruction Builders ────────────────────────────────────────────────────

pub fn create_initialize_instruction(
    admin: &Pubkey,
    sequencer: &Pubkey,
    challenge_period: i64,
) -> Instruction {
    let (config_pda, _) = find_bridge_config();
    let params = InitializeParams {
        sequencer: *sequencer,
        challenge_period,
    };
    let mut data = vec![IX_INITIALIZE];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_deposit_instruction(
    depositor: &Pubkey,
    l2_recipient: [u8; 32],
    amount: u64,
    token_mint: &Pubkey,
) -> Instruction {
    let depositor_token =
        spl_associated_token_account::get_associated_token_address(depositor, token_mint);
    let (vault_token, _) = find_vault(token_mint);
    let (config_pda, _) = find_bridge_config();

    let params = DepositParams {
        amount,
        l2_recipient,
    };
    let mut data = vec![IX_DEPOSIT];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*depositor, true),
            AccountMeta::new(depositor_token, false),
            AccountMeta::new(vault_token, false),
            AccountMeta::new_readonly(*token_mint, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

pub fn create_deposit_sol_instruction(
    depositor: &Pubkey,
    l2_recipient: [u8; 32],
    amount: u64,
) -> Instruction {
    let (sol_vault, _) = find_sol_vault();
    let (config_pda, _) = find_bridge_config();

    let params = DepositSOLParams {
        amount,
        l2_recipient,
    };
    let mut data = vec![IX_DEPOSIT_SOL];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*depositor, true),
            AccountMeta::new(sol_vault, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_initiate_withdrawal_instruction(
    sequencer: &Pubkey,
    payer: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
    token_mint: &Pubkey,
    merkle_proof: [u8; 32],
    nonce: u64,
) -> Instruction {
    let (config_pda, _) = find_bridge_config();
    let (withdrawal_pda, _) = find_withdrawal(nonce);

    let params = InitiateWithdrawalParams {
        recipient: *recipient,
        amount,
        token_mint: *token_mint,
        merkle_proof,
        nonce,
    };
    let mut data = vec![IX_INITIATE_WITHDRAWAL];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*sequencer, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_challenge_withdrawal_instruction(
    challenger: &Pubkey,
    withdrawal_nonce: u64,
    fraud_proof: Vec<u8>,
) -> Instruction {
    let (config_pda, _) = find_bridge_config();
    let (withdrawal_pda, _) = find_withdrawal(withdrawal_nonce);

    let params = ChallengeWithdrawalParams {
        withdrawal_nonce,
        fraud_proof,
    };
    let mut data = vec![IX_CHALLENGE_WITHDRAWAL];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*challenger, true),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn create_finalize_withdrawal_instruction(
    payer: &Pubkey,
    withdrawal_nonce: u64,
    token_mint: &Pubkey,
    recipient_token_account: &Pubkey,
) -> Instruction {
    let (config_pda, _) = find_bridge_config();
    let (withdrawal_pda, _) = find_withdrawal(withdrawal_nonce);
    let (vault_token, _) = find_vault(token_mint);

    let params = FinalizeWithdrawalParams { withdrawal_nonce };
    let mut data = vec![IX_FINALIZE_WITHDRAWAL];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new(vault_token, false),
            AccountMeta::new(*recipient_token_account, false),
            AccountMeta::new_readonly(*token_mint, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

pub fn create_update_config_instruction(
    admin: &Pubkey,
    new_sequencer: Option<Pubkey>,
    new_challenge_period: Option<i64>,
) -> Instruction {
    let (config_pda, _) = find_bridge_config();

    let params = UpdateConfigParams {
        new_sequencer,
        new_challenge_period,
    };
    let mut data = vec![IX_UPDATE_CONFIG];
    params.serialize(&mut data).unwrap();

    Instruction {
        program_id: BRIDGE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}
