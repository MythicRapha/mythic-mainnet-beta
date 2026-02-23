//! MYTH Token instruction builders — fee distribution, burn, and config management.
//!
//! Matches: programs/myth-token/src/lib.rs
//! Program ID: MythToken1111111111111111111111111111111111
//!
//! Instructions:
//!   0 = Initialize
//!   1 = RegisterValidator
//!   2 = UpdateValidatorStatus
//!   3 = DeregisterValidator
//!   4 = CollectFee
//!   5 = DistributeEpochRewards
//!   6 = ClaimRewards
//!   7 = UpdateFeeConfig
//!   8 = GetBurnStats

use borsh::BorshSerialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

use crate::constants::*;

// ── Instruction Discriminators ──────────────────────────────────────────────

const IX_INITIALIZE: u8 = 0;
const IX_REGISTER_VALIDATOR: u8 = 1;
const IX_UPDATE_VALIDATOR_STATUS: u8 = 2;
const IX_DEREGISTER_VALIDATOR: u8 = 3;
const IX_COLLECT_FEE: u8 = 4;
const IX_DISTRIBUTE_EPOCH_REWARDS: u8 = 5;
const IX_CLAIM_REWARDS: u8 = 6;
const IX_UPDATE_FEE_CONFIG: u8 = 7;
const IX_GET_BURN_STATS: u8 = 8;

// ── Param Structs (exact Borsh match to program) ────────────────────────────

/// Fee split in basis points. Must sum to 10_000.
#[derive(BorshSerialize, Clone, Copy)]
pub struct FeeSplit {
    pub validator_bps: u16,
    pub foundation_bps: u16,
    pub burn_bps: u16,
}

#[derive(BorshSerialize)]
pub struct InitializeArgs {
    pub foundation_wallet: Pubkey,
    pub gas_split: FeeSplit,
    pub compute_split: FeeSplit,
    pub inference_split: FeeSplit,
    pub bridge_split: FeeSplit,
}

#[derive(BorshSerialize)]
pub struct RegisterValidatorArgs {
    pub stake_amount: u64,
    pub ai_capable: bool,
}

#[derive(BorshSerialize)]
pub struct UpdateValidatorStatusArgs {
    pub ai_capable: Option<bool>,
    pub stake_amount: Option<u64>,
}

#[derive(BorshSerialize)]
pub struct CollectFeeArgs {
    pub fee_type: u8,
    pub amount: u64,
}

#[derive(BorshSerialize)]
pub struct UpdateFeeConfigArgs {
    pub gas_split: Option<FeeSplit>,
    pub compute_split: Option<FeeSplit>,
    pub inference_split: Option<FeeSplit>,
    pub bridge_split: Option<FeeSplit>,
    pub foundation_wallet: Option<Pubkey>,
}

// ── PDA Helpers ─────────────────────────────────────────────────────────────

pub fn find_fee_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FEE_CONFIG_SEED], &MYTH_TOKEN_PROGRAM_ID)
}

pub fn find_validator_fee_account(validator: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VALIDATOR_SEED, validator.as_ref()],
        &MYTH_TOKEN_PROGRAM_ID,
    )
}

pub fn find_fee_pool(epoch: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[FEE_POOL_SEED, &epoch.to_le_bytes()],
        &MYTH_TOKEN_PROGRAM_ID,
    )
}

pub fn find_reward_vault() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[REWARD_VAULT_SEED], &MYTH_TOKEN_PROGRAM_ID)
}

// ── Instruction Builders ────────────────────────────────────────────────────

/// Initialize the MYTH token fee config.
///
/// Accounts:
///   0. `[signer, writable]` admin (payer)
///   1. `[writable]` fee_config PDA
///   2. `[]` burn_address
///   3. `[]` myth_mint
///   4. `[]` system_program
pub fn create_initialize_instruction(
    admin: &Pubkey,
    burn_address: &Pubkey,
    myth_mint: &Pubkey,
    foundation_wallet: &Pubkey,
    gas_split: FeeSplit,
    compute_split: FeeSplit,
    inference_split: FeeSplit,
    bridge_split: FeeSplit,
) -> Instruction {
    let (config_pda, _) = find_fee_config();

    let args = InitializeArgs {
        foundation_wallet: *foundation_wallet,
        gas_split,
        compute_split,
        inference_split,
        bridge_split,
    };
    let mut data = vec![IX_INITIALIZE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(*burn_address, false),
            AccountMeta::new_readonly(*myth_mint, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Register a validator for fee distribution.
///
/// Accounts:
///   0. `[signer, writable]` validator (payer)
///   1. `[writable]` validator_fee_account PDA (seeds: ["validator", validator])
///   2. `[]` fee_config PDA
///   3. `[]` system_program
pub fn create_register_validator_instruction(
    validator: &Pubkey,
    stake_amount: u64,
    ai_capable: bool,
) -> Instruction {
    let (validator_pda, _) = find_validator_fee_account(validator);
    let (config_pda, _) = find_fee_config();

    let args = RegisterValidatorArgs {
        stake_amount,
        ai_capable,
    };
    let mut data = vec![IX_REGISTER_VALIDATOR];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*validator, true),
            AccountMeta::new(validator_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Update validator status.
///
/// Accounts:
///   0. `[signer]` validator
///   1. `[writable]` validator_fee_account PDA
pub fn create_update_validator_status_instruction(
    validator: &Pubkey,
    ai_capable: Option<bool>,
    stake_amount: Option<u64>,
) -> Instruction {
    let (validator_pda, _) = find_validator_fee_account(validator);

    let args = UpdateValidatorStatusArgs {
        ai_capable,
        stake_amount,
    };
    let mut data = vec![IX_UPDATE_VALIDATOR_STATUS];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*validator, true),
            AccountMeta::new(validator_pda, false),
        ],
        data,
    }
}

/// Deregister a validator (pays out pending rewards, closes account).
///
/// Accounts:
///   0. `[signer, writable]` validator
///   1. `[writable]` validator_fee_account PDA
///   2. `[writable]` reward_vault
///   3. `[writable]` validator_token_account (ATA for MYTH)
///   4. `[]` vault_authority (reward_vault PDA)
///   5. `[]` fee_config PDA
///   6. `[]` token_program
pub fn create_deregister_validator_instruction(
    validator: &Pubkey,
    reward_vault: &Pubkey,
    validator_token_account: &Pubkey,
    vault_authority: &Pubkey,
    config_key: &Pubkey,
) -> Instruction {
    let (validator_pda, _) = find_validator_fee_account(validator);

    let data = vec![IX_DEREGISTER_VALIDATOR];

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*validator, true),
            AccountMeta::new(validator_pda, false),
            AccountMeta::new(*reward_vault, false),
            AccountMeta::new(*validator_token_account, false),
            AccountMeta::new_readonly(*vault_authority, false),
            AccountMeta::new_readonly(*config_key, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

/// Collect a fee (splits into validator/foundation/burn portions).
///
/// Accounts:
///   0. `[signer, writable]` payer
///   1. `[writable]` fee_config PDA
///   2. `[writable]` fee_pool PDA (for current epoch)
///   3. `[writable]` payer_token_account
///   4. `[writable]` foundation_token_account
///   5. `[writable]` burn_token_account
///   6. `[writable]` fee_pool_token_account
///   7. `[]` token_program
///   8. `[]` system_program
pub fn create_collect_fee_instruction(
    payer: &Pubkey,
    fee_pool_key: &Pubkey,
    payer_token_account: &Pubkey,
    foundation_token_account: &Pubkey,
    burn_token_account: &Pubkey,
    fee_pool_token_account: &Pubkey,
    fee_type: u8,
    amount: u64,
) -> Instruction {
    let (config_pda, _) = find_fee_config();

    let args = CollectFeeArgs { fee_type, amount };
    let mut data = vec![IX_COLLECT_FEE];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(*fee_pool_key, false),
            AccountMeta::new(*payer_token_account, false),
            AccountMeta::new(*foundation_token_account, false),
            AccountMeta::new(*burn_token_account, false),
            AccountMeta::new(*fee_pool_token_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Distribute epoch rewards to validators (crank).
///
/// Accounts:
///   0. `[signer]` caller (anyone / crank)
///   1. `[writable]` fee_config PDA
///   2. `[writable]` fee_pool PDA
///   (remaining) `[writable]` validator_fee_account PDAs
pub fn create_distribute_epoch_rewards_instruction(
    caller: &Pubkey,
    fee_pool_key: &Pubkey,
    validator_fee_accounts: &[Pubkey],
) -> Instruction {
    let (config_pda, _) = find_fee_config();

    let mut accounts = vec![
        AccountMeta::new_readonly(*caller, true),
        AccountMeta::new(config_pda, false),
        AccountMeta::new(*fee_pool_key, false),
    ];
    for vfa in validator_fee_accounts {
        accounts.push(AccountMeta::new(*vfa, false));
    }

    let data = vec![IX_DISTRIBUTE_EPOCH_REWARDS];

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts,
        data,
    }
}

/// Claim pending rewards.
///
/// Accounts:
///   0. `[signer]` validator
///   1. `[writable]` validator_fee_account PDA
///   2. `[writable]` reward_vault
///   3. `[writable]` validator_token_account
///   4. `[]` vault_authority (reward_vault PDA)
///   5. `[]` fee_config PDA
///   6. `[]` token_program
pub fn create_claim_rewards_instruction(
    validator: &Pubkey,
    reward_vault: &Pubkey,
    validator_token_account: &Pubkey,
    vault_authority: &Pubkey,
    config_key: &Pubkey,
) -> Instruction {
    let (validator_pda, _) = find_validator_fee_account(validator);

    let data = vec![IX_CLAIM_REWARDS];

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*validator, true),
            AccountMeta::new(validator_pda, false),
            AccountMeta::new(*reward_vault, false),
            AccountMeta::new(*validator_token_account, false),
            AccountMeta::new_readonly(*vault_authority, false),
            AccountMeta::new_readonly(*config_key, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

/// Update fee configuration (admin only).
///
/// Accounts:
///   0. `[signer]` admin
///   1. `[writable]` fee_config PDA
pub fn create_update_fee_config_instruction(
    admin: &Pubkey,
    gas_split: Option<FeeSplit>,
    compute_split: Option<FeeSplit>,
    inference_split: Option<FeeSplit>,
    bridge_split: Option<FeeSplit>,
    foundation_wallet: Option<Pubkey>,
) -> Instruction {
    let (config_pda, _) = find_fee_config();

    let args = UpdateFeeConfigArgs {
        gas_split,
        compute_split,
        inference_split,
        bridge_split,
        foundation_wallet,
    };
    let mut data = vec![IX_UPDATE_FEE_CONFIG];
    args.serialize(&mut data).unwrap();

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}

/// Get burn stats (read-only, logs result).
///
/// Accounts:
///   0. `[]` fee_config PDA
pub fn create_get_burn_stats_instruction() -> Instruction {
    let (config_pda, _) = find_fee_config();

    let data = vec![IX_GET_BURN_STATS];

    Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(config_pda, false),
        ],
        data,
    }
}
