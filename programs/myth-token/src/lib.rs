// Mythic L2 — $MYTH Token Fee Distribution & Burn Program
// Manages fee collection, distribution to validators, and token burning.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

solana_program::declare_id!("7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEE_CONFIG_SEED: &[u8] = b"fee_config";
const VALIDATOR_SEED: &[u8] = b"validator";
const FEE_POOL_SEED: &[u8] = b"fee_pool";
const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
const BPS_DENOMINATOR: u16 = 10_000;

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
        1 => process_register_validator(program_id, accounts, data),
        2 => process_update_validator_status(program_id, accounts, data),
        3 => process_deregister_validator(program_id, accounts, data),
        4 => process_collect_fee(program_id, accounts, data),
        5 => process_distribute_epoch_rewards(program_id, accounts, data),
        6 => process_claim_rewards(program_id, accounts, data),
        7 => process_update_fee_config(program_id, accounts, data),
        8 => process_get_burn_stats(program_id, accounts),
        9 => process_pause(program_id, accounts),
        10 => process_unpause(program_id, accounts),
        _ => Err(MythTokenError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum MythTokenError {
    #[error("Invalid instruction discriminator")]
    InvalidInstruction,
    #[error("Account already initialized")]
    AlreadyInitialized,
    #[error("Account not initialized")]
    NotInitialized,
    #[error("Unauthorized signer")]
    Unauthorized,
    #[error("Fee split basis points must sum to 10000")]
    InvalidFeeSplit,
    #[error("Validator already registered")]
    ValidatorAlreadyRegistered,
    #[error("Validator not registered or inactive")]
    ValidatorNotRegistered,
    #[error("No rewards to claim")]
    NoRewardsToClaim,
    #[error("Fee pool already finalized")]
    FeePoolAlreadyFinalized,
    #[error("Fee pool not finalized")]
    FeePoolNotFinalized,
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
    #[error("Invalid fee type")]
    InvalidFeeType,
    #[error("No validators registered for distribution")]
    NoValidators,
    #[error("Program is paused")]
    ProgramPaused,
}

impl From<MythTokenError> for ProgramError {
    fn from(e: MythTokenError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy)]
pub struct FeeSplit {
    pub validator_bps: u16,
    pub foundation_bps: u16,
    pub burn_bps: u16,
}

impl FeeSplit {
    pub fn validate(&self) -> ProgramResult {
        let total = self
            .validator_bps
            .checked_add(self.foundation_bps)
            .and_then(|v| v.checked_add(self.burn_bps))
            .ok_or(MythTokenError::Overflow)?;
        if total != BPS_DENOMINATOR {
            return Err(MythTokenError::InvalidFeeSplit.into());
        }
        Ok(())
    }

    /// Returns (validator_amount, foundation_amount, burn_amount).
    pub fn split(&self, amount: u64) -> Result<(u64, u64, u64), ProgramError> {
        let validator = amount
            .checked_mul(self.validator_bps as u64)
            .ok_or(MythTokenError::Overflow)?
            / BPS_DENOMINATOR as u64;
        let foundation = amount
            .checked_mul(self.foundation_bps as u64)
            .ok_or(MythTokenError::Overflow)?
            / BPS_DENOMINATOR as u64;
        // Burn gets the remainder to avoid rounding dust
        let burn = amount
            .checked_sub(validator)
            .ok_or(MythTokenError::Overflow)?
            .checked_sub(foundation)
            .ok_or(MythTokenError::Overflow)?;
        Ok((validator, foundation, burn))
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct FeeConfig {
    pub is_initialized: bool,
    pub admin: Pubkey,
    pub foundation_wallet: Pubkey,
    pub burn_address: Pubkey,
    pub myth_mint: Pubkey,
    pub gas_split: FeeSplit,
    pub compute_split: FeeSplit,
    pub inference_split: FeeSplit,
    pub bridge_split: FeeSplit,
    pub current_epoch: u64,
    pub total_burned: u64,
    pub total_distributed: u64,
    pub total_foundation_collected: u64,
    pub is_paused: bool,
    pub bump: u8,
}

impl FeeConfig {
    // 1 + 32*4 + 6*4 + 8*4 + 1 + 1 = 1 + 128 + 24 + 32 + 1 + 1 = 187
    pub const SIZE: usize = 187;

    pub fn get_split(&self, fee_type: FeeType) -> FeeSplit {
        match fee_type {
            FeeType::Gas => self.gas_split,
            FeeType::Compute => self.compute_split,
            FeeType::Inference => self.inference_split,
            FeeType::Bridge => self.bridge_split,
            FeeType::SubnetRegistration => FeeSplit {
                validator_bps: 0,
                foundation_bps: 0,
                burn_bps: BPS_DENOMINATOR,
            },
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum FeeType {
    Gas = 0,
    Compute = 1,
    Inference = 2,
    Bridge = 3,
    SubnetRegistration = 4,
}

impl TryFrom<u8> for FeeType {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(FeeType::Gas),
            1 => Ok(FeeType::Compute),
            2 => Ok(FeeType::Inference),
            3 => Ok(FeeType::Bridge),
            4 => Ok(FeeType::SubnetRegistration),
            _ => Err(MythTokenError::InvalidFeeType.into()),
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct FeePool {
    pub epoch: u64,
    pub total_collected: u64,
    pub total_distributed: u64,
    pub is_finalized: bool,
    pub bump: u8,
}

impl FeePool {
    pub const SIZE: usize = 8 + 8 + 8 + 1 + 1; // 26
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ValidatorFeeAccount {
    pub validator: Pubkey,
    pub stake_amount: u64,
    pub ai_capable: bool,
    pub reward_multiplier: u16,
    pub pending_rewards: u64,
    pub total_claimed: u64,
    pub registered_at: i64,
    pub is_active: bool,
    pub bump: u8,
}

impl ValidatorFeeAccount {
    pub const SIZE: usize = 32 + 8 + 1 + 2 + 8 + 8 + 8 + 1 + 1; // 69
}

// ---------------------------------------------------------------------------
// Instruction data structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub foundation_wallet: Pubkey,
    pub gas_split: FeeSplit,
    pub compute_split: FeeSplit,
    pub inference_split: FeeSplit,
    pub bridge_split: FeeSplit,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RegisterValidatorArgs {
    pub stake_amount: u64,
    pub ai_capable: bool,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateValidatorStatusArgs {
    pub ai_capable: Option<bool>,
    pub stake_amount: Option<u64>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct CollectFeeArgs {
    pub fee_type: u8,
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateFeeConfigArgs {
    pub gas_split: Option<FeeSplit>,
    pub compute_split: Option<FeeSplit>,
    pub inference_split: Option<FeeSplit>,
    pub bridge_split: Option<FeeSplit>,
    pub foundation_wallet: Option<Pubkey>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(MythTokenError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(MythTokenError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(MythTokenError::InvalidOwner.into());
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

fn transfer_spl_tokens<'a>(
    source: &AccountInfo<'a>,
    destination: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let ix = spl_token::instruction::transfer(
        token_program.key,
        source.key,
        destination.key,
        authority.key,
        &[],
        amount,
    )?;

    if signer_seeds.is_empty() {
        invoke(&ix, &[source.clone(), destination.clone(), authority.clone(), token_program.clone()])
    } else {
        invoke_signed(
            &ix,
            &[source.clone(), destination.clone(), authority.clone(), token_program.clone()],
            &[signer_seeds],
        )
    }
}

// ---------------------------------------------------------------------------
// Instruction: Initialize
// ---------------------------------------------------------------------------

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Validate all fee splits
    args.gas_split.validate()?;
    args.compute_split.validate()?;
    args.inference_split.validate()?;
    args.bridge_split.validate()?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let burn_address = next_account_info(account_iter)?;
    let myth_mint = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;

    // Derive config PDA
    let (config_pda, config_bump) =
        Pubkey::find_program_address(&[FEE_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(MythTokenError::InvalidPDA.into());
    }

    if !config_account.data_is_empty() {
        return Err(MythTokenError::AlreadyInitialized.into());
    }

    create_pda_account(
        admin,
        FeeConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[FEE_CONFIG_SEED, &[config_bump]],
    )?;

    let config = FeeConfig {
        is_initialized: true,
        admin: *admin.key,
        foundation_wallet: args.foundation_wallet,
        burn_address: *burn_address.key,
        myth_mint: *myth_mint.key,
        gas_split: args.gas_split,
        compute_split: args.compute_split,
        inference_split: args.inference_split,
        bridge_split: args.bridge_split,
        current_epoch: 0,
        total_burned: 0,
        total_distributed: 0,
        total_foundation_collected: 0,
        is_paused: false,
        bump: config_bump,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:FeeConfigInitialized:{{\"admin\":\"{}\",\"foundation\":\"{}\"}}",
        admin.key,
        args.foundation_wallet,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: RegisterValidator
// ---------------------------------------------------------------------------

fn process_register_validator(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RegisterValidatorArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let validator = next_account_info(account_iter)?;
    let validator_fee_account = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(validator)?;
    assert_writable(validator_fee_account)?;
    assert_owned_by(config_account, program_id)?;

    let config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }

    // Derive validator PDA
    let (validator_pda, validator_bump) =
        Pubkey::find_program_address(&[VALIDATOR_SEED, validator.key.as_ref()], program_id);
    if validator_fee_account.key != &validator_pda {
        return Err(MythTokenError::InvalidPDA.into());
    }

    if !validator_fee_account.data_is_empty() {
        return Err(MythTokenError::ValidatorAlreadyRegistered.into());
    }

    create_pda_account(
        validator,
        ValidatorFeeAccount::SIZE,
        program_id,
        system_program,
        validator_fee_account,
        &[VALIDATOR_SEED, validator.key.as_ref(), &[validator_bump]],
    )?;

    let reward_multiplier: u16 = if args.ai_capable { 200 } else { 100 }; // 2x = 200, 1x = 100

    let clock = Clock::get()?;

    let vfa = ValidatorFeeAccount {
        validator: *validator.key,
        stake_amount: args.stake_amount,
        ai_capable: args.ai_capable,
        reward_multiplier,
        pending_rewards: 0,
        total_claimed: 0,
        registered_at: clock.unix_timestamp,
        is_active: true,
        bump: validator_bump,
    };

    vfa.serialize(&mut &mut validator_fee_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ValidatorRegistered:{{\"validator\":\"{}\",\"stake\":{},\"ai_capable\":{},\"multiplier\":{}}}",
        validator.key,
        args.stake_amount,
        args.ai_capable,
        reward_multiplier,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: UpdateValidatorStatus
// ---------------------------------------------------------------------------

fn process_update_validator_status(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateValidatorStatusArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let validator = next_account_info(account_iter)?;
    let validator_fee_account = next_account_info(account_iter)?;

    assert_signer(validator)?;
    assert_writable(validator_fee_account)?;
    assert_owned_by(validator_fee_account, program_id)?;

    let mut vfa =
        ValidatorFeeAccount::try_from_slice(&validator_fee_account.data.borrow())?;
    if !vfa.is_active {
        return Err(MythTokenError::ValidatorNotRegistered.into());
    }
    if validator.key != &vfa.validator {
        return Err(MythTokenError::Unauthorized.into());
    }

    if let Some(ai_capable) = args.ai_capable {
        vfa.ai_capable = ai_capable;
        vfa.reward_multiplier = if ai_capable { 200 } else { 100 };
    }
    if let Some(stake_amount) = args.stake_amount {
        vfa.stake_amount = stake_amount;
    }

    vfa.serialize(&mut &mut validator_fee_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ValidatorUpdated:{{\"validator\":\"{}\",\"ai_capable\":{},\"stake\":{}}}",
        validator.key,
        vfa.ai_capable,
        vfa.stake_amount,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: DeregisterValidator
// ---------------------------------------------------------------------------

fn process_deregister_validator(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data; // no args

    let account_iter = &mut accounts.iter();
    let validator = next_account_info(account_iter)?;
    let validator_fee_account = next_account_info(account_iter)?;
    let reward_vault = next_account_info(account_iter)?;
    let validator_token_account = next_account_info(account_iter)?;
    let vault_authority = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    assert_signer(validator)?;
    assert_writable(validator_fee_account)?;
    assert_owned_by(validator_fee_account, program_id)?;
    assert_owned_by(config_account, program_id)?;

    let config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }

    let mut vfa =
        ValidatorFeeAccount::try_from_slice(&validator_fee_account.data.borrow())?;
    if !vfa.is_active {
        return Err(MythTokenError::ValidatorNotRegistered.into());
    }
    if validator.key != &vfa.validator {
        return Err(MythTokenError::Unauthorized.into());
    }

    // Pay out any pending rewards before deregistering
    if vfa.pending_rewards > 0 {
        let (_, vault_auth_bump) =
            Pubkey::find_program_address(&[REWARD_VAULT_SEED], program_id);
        let vault_seeds = &[REWARD_VAULT_SEED, &[vault_auth_bump]];

        transfer_spl_tokens(
            reward_vault,
            validator_token_account,
            vault_authority,
            token_program,
            vfa.pending_rewards,
            vault_seeds,
        )?;

        msg!(
            "EVENT:RewardsClaimed:{{\"validator\":\"{}\",\"amount\":{}}}",
            validator.key,
            vfa.pending_rewards,
        );

        vfa.total_claimed = vfa
            .total_claimed
            .checked_add(vfa.pending_rewards)
            .ok_or(MythTokenError::Overflow)?;
        vfa.pending_rewards = 0;
    }

    vfa.is_active = false;
    vfa.serialize(&mut &mut validator_fee_account.data.borrow_mut()[..])?;

    // Return rent lamports to validator
    let lamports = validator_fee_account.lamports();
    **validator_fee_account.try_borrow_mut_lamports()? = 0;
    **validator.try_borrow_mut_lamports()? = validator
        .lamports()
        .checked_add(lamports)
        .ok_or(MythTokenError::Overflow)?;

    msg!(
        "EVENT:ValidatorDeregistered:{{\"validator\":\"{}\"}}",
        validator.key,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: CollectFee
// ---------------------------------------------------------------------------

fn process_collect_fee(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CollectFeeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let fee_type = FeeType::try_from(args.fee_type)?;

    let account_iter = &mut accounts.iter();
    let payer = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let fee_pool_account = next_account_info(account_iter)?;
    let payer_token_account = next_account_info(account_iter)?;
    let foundation_token_account = next_account_info(account_iter)?;
    let burn_token_account = next_account_info(account_iter)?;
    let fee_pool_token_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(payer)?;
    assert_writable(config_account)?;
    assert_writable(fee_pool_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(MythTokenError::ProgramPaused.into());
    }

    // Get fee split for this type
    let split = config.get_split(fee_type);
    let (validator_amount, foundation_amount, burn_amount) = split.split(args.amount)?;

    // Derive fee pool PDA for current epoch
    let epoch_bytes = config.current_epoch.to_le_bytes();
    let (fee_pool_pda, fee_pool_bump) =
        Pubkey::find_program_address(&[FEE_POOL_SEED, &epoch_bytes], program_id);
    if fee_pool_account.key != &fee_pool_pda {
        return Err(MythTokenError::InvalidPDA.into());
    }

    // Create fee pool if it doesn't exist yet
    if fee_pool_account.data_is_empty() {
        create_pda_account(
            payer,
            FeePool::SIZE,
            program_id,
            system_program,
            fee_pool_account,
            &[FEE_POOL_SEED, &epoch_bytes, &[fee_pool_bump]],
        )?;

        let pool = FeePool {
            epoch: config.current_epoch,
            total_collected: 0,
            total_distributed: 0,
            is_finalized: false,
            bump: fee_pool_bump,
        };
        pool.serialize(&mut &mut fee_pool_account.data.borrow_mut()[..])?;
    }

    let mut pool = FeePool::try_from_slice(&fee_pool_account.data.borrow())?;
    if pool.is_finalized {
        return Err(MythTokenError::FeePoolAlreadyFinalized.into());
    }

    // Transfer validator portion to fee pool token account
    if validator_amount > 0 {
        transfer_spl_tokens(
            payer_token_account,
            fee_pool_token_account,
            payer,
            token_program,
            validator_amount,
            &[],
        )?;
    }

    // Transfer foundation portion
    if foundation_amount > 0 {
        transfer_spl_tokens(
            payer_token_account,
            foundation_token_account,
            payer,
            token_program,
            foundation_amount,
            &[],
        )?;
    }

    // Transfer burn portion to burn address
    if burn_amount > 0 {
        transfer_spl_tokens(
            payer_token_account,
            burn_token_account,
            payer,
            token_program,
            burn_amount,
            &[],
        )?;
    }

    // Update fee pool
    pool.total_collected = pool
        .total_collected
        .checked_add(validator_amount)
        .ok_or(MythTokenError::Overflow)?;
    pool.serialize(&mut &mut fee_pool_account.data.borrow_mut()[..])?;

    // Update config stats
    config.total_burned = config
        .total_burned
        .checked_add(burn_amount)
        .ok_or(MythTokenError::Overflow)?;
    config.total_foundation_collected = config
        .total_foundation_collected
        .checked_add(foundation_amount)
        .ok_or(MythTokenError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:FeeCollected:{{\"fee_type\":{},\"amount\":{},\"validator\":{},\"foundation\":{},\"burned\":{}}}",
        args.fee_type,
        args.amount,
        validator_amount,
        foundation_amount,
        burn_amount,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: DistributeEpochRewards
// ---------------------------------------------------------------------------

fn process_distribute_epoch_rewards(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data; // no args beyond discriminator

    let account_iter = &mut accounts.iter();
    let caller = next_account_info(account_iter)?; // anyone (crank)
    let config_account = next_account_info(account_iter)?;
    let fee_pool_account = next_account_info(account_iter)?;

    assert_signer(caller)?;
    assert_writable(config_account)?;
    assert_writable(fee_pool_account)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(fee_pool_account, program_id)?;

    let mut config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }

    let mut pool = FeePool::try_from_slice(&fee_pool_account.data.borrow())?;
    if pool.is_finalized {
        return Err(MythTokenError::FeePoolAlreadyFinalized.into());
    }

    let total_to_distribute = pool.total_collected;
    if total_to_distribute == 0 {
        pool.is_finalized = true;
        pool.serialize(&mut &mut fee_pool_account.data.borrow_mut()[..])?;
        config.current_epoch = config
            .current_epoch
            .checked_add(1)
            .ok_or(MythTokenError::Overflow)?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;
        return Ok(());
    }

    // Remaining accounts are validator fee accounts to distribute to.
    // Compute total weighted stake from all passed validator accounts.
    let remaining = account_iter.as_slice();
    if remaining.is_empty() {
        return Err(MythTokenError::NoValidators.into());
    }

    // First pass: compute total weight
    let mut total_weight: u64 = 0;
    let mut validator_weights: Vec<u64> = Vec::new();
    for account in remaining.iter() {
        assert_writable(account)?;
        assert_owned_by(account, program_id)?;

        let vfa = ValidatorFeeAccount::try_from_slice(&account.data.borrow())?;
        if !vfa.is_active {
            validator_weights.push(0);
            continue;
        }

        let weight = (vfa.stake_amount as u128)
            .checked_mul(vfa.reward_multiplier as u128)
            .ok_or(MythTokenError::Overflow)?;
        // Truncate to u64 — safe for realistic stake amounts
        let weight_u64 = u64::try_from(weight).map_err(|_| MythTokenError::Overflow)?;
        total_weight = total_weight
            .checked_add(weight_u64)
            .ok_or(MythTokenError::Overflow)?;
        validator_weights.push(weight_u64);
    }

    if total_weight == 0 {
        return Err(MythTokenError::NoValidators.into());
    }

    // Second pass: distribute proportionally
    let mut distributed: u64 = 0;
    for (i, account) in remaining.iter().enumerate() {
        let weight = validator_weights[i];
        if weight == 0 {
            continue;
        }

        let reward = (total_to_distribute as u128)
            .checked_mul(weight as u128)
            .ok_or(MythTokenError::Overflow)?
            / (total_weight as u128);
        let reward_u64 = u64::try_from(reward).map_err(|_| MythTokenError::Overflow)?;

        let mut vfa = ValidatorFeeAccount::try_from_slice(&account.data.borrow())?;
        vfa.pending_rewards = vfa
            .pending_rewards
            .checked_add(reward_u64)
            .ok_or(MythTokenError::Overflow)?;
        vfa.serialize(&mut &mut account.data.borrow_mut()[..])?;

        distributed = distributed
            .checked_add(reward_u64)
            .ok_or(MythTokenError::Overflow)?;
    }

    pool.total_distributed = distributed;
    pool.is_finalized = true;
    pool.serialize(&mut &mut fee_pool_account.data.borrow_mut()[..])?;

    config.total_distributed = config
        .total_distributed
        .checked_add(distributed)
        .ok_or(MythTokenError::Overflow)?;
    config.current_epoch = config
        .current_epoch
        .checked_add(1)
        .ok_or(MythTokenError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:EpochRewardsDistributed:{{\"epoch\":{},\"total_distributed\":{},\"validators\":{}}}",
        pool.epoch,
        distributed,
        remaining.len(),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ClaimRewards
// ---------------------------------------------------------------------------

fn process_claim_rewards(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data;

    let account_iter = &mut accounts.iter();
    let validator = next_account_info(account_iter)?;
    let validator_fee_account = next_account_info(account_iter)?;
    let reward_vault = next_account_info(account_iter)?;
    let validator_token_account = next_account_info(account_iter)?;
    let vault_authority = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    assert_signer(validator)?;
    assert_writable(validator_fee_account)?;
    assert_writable(reward_vault)?;
    assert_writable(validator_token_account)?;
    assert_owned_by(validator_fee_account, program_id)?;
    assert_owned_by(config_account, program_id)?;

    let config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }

    // Validate token_program
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Validate vault_authority PDA
    let (vault_auth_pda, vault_auth_bump) =
        Pubkey::find_program_address(&[REWARD_VAULT_SEED], program_id);
    if vault_authority.key != &vault_auth_pda {
        return Err(MythTokenError::InvalidPDA.into());
    }

    let mut vfa =
        ValidatorFeeAccount::try_from_slice(&validator_fee_account.data.borrow())?;
    if validator.key != &vfa.validator {
        return Err(MythTokenError::Unauthorized.into());
    }
    if vfa.pending_rewards == 0 {
        return Err(MythTokenError::NoRewardsToClaim.into());
    }

    let claim_amount = vfa.pending_rewards;

    // Transfer from reward vault using PDA authority
    let vault_seeds = &[REWARD_VAULT_SEED, &[vault_auth_bump]];

    transfer_spl_tokens(
        reward_vault,
        validator_token_account,
        vault_authority,
        token_program,
        claim_amount,
        vault_seeds,
    )?;

    vfa.total_claimed = vfa
        .total_claimed
        .checked_add(claim_amount)
        .ok_or(MythTokenError::Overflow)?;
    vfa.pending_rewards = 0;
    vfa.serialize(&mut &mut validator_fee_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:RewardsClaimed:{{\"validator\":\"{}\",\"amount\":{}}}",
        validator.key,
        claim_amount,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: UpdateFeeConfig
// ---------------------------------------------------------------------------

fn process_update_fee_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateFeeConfigArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(MythTokenError::Unauthorized.into());
    }

    if let Some(split) = args.gas_split {
        split.validate()?;
        config.gas_split = split;
    }
    if let Some(split) = args.compute_split {
        split.validate()?;
        config.compute_split = split;
    }
    if let Some(split) = args.inference_split {
        split.validate()?;
        config.inference_split = split;
    }
    if let Some(split) = args.bridge_split {
        split.validate()?;
        config.bridge_split = split;
    }
    if let Some(wallet) = args.foundation_wallet {
        config.foundation_wallet = wallet;
    }

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:FeeConfigUpdated:{{\"admin\":\"{}\"}}", admin.key);

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: GetBurnStats (read-only)
// ---------------------------------------------------------------------------

fn process_get_burn_stats(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let config_account = next_account_info(account_iter)?;

    assert_owned_by(config_account, program_id)?;

    let config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }

    msg!(
        "EVENT:BurnStats:{{\"total_burned\":{},\"total_distributed\":{},\"total_foundation\":{}}}",
        config.total_burned,
        config.total_distributed,
        config.total_foundation_collected,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Pause (admin-only)
// Accounts: 0=[signer] admin, 1=[writable] config PDA
// ---------------------------------------------------------------------------

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
        Pubkey::find_program_address(&[FEE_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(MythTokenError::InvalidPDA.into());
    }

    let mut config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(MythTokenError::Unauthorized.into());
    }

    config.is_paused = true;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:Paused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Unpause (admin-only)
// Accounts: 0=[signer] admin, 1=[writable] config PDA
// ---------------------------------------------------------------------------

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
        Pubkey::find_program_address(&[FEE_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(MythTokenError::InvalidPDA.into());
    }

    let mut config = FeeConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(MythTokenError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(MythTokenError::Unauthorized.into());
    }

    config.is_paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:Unpaused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}
