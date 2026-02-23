// Mythic L2 — Merkle-based Airdrop & Distribution Program
// Allows admin to fund a vault and let eligible users claim via Merkle proof.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    hash::hashv,
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

solana_program::declare_id!("MythDrop11111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_SEED: &[u8] = b"airdrop_config";
const CLAIM_SEED: &[u8] = b"claim";
const VAULT_SEED: &[u8] = b"airdrop_vault";

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
        1 => process_claim(program_id, accounts, data),
        2 => process_update_merkle_root(program_id, accounts, data),
        3 => process_withdraw_unclaimed(program_id, accounts, data),
        4 => process_pause(program_id, accounts),
        5 => process_unpause(program_id, accounts),
        _ => Err(AirdropError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum AirdropError {
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
    #[error("Already claimed")]
    AlreadyClaimed,
    #[error("Invalid Merkle proof")]
    InvalidMerkleProof,
    #[error("Claim window not yet open")]
    ClaimNotStarted,
    #[error("Claim window has ended")]
    ClaimEnded,
    #[error("Claim window still active")]
    ClaimStillActive,
    #[error("Insufficient vault balance")]
    InsufficientVault,
}

impl From<AirdropError> for ProgramError {
    fn from(e: AirdropError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct AirdropConfig {
    pub is_initialized: bool,
    pub admin: Pubkey,
    pub merkle_root: [u8; 32],
    pub total_allocation: u64,
    pub total_claimed: u64,
    pub claim_count: u64,
    pub claim_start_slot: u64,
    pub claim_end_slot: u64,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

impl AirdropConfig {
    // 1 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1 = 108
    pub const SIZE: usize = 108;
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ClaimRecord {
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at_slot: u64,
}

impl ClaimRecord {
    // 32 + 8 + 8 = 48
    pub const SIZE: usize = 48;
}

// ---------------------------------------------------------------------------
// Instruction data structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub merkle_root: [u8; 32],
    pub total_allocation: u64,
    pub claim_start_slot: u64,
    pub claim_end_slot: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ClaimArgs {
    pub amount: u64,
    pub proof: Vec<[u8; 32]>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateMerkleRootArgs {
    pub new_merkle_root: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct WithdrawUnclaimedArgs {
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(AirdropError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(AirdropError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(AirdropError::InvalidOwner.into());
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

/// Verify a Merkle proof.
/// Leaf = sha256(user_pubkey || amount_le_bytes).
/// Walk up the tree: for each proof element, hash the pair in sorted order.
fn verify_merkle_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let mut computed = leaf;
    for element in proof.iter() {
        if computed <= *element {
            computed = hashv(&[&computed, element]).to_bytes();
        } else {
            computed = hashv(&[element, &computed]).to_bytes();
        }
    }
    computed == *root
}

/// Build the leaf hash for a claimant: sha256(pubkey || amount_le).
fn compute_leaf(claimant: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[claimant.as_ref(), &amount.to_le_bytes()]).to_bytes()
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

    if args.claim_end_slot <= args.claim_start_slot {
        return Err(ProgramError::InvalidArgument);
    }
    if args.total_allocation == 0 {
        return Err(ProgramError::InvalidArgument);
    }

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
        Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    // Derive vault PDA
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    if !config_account.data_is_empty() {
        return Err(AirdropError::AlreadyInitialized.into());
    }

    // Create config account
    create_pda_account(
        admin,
        AirdropConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[CONFIG_SEED, &[config_bump]],
    )?;

    // Create vault account (zero data, just holds lamports)
    create_pda_account(
        admin,
        0,
        program_id,
        system_program,
        vault_account,
        &[VAULT_SEED, &[vault_bump]],
    )?;

    // Fund the vault: transfer total_allocation lamports from admin to vault
    solana_program::program::invoke(
        &solana_program::system_instruction::transfer(
            admin.key,
            vault_account.key,
            args.total_allocation,
        ),
        &[admin.clone(), vault_account.clone(), system_program.clone()],
    )?;

    let config = AirdropConfig {
        is_initialized: true,
        admin: *admin.key,
        merkle_root: args.merkle_root,
        total_allocation: args.total_allocation,
        total_claimed: 0,
        claim_count: 0,
        claim_start_slot: args.claim_start_slot,
        claim_end_slot: args.claim_end_slot,
        paused: false,
        bump: config_bump,
        vault_bump,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:AirdropInitialized:{{\"admin\":\"{}\",\"total_allocation\":{},\"start_slot\":{},\"end_slot\":{}}}",
        admin.key,
        args.total_allocation,
        args.claim_start_slot,
        args.claim_end_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: Claim
// ---------------------------------------------------------------------------

fn process_claim(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = ClaimArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    let account_iter = &mut accounts.iter();
    let claimant = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;
    let claim_record_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(claimant)?;
    assert_writable(config_account)?;
    assert_writable(vault_account)?;
    assert_writable(claim_record_account)?;
    assert_owned_by(config_account, program_id)?;

    // Validate config PDA
    let (config_pda, _) =
        Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    let mut config = AirdropConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(AirdropError::NotInitialized.into());
    }
    if config.paused {
        return Err(AirdropError::ProgramPaused.into());
    }

    // Check claim window
    let clock = Clock::get()?;
    let current_slot = clock.slot;
    if current_slot < config.claim_start_slot {
        return Err(AirdropError::ClaimNotStarted.into());
    }
    if current_slot > config.claim_end_slot {
        return Err(AirdropError::ClaimEnded.into());
    }

    // Validate vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    // Derive claim record PDA
    let (claim_pda, claim_bump) =
        Pubkey::find_program_address(&[CLAIM_SEED, claimant.key.as_ref()], program_id);
    if claim_record_account.key != &claim_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    // Double-claim check: claim record must not exist yet
    if !claim_record_account.data_is_empty() {
        return Err(AirdropError::AlreadyClaimed.into());
    }

    // Verify Merkle proof
    let leaf = compute_leaf(claimant.key, args.amount);
    if !verify_merkle_proof(&args.proof, &config.merkle_root, leaf) {
        return Err(AirdropError::InvalidMerkleProof.into());
    }

    // Check vault has sufficient balance (exclude rent-exempt minimum)
    let vault_balance = vault_account.lamports();
    if vault_balance < args.amount {
        return Err(AirdropError::InsufficientVault.into());
    }

    // Create claim record
    create_pda_account(
        claimant,
        ClaimRecord::SIZE,
        program_id,
        system_program,
        claim_record_account,
        &[CLAIM_SEED, claimant.key.as_ref(), &[claim_bump]],
    )?;

    let record = ClaimRecord {
        claimant: *claimant.key,
        amount: args.amount,
        claimed_at_slot: current_slot,
    };
    record.serialize(&mut &mut claim_record_account.data.borrow_mut()[..])?;

    // Transfer SOL from vault to claimant (PDA signed)
    **vault_account.try_borrow_mut_lamports()? = vault_account
        .lamports()
        .checked_sub(args.amount)
        .ok_or(AirdropError::Overflow)?;
    **claimant.try_borrow_mut_lamports()? = claimant
        .lamports()
        .checked_add(args.amount)
        .ok_or(AirdropError::Overflow)?;

    // Update config stats
    config.total_claimed = config
        .total_claimed
        .checked_add(args.amount)
        .ok_or(AirdropError::Overflow)?;
    config.claim_count = config
        .claim_count
        .checked_add(1)
        .ok_or(AirdropError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:AirdropClaimed:{{\"claimant\":\"{}\",\"amount\":{},\"slot\":{}}}",
        claimant.key,
        args.amount,
        current_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: UpdateMerkleRoot (admin-only)
// ---------------------------------------------------------------------------

fn process_update_merkle_root(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateMerkleRootArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    let mut config = AirdropConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(AirdropError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(AirdropError::Unauthorized.into());
    }

    config.merkle_root = args.new_merkle_root;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:MerkleRootUpdated:{{\"admin\":\"{}\"}}",
        admin.key,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: WithdrawUnclaimed (admin-only, after claim_end_slot)
// ---------------------------------------------------------------------------

fn process_withdraw_unclaimed(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = WithdrawUnclaimedArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let vault_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(vault_account)?;
    assert_owned_by(config_account, program_id)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    let config = AirdropConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(AirdropError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(AirdropError::Unauthorized.into());
    }

    // Only after claim window ends
    let clock = Clock::get()?;
    if clock.slot <= config.claim_end_slot {
        return Err(AirdropError::ClaimStillActive.into());
    }

    // Validate vault PDA
    let (vault_pda, _) =
        Pubkey::find_program_address(&[VAULT_SEED], program_id);
    if vault_account.key != &vault_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    // Check balance
    let vault_balance = vault_account.lamports();
    if vault_balance < args.amount {
        return Err(AirdropError::InsufficientVault.into());
    }

    // Transfer from vault to admin
    **vault_account.try_borrow_mut_lamports()? = vault_account
        .lamports()
        .checked_sub(args.amount)
        .ok_or(AirdropError::Overflow)?;
    **admin.try_borrow_mut_lamports()? = admin
        .lamports()
        .checked_add(args.amount)
        .ok_or(AirdropError::Overflow)?;

    msg!(
        "EVENT:UnclaimedWithdrawn:{{\"admin\":\"{}\",\"amount\":{}}}",
        admin.key,
        args.amount,
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
        Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    let mut config = AirdropConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(AirdropError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(AirdropError::Unauthorized.into());
    }

    config.paused = true;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:AirdropPaused:{{\"admin\":\"{}\"}}", admin.key);
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
        Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(AirdropError::InvalidPDA.into());
    }

    let mut config = AirdropConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(AirdropError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(AirdropError::Unauthorized.into());
    }

    config.paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:AirdropUnpaused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}
