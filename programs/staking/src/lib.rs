// Mythic L2 — Staking Program
// Synthetix-style reward-per-token accumulator for MYTH token staking.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

solana_program::declare_id!("MythStak11111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAKING_CONFIG_SEED: &[u8] = b"staking_config";
const STAKE_ACCOUNT_SEED: &[u8] = b"stake";
const STAKING_VAULT_SEED: &[u8] = b"staking_vault";

/// Default unbonding period: ~7 days at 400ms slots.
const DEFAULT_UNBONDING_SLOTS: u64 = 120_960;

/// Precision multiplier for reward_per_token calculations (1e18).
const PRECISION: u128 = 1_000_000_000_000_000_000;

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let (discriminator, data) = instruction_data.split_at(1);

    match discriminator[0] {
        0 => process_initialize(program_id, accounts, data),
        1 => process_stake(program_id, accounts, data),
        2 => process_unstake(program_id, accounts, data),
        3 => process_withdraw_unstaked(program_id, accounts, data),
        4 => process_claim_rewards(program_id, accounts, data),
        5 => process_fund_reward_pool(program_id, accounts, data),
        6 => process_pause(program_id, accounts),
        7 => process_unpause(program_id, accounts),
        _ => Err(StakingError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum StakingError {
    #[error("Invalid instruction discriminator")]
    InvalidInstruction,
    #[error("Account already initialized")]
    AlreadyInitialized,
    #[error("Account not initialized")]
    NotInitialized,
    #[error("Unauthorized signer")]
    Unauthorized,
    #[error("Invalid PDA derivation")]
    InvalidPDA,
    #[error("Account not writable")]
    AccountNotWritable,
    #[error("Account not signer")]
    AccountNotSigner,
    #[error("Invalid account owner")]
    InvalidOwner,
    #[error("Arithmetic overflow")]
    Overflow,
    #[error("Program is paused")]
    ProgramPaused,
    #[error("Insufficient stake balance")]
    InsufficientStake,
    #[error("Unbonding period not elapsed")]
    UnbondingNotComplete,
    #[error("No unbonding in progress")]
    NoUnbonding,
    #[error("No rewards to claim")]
    NoRewardsToClaim,
    #[error("Stake amount must be greater than zero")]
    ZeroAmount,
}

impl From<StakingError> for ProgramError {
    fn from(e: StakingError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct StakingConfig {
    pub is_initialized: bool,
    pub admin: Pubkey,
    pub total_staked: u64,
    /// Accumulated reward per token (scaled by PRECISION).
    /// Stored as u128 serialized as 16 bytes.
    pub reward_per_token_stored: u128,
    pub last_update_slot: u64,
    pub unbonding_slots: u64,
    /// Reward lamports distributed per slot (while total_staked > 0).
    pub reward_rate: u64,
    pub is_paused: bool,
    pub bump: u8,
    /// Total lamports sitting in the reward pool (funded by admin).
    pub reward_pool_balance: u64,
}

impl StakingConfig {
    // 1 + 32 + 8 + 16 + 8 + 8 + 8 + 1 + 1 + 8 = 91
    pub const SIZE: usize = 91;
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub staked_amount: u64,
    /// Snapshot of reward_per_token at last interaction.
    pub reward_per_token_paid: u128,
    pub rewards_earned: u64,
    pub unbonding_amount: u64,
    pub unbonding_start_slot: u64,
    pub bump: u8,
}

impl StakeAccount {
    // 32 + 8 + 16 + 8 + 8 + 8 + 1 = 81
    pub const SIZE: usize = 81;
}

// ---------------------------------------------------------------------------
// Instruction data structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub reward_rate: u64,
    pub unbonding_slots: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct AmountArgs {
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(StakingError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(StakingError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(StakingError::InvalidOwner.into());
    }
    Ok(())
}

fn create_pda_account<'a>(
    payer: &AccountInfo<'a>,
    space: usize,
    owner: &Pubkey,
    system_program: &AccountInfo<'a>,
    new_account: &AccountInfo<'a>,
    seeds: &[&[u8]],
) -> ProgramResult {
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(payer.key, new_account.key, lamports, space as u64, owner),
        &[payer.clone(), new_account.clone(), system_program.clone()],
        &[seeds],
    )
}

/// Transfer SOL from a PDA vault to a destination account.
fn transfer_lamports_from_vault<'a>(
    vault: &AccountInfo<'a>,
    destination: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    **vault.try_borrow_mut_lamports()? = vault
        .lamports()
        .checked_sub(amount)
        .ok_or(StakingError::Overflow)?;
    **destination.try_borrow_mut_lamports()? = destination
        .lamports()
        .checked_add(amount)
        .ok_or(StakingError::Overflow)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reward accumulator math (Synthetix pattern)
// ---------------------------------------------------------------------------

/// Compute current reward_per_token based on elapsed slots since last update.
fn current_reward_per_token(config: &StakingConfig, current_slot: u64) -> Result<u128, ProgramError> {
    if config.total_staked == 0 {
        return Ok(config.reward_per_token_stored);
    }

    let elapsed = current_slot
        .checked_sub(config.last_update_slot)
        .ok_or(StakingError::Overflow)?;

    let additional = (elapsed as u128)
        .checked_mul(config.reward_rate as u128)
        .ok_or(StakingError::Overflow)?
        .checked_mul(PRECISION)
        .ok_or(StakingError::Overflow)?
        / (config.total_staked as u128);

    config
        .reward_per_token_stored
        .checked_add(additional)
        .ok_or_else(|| StakingError::Overflow.into())
}

/// Compute pending rewards for a single stake account given current reward_per_token.
fn earned(stake: &StakeAccount, rpt: u128) -> Result<u64, ProgramError> {
    let delta = rpt
        .checked_sub(stake.reward_per_token_paid)
        .ok_or(StakingError::Overflow)?;

    let pending = (stake.staked_amount as u128)
        .checked_mul(delta)
        .ok_or(StakingError::Overflow)?
        / PRECISION;

    let pending_u64 = u64::try_from(pending).map_err(|_| StakingError::Overflow)?;

    stake
        .rewards_earned
        .checked_add(pending_u64)
        .ok_or_else(|| StakingError::Overflow.into())
}

/// Update config and stake account reward state. Returns updated (config, stake).
fn update_reward(
    config: &mut StakingConfig,
    stake: &mut StakeAccount,
    current_slot: u64,
) -> ProgramResult {
    let rpt = current_reward_per_token(config, current_slot)?;
    config.reward_per_token_stored = rpt;
    config.last_update_slot = current_slot;

    stake.rewards_earned = earned(stake, rpt)?;
    stake.reward_per_token_paid = rpt;

    Ok(())
}

/// Update only the global config reward state (used when no stake account yet).
fn update_reward_global(config: &mut StakingConfig, current_slot: u64) -> ProgramResult {
    let rpt = current_reward_per_token(config, current_slot)?;
    config.reward_per_token_stored = rpt;
    config.last_update_slot = current_slot;
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Initialize (discriminator 0)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   admin (payer)
//   1. [writable] config PDA
//   2. [writable] vault PDA
//   3. []         system_program

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_writable(vault_account)?;

    // Derive config PDA
    let (config_pda, config_bump) =
        Pubkey::find_program_address(&[STAKING_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    if !config_account.data_is_empty() {
        return Err(StakingError::AlreadyInitialized.into());
    }

    // Derive vault PDA
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[STAKING_VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    // Create config account
    create_pda_account(
        admin,
        StakingConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[STAKING_CONFIG_SEED, &[config_bump]],
    )?;

    // Create vault PDA (zero data — just holds lamports)
    if vault_account.data_is_empty() && vault_account.lamports() == 0 {
        create_pda_account(
            admin,
            0,
            program_id,
            system_program,
            vault_account,
            &[STAKING_VAULT_SEED, &[vault_bump]],
        )?;
    }

    let unbonding_slots = if args.unbonding_slots == 0 {
        DEFAULT_UNBONDING_SLOTS
    } else {
        args.unbonding_slots
    };

    let clock = Clock::get()?;

    let config = StakingConfig {
        is_initialized: true,
        admin: *admin.key,
        total_staked: 0,
        reward_per_token_stored: 0,
        last_update_slot: clock.slot,
        unbonding_slots,
        reward_rate: args.reward_rate,
        is_paused: false,
        bump: config_bump,
        reward_pool_balance: 0,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:StakingInitialized:{{\"admin\":\"{}\",\"reward_rate\":{},\"unbonding_slots\":{}}}",
        admin.key,
        args.reward_rate,
        unbonding_slots,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Stake (discriminator 1)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   user (payer)
//   1. [writable] stake_account PDA
//   2. [writable] config PDA
//   3. [writable] vault PDA
//   4. []         system_program

fn process_stake(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = AmountArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(StakingError::ZeroAmount.into());
    }

    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let stake_account = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(user)?;
    assert_writable(stake_account)?;
    assert_writable(config_account)?;
    assert_writable(vault_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(StakingError::ProgramPaused.into());
    }

    // Derive stake account PDA
    let (stake_pda, stake_bump) =
        Pubkey::find_program_address(&[STAKE_ACCOUNT_SEED, user.key.as_ref()], program_id);
    if stake_account.key != &stake_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    // Derive vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[STAKING_VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    let clock = Clock::get()?;

    // Create stake account if first time
    let mut stake = if stake_account.data_is_empty() {
        // Update global reward state before creating new account
        update_reward_global(&mut config, clock.slot)?;

        create_pda_account(
            user,
            StakeAccount::SIZE,
            program_id,
            system_program,
            stake_account,
            &[STAKE_ACCOUNT_SEED, user.key.as_ref(), &[stake_bump]],
        )?;

        StakeAccount {
            owner: *user.key,
            staked_amount: 0,
            reward_per_token_paid: config.reward_per_token_stored,
            rewards_earned: 0,
            unbonding_amount: 0,
            unbonding_start_slot: 0,
            bump: stake_bump,
        }
    } else {
        assert_owned_by(stake_account, program_id)?;
        let mut s = StakeAccount::try_from_slice(&stake_account.data.borrow())?;
        if s.owner != *user.key {
            return Err(StakingError::Unauthorized.into());
        }
        update_reward(&mut config, &mut s, clock.slot)?;
        s
    };

    // Transfer SOL from user to vault via system_program
    solana_program::program::invoke(
        &system_instruction::transfer(user.key, vault_account.key, args.amount),
        &[user.clone(), vault_account.clone(), system_program.clone()],
    )?;

    // Update state
    stake.staked_amount = stake
        .staked_amount
        .checked_add(args.amount)
        .ok_or(StakingError::Overflow)?;

    config.total_staked = config
        .total_staked
        .checked_add(args.amount)
        .ok_or(StakingError::Overflow)?;

    stake.serialize(&mut &mut stake_account.data.borrow_mut()[..])?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:Staked:{{\"user\":\"{}\",\"amount\":{},\"total_staked\":{}}}",
        user.key,
        args.amount,
        config.total_staked,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Unstake (discriminator 2) — begin unbonding
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   user
//   1. [writable] stake_account PDA
//   2. [writable] config PDA

fn process_unstake(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = AmountArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(StakingError::ZeroAmount.into());
    }

    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let stake_account = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(user)?;
    assert_writable(stake_account)?;
    assert_writable(config_account)?;
    assert_owned_by(stake_account, program_id)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(StakingError::ProgramPaused.into());
    }

    let mut stake = StakeAccount::try_from_slice(&stake_account.data.borrow())?;
    if stake.owner != *user.key {
        return Err(StakingError::Unauthorized.into());
    }
    if stake.staked_amount < args.amount {
        return Err(StakingError::InsufficientStake.into());
    }

    let clock = Clock::get()?;
    update_reward(&mut config, &mut stake, clock.slot)?;

    // Move from staked to unbonding
    stake.staked_amount = stake
        .staked_amount
        .checked_sub(args.amount)
        .ok_or(StakingError::Overflow)?;
    stake.unbonding_amount = stake
        .unbonding_amount
        .checked_add(args.amount)
        .ok_or(StakingError::Overflow)?;
    stake.unbonding_start_slot = clock.slot;

    config.total_staked = config
        .total_staked
        .checked_sub(args.amount)
        .ok_or(StakingError::Overflow)?;

    stake.serialize(&mut &mut stake_account.data.borrow_mut()[..])?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:Unstaked:{{\"user\":\"{}\",\"amount\":{},\"unbonding_until_slot\":{}}}",
        user.key,
        args.amount,
        clock.slot.checked_add(config.unbonding_slots).unwrap_or(u64::MAX),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: WithdrawUnstaked (discriminator 3)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   user
//   1. [writable] stake_account PDA
//   2. [writable] config PDA
//   3. [writable] vault PDA

fn process_withdraw_unstaked(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data; // no args

    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let stake_account = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;

    assert_signer(user)?;
    assert_writable(stake_account)?;
    assert_writable(vault_account)?;
    assert_owned_by(stake_account, program_id)?;
    assert_owned_by(config_account, program_id)?;

    let config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }

    // Derive vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[STAKING_VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    let mut stake = StakeAccount::try_from_slice(&stake_account.data.borrow())?;
    if stake.owner != *user.key {
        return Err(StakingError::Unauthorized.into());
    }
    if stake.unbonding_amount == 0 {
        return Err(StakingError::NoUnbonding.into());
    }

    let clock = Clock::get()?;
    let unlock_slot = stake
        .unbonding_start_slot
        .checked_add(config.unbonding_slots)
        .ok_or(StakingError::Overflow)?;

    if clock.slot < unlock_slot {
        return Err(StakingError::UnbondingNotComplete.into());
    }

    let withdraw_amount = stake.unbonding_amount;

    // Transfer SOL from vault PDA back to user
    transfer_lamports_from_vault(vault_account, user, withdraw_amount)?;

    stake.unbonding_amount = 0;
    stake.unbonding_start_slot = 0;
    stake.serialize(&mut &mut stake_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:WithdrawUnstaked:{{\"user\":\"{}\",\"amount\":{}}}",
        user.key,
        withdraw_amount,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ClaimRewards (discriminator 4)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   user
//   1. [writable] stake_account PDA
//   2. [writable] config PDA
//   3. [writable] vault PDA

fn process_claim_rewards(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data;

    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let stake_account = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;

    assert_signer(user)?;
    assert_writable(stake_account)?;
    assert_writable(config_account)?;
    assert_writable(vault_account)?;
    assert_owned_by(stake_account, program_id)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }

    // Derive vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[STAKING_VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    let mut stake = StakeAccount::try_from_slice(&stake_account.data.borrow())?;
    if stake.owner != *user.key {
        return Err(StakingError::Unauthorized.into());
    }

    let clock = Clock::get()?;
    update_reward(&mut config, &mut stake, clock.slot)?;

    let reward_amount = stake.rewards_earned;
    if reward_amount == 0 {
        return Err(StakingError::NoRewardsToClaim.into());
    }

    // Ensure reward pool can cover the claim
    if config.reward_pool_balance < reward_amount {
        return Err(StakingError::InsufficientStake.into());
    }

    // Transfer reward SOL from vault PDA to user
    transfer_lamports_from_vault(vault_account, user, reward_amount)?;

    config.reward_pool_balance = config
        .reward_pool_balance
        .checked_sub(reward_amount)
        .ok_or(StakingError::Overflow)?;

    stake.rewards_earned = 0;

    stake.serialize(&mut &mut stake_account.data.borrow_mut()[..])?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:RewardsClaimed:{{\"user\":\"{}\",\"amount\":{}}}",
        user.key,
        reward_amount,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: FundRewardPool (discriminator 5)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   admin (payer)
//   1. [writable] config PDA
//   2. [writable] vault PDA
//   3. []         system_program

fn process_fund_reward_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = AmountArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(StakingError::ZeroAmount.into());
    }

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_writable(vault_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(StakingError::Unauthorized.into());
    }

    // Derive vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[STAKING_VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    // Transfer SOL from admin to vault
    solana_program::program::invoke(
        &system_instruction::transfer(admin.key, vault_account.key, args.amount),
        &[admin.clone(), vault_account.clone(), system_program.clone()],
    )?;

    config.reward_pool_balance = config
        .reward_pool_balance
        .checked_add(args.amount)
        .ok_or(StakingError::Overflow)?;

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:RewardPoolFunded:{{\"admin\":\"{}\",\"amount\":{},\"total_pool\":{}}}",
        admin.key,
        args.amount,
        config.reward_pool_balance,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Pause (discriminator 6)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   admin
//   1. [writable] config PDA

fn process_pause(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[STAKING_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    let mut config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(StakingError::Unauthorized.into());
    }

    config.is_paused = true;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:StakingPaused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Unpause (discriminator 7)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   admin
//   1. [writable] config PDA

fn process_unpause(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[STAKING_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(StakingError::InvalidPDA.into());
    }

    let mut config = StakingConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(StakingError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(StakingError::Unauthorized.into());
    }

    config.is_paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:StakingUnpaused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}
