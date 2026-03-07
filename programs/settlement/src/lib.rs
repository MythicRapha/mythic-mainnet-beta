// Mythic L2 — Settlement Program
// Posts L2 state roots to Solana L1 for verification and fraud proofs.

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

solana_program::declare_id!("4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHALLENGE_PERIOD_SLOTS: u64 = 151_200; // ~7 days at 400ms slots
const MAX_PROOF_DATA_LEN: usize = 10_240; // 10 KB
const SETTLEMENT_CONFIG_SEED: &[u8] = b"settlement_config";
const STATE_ROOT_SEED: &[u8] = b"state_root";
const CHALLENGE_SEED: &[u8] = b"challenge";
const PENDING_CONFIG_SEED: &[u8] = b"pending_config";
const TIMELOCK_DELAY: u64 = 216_000; // ~24 hours at 400ms/slot

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
        1 => process_post_state_root(program_id, accounts, data),
        2 => process_challenge_state_root(program_id, accounts, data),
        3 => process_resolve_challenge(program_id, accounts, data),
        4 => process_finalize_state_root(program_id, accounts, data),
        5 => process_update_config(program_id, accounts, data),
        6 => process_get_latest_finalized(program_id, accounts),
        7 => process_pause(program_id, accounts),
        8 => process_unpause(program_id, accounts),
        9 => process_propose_admin(program_id, accounts, data),
        10 => process_accept_admin(program_id, accounts),
        11 => process_propose_config_update(program_id, accounts, data),
        12 => process_execute_config_update(program_id, accounts),
        13 => process_close_state_root(program_id, accounts, data),
        _ => Err(SettlementError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SettlementError {
    #[error("Invalid instruction discriminator")]
    InvalidInstruction,
    #[error("Account already initialized")]
    AlreadyInitialized,
    #[error("Account not initialized")]
    NotInitialized,
    #[error("Unauthorized signer")]
    Unauthorized,
    #[error("Invalid sequencer")]
    InvalidSequencer,
    #[error("L2 slot must be greater than last posted slot")]
    SlotNotIncreasing,
    #[error("Previous state root mismatch")]
    PreviousStateRootMismatch,
    #[error("Challenge period has expired")]
    ChallengePeriodExpired,
    #[error("Challenge period has not expired yet")]
    ChallengePeriodNotExpired,
    #[error("State root is not in Posted status")]
    StateRootNotPosted,
    #[error("State root is not in Challenged or Posted status")]
    InvalidStateRootStatus,
    #[error("Challenge is not Active")]
    ChallengeNotActive,
    #[error("Proof data too large (max 10KB)")]
    ProofDataTooLarge,
    #[error("Insufficient challenger bond")]
    InsufficientBond,
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
    #[error("State root has valid challenges and cannot be finalized")]
    HasValidChallenges,
    #[error("Program is paused")]
    ProgramPaused,
    #[error("Timelock delay has not elapsed")]
    TimelockNotElapsed,
    #[error("Pending config update already exists")]
    PendingConfigExists,
    #[error("No pending config update")]
    NoPendingConfig,
    #[error("State root cannot be closed in current status")]
    StateRootNotCloseable,
}

impl From<SettlementError> for ProgramError {
    fn from(e: SettlementError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct SettlementConfig {
    pub is_initialized: bool,
    pub admin: Pubkey,
    pub sequencer: Pubkey,
    pub challenge_period_slots: u64,
    pub l2_chain_id: [u8; 16],
    pub min_challenger_bond: u64,
    pub last_posted_slot: u64,
    pub last_state_root: [u8; 32],
    pub last_finalized_slot: u64,
    pub total_roots_posted: u64,
    pub total_challenges: u64,
    pub is_paused: bool,
    pub bump: u8,
    pub pending_admin: Pubkey,
}

impl SettlementConfig {
    pub const SIZE: usize = 1 + 32 + 32 + 8 + 16 + 8 + 8 + 32 + 8 + 8 + 8 + 1 + 1 + 32; // 195
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum StateRootStatus {
    Posted = 0,
    Challenged = 1,
    Finalized = 2,
    Invalidated = 3,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct StateRootAccount {
    pub l2_slot: u64,
    pub state_root: [u8; 32],
    pub transaction_count: u32,
    pub transaction_batch_hash: [u8; 32],
    pub ai_attestation_count: u16,
    pub previous_state_root: [u8; 32],
    pub sequencer: Pubkey,
    pub posted_at: i64,
    pub challenge_deadline: i64,
    pub status: StateRootStatus,
    pub bump: u8,
}

impl StateRootAccount {
    pub const SIZE: usize = 8 + 32 + 4 + 32 + 2 + 32 + 32 + 8 + 8 + 1 + 1; // 160
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum FraudProofType {
    InvalidStateTransition = 0,
    InvalidMerkleProof = 1,
    InvalidAIAttestation = 2,
    DoubleSequencing = 3,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum ChallengeStatus {
    Active = 0,
    Accepted = 1,
    Rejected = 2,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ChallengeAccount {
    pub l2_slot: u64,
    pub challenger: Pubkey,
    pub fraud_proof_type: FraudProofType,
    pub proof_data_hash: [u8; 32],
    pub bond_amount: u64,
    pub created_at: i64,
    pub status: ChallengeStatus,
    pub bump: u8,
}

impl ChallengeAccount {
    pub const SIZE: usize = 8 + 32 + 1 + 32 + 8 + 8 + 1 + 1; // 91
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct PendingConfigUpdate {
    pub sequencer: Option<Pubkey>,
    pub challenge_period_slots: Option<u64>,
    pub min_challenger_bond: Option<u64>,
    pub propose_slot: u64,
    pub execution_slot: u64,
    pub proposer: Pubkey,
    pub bump: u8,
}

impl PendingConfigUpdate {
    // 1+32 + 1+8 + 1+8 + 8 + 8 + 32 + 1 = 100
    pub const SIZE: usize = 33 + 9 + 9 + 8 + 8 + 32 + 1;
}

// ---------------------------------------------------------------------------
// Instruction data structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub challenge_period_slots: u64,
    pub l2_chain_id: [u8; 16],
    pub min_challenger_bond: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct PostStateRootArgs {
    pub l2_slot: u64,
    pub state_root: [u8; 32],
    pub transaction_count: u32,
    pub transaction_batch_hash: [u8; 32],
    pub ai_attestation_count: u16,
    pub previous_state_root: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ChallengeStateRootArgs {
    pub l2_slot: u64,
    pub fraud_proof_type: FraudProofType,
    pub proof_data: Vec<u8>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ResolveChallengeArgs {
    pub l2_slot: u64,
    pub challenger: Pubkey,
    pub is_valid: bool,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct FinalizeStateRootArgs {
    pub l2_slot: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateConfigArgs {
    pub sequencer: Option<Pubkey>,
    pub challenge_period_slots: Option<u64>,
    pub min_challenger_bond: Option<u64>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ProposeConfigUpdateArgs {
    pub sequencer: Option<Pubkey>,
    pub challenge_period_slots: Option<u64>,
    pub min_challenger_bond: Option<u64>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct CloseStateRootArgs {
    pub l2_slot: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(SettlementError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(SettlementError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(SettlementError::InvalidOwner.into());
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

fn hash_proof_data(data: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
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

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let sequencer_info = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;

    // Derive config PDA
    let (config_pda, config_bump) =
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    // Check not already initialized
    if !config_account.data_is_empty() {
        return Err(SettlementError::AlreadyInitialized.into());
    }

    // Create the PDA account
    create_pda_account(
        admin,
        SettlementConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[SETTLEMENT_CONFIG_SEED, &[config_bump]],
    )?;

    let challenge_period = if args.challenge_period_slots == 0 {
        DEFAULT_CHALLENGE_PERIOD_SLOTS
    } else {
        args.challenge_period_slots
    };

    let config = SettlementConfig {
        is_initialized: true,
        admin: *admin.key,
        sequencer: *sequencer_info.key,
        challenge_period_slots: challenge_period,
        l2_chain_id: args.l2_chain_id,
        min_challenger_bond: args.min_challenger_bond,
        last_posted_slot: 0,
        last_state_root: [0u8; 32],
        last_finalized_slot: 0,
        total_roots_posted: 0,
        total_challenges: 0,
        is_paused: false,
        bump: config_bump,
        pending_admin: Pubkey::default(),
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:SettlementInitialized:{{\"admin\":\"{}\",\"sequencer\":\"{}\",\"challenge_period\":{}}}",
        admin.key,
        sequencer_info.key,
        challenge_period,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: PostStateRoot
// ---------------------------------------------------------------------------

fn process_post_state_root(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = PostStateRootArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let sequencer = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let state_root_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(sequencer)?;
    assert_writable(config_account)?;
    assert_writable(state_root_account)?;
    assert_owned_by(config_account, program_id)?;

    // Load config
    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if sequencer.key != &config.sequencer {
        return Err(SettlementError::InvalidSequencer.into());
    }
    if config.is_paused {
        return Err(SettlementError::ProgramPaused.into());
    }

    // Validate slot ordering
    if args.l2_slot <= config.last_posted_slot && config.last_posted_slot != 0 {
        return Err(SettlementError::SlotNotIncreasing.into());
    }

    // Validate previous state root chain (skip for first post)
    if config.last_posted_slot != 0 && args.previous_state_root != config.last_state_root {
        return Err(SettlementError::PreviousStateRootMismatch.into());
    }

    // Derive state root PDA
    let l2_slot_bytes = args.l2_slot.to_le_bytes();
    let (state_root_pda, state_root_bump) =
        Pubkey::find_program_address(&[STATE_ROOT_SEED, &l2_slot_bytes], program_id);
    if state_root_account.key != &state_root_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    // Create state root account
    create_pda_account(
        sequencer,
        StateRootAccount::SIZE,
        program_id,
        system_program,
        state_root_account,
        &[STATE_ROOT_SEED, &l2_slot_bytes, &[state_root_bump]],
    )?;

    let clock = Clock::get()?;
    let deadline_slot = clock
        .slot
        .checked_add(config.challenge_period_slots)
        .ok_or(SettlementError::Overflow)?;
    let challenge_deadline = i64::try_from(deadline_slot)
        .map_err(|_| SettlementError::Overflow)?;

    let state_root = StateRootAccount {
        l2_slot: args.l2_slot,
        state_root: args.state_root,
        transaction_count: args.transaction_count,
        transaction_batch_hash: args.transaction_batch_hash,
        ai_attestation_count: args.ai_attestation_count,
        previous_state_root: args.previous_state_root,
        sequencer: *sequencer.key,
        posted_at: clock.unix_timestamp,
        challenge_deadline,
        status: StateRootStatus::Posted,
        bump: state_root_bump,
    };

    state_root.serialize(&mut &mut state_root_account.data.borrow_mut()[..])?;

    // Update config
    config.last_posted_slot = args.l2_slot;
    config.last_state_root = args.state_root;
    config.total_roots_posted = config
        .total_roots_posted
        .checked_add(1)
        .ok_or(SettlementError::Overflow)?;

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:StateRootPosted:{{\"l2_slot\":{},\"tx_count\":{},\"ai_attestations\":{}}}",
        args.l2_slot,
        args.transaction_count,
        args.ai_attestation_count,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ChallengeStateRoot
// ---------------------------------------------------------------------------

fn process_challenge_state_root(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = ChallengeStateRootArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.proof_data.len() > MAX_PROOF_DATA_LEN {
        return Err(SettlementError::ProofDataTooLarge.into());
    }

    let account_iter = &mut accounts.iter();
    let challenger = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let state_root_account = next_account_info(account_iter)?;
    let challenge_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(challenger)?;
    assert_writable(state_root_account)?;
    assert_writable(challenge_account)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(state_root_account, program_id)?;

    // Load config
    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(SettlementError::ProgramPaused.into());
    }

    // Load state root
    let mut state_root =
        StateRootAccount::try_from_slice(&state_root_account.data.borrow())?;
    if state_root.status != StateRootStatus::Posted && state_root.status != StateRootStatus::Challenged {
        return Err(SettlementError::StateRootNotPosted.into());
    }

    // Check challenge period
    let clock = Clock::get()?;
    if (clock.slot as i64) > state_root.challenge_deadline {
        return Err(SettlementError::ChallengePeriodExpired.into());
    }

    // Check bond — challenger must have enough for rent + full escrow bond
    let rent = Rent::get()?;
    let rent_lamports = rent.minimum_balance(ChallengeAccount::SIZE);
    let total_required = rent_lamports
        .checked_add(config.min_challenger_bond)
        .ok_or(SettlementError::Overflow)?;
    if challenger.lamports() < total_required {
        return Err(SettlementError::InsufficientBond.into());
    }

    // Derive challenge PDA
    let l2_slot_bytes = args.l2_slot.to_le_bytes();
    let (challenge_pda, challenge_bump) = Pubkey::find_program_address(
        &[CHALLENGE_SEED, &l2_slot_bytes, challenger.key.as_ref()],
        program_id,
    );
    if challenge_account.key != &challenge_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    // Create challenge account
    create_pda_account(
        challenger,
        ChallengeAccount::SIZE,
        program_id,
        system_program,
        challenge_account,
        &[
            CHALLENGE_SEED,
            &l2_slot_bytes,
            challenger.key.as_ref(),
            &[challenge_bump],
        ],
    )?;

    // Escrow the full challenger bond into the challenge PDA.
    // The create_account above only funded rent; now transfer the entire bond
    // so it can be slashed or returned on resolution.
    invoke(
        &system_instruction::transfer(
            challenger.key,
            challenge_account.key,
            config.min_challenger_bond,
        ),
        &[challenger.clone(), challenge_account.clone(), system_program.clone()],
    )?;

    let proof_data_hash = hash_proof_data(&args.proof_data);

    let challenge = ChallengeAccount {
        l2_slot: args.l2_slot,
        challenger: *challenger.key,
        fraud_proof_type: args.fraud_proof_type,
        proof_data_hash,
        bond_amount: config.min_challenger_bond,
        created_at: clock.unix_timestamp,
        status: ChallengeStatus::Active,
        bump: challenge_bump,
    };

    challenge.serialize(&mut &mut challenge_account.data.borrow_mut()[..])?;

    // Update state root status
    state_root.status = StateRootStatus::Challenged;
    state_root.serialize(&mut &mut state_root_account.data.borrow_mut()[..])?;

    // Update config stats
    config.total_challenges = config
        .total_challenges
        .checked_add(1)
        .ok_or(SettlementError::Overflow)?;
    assert_writable(config_account)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:StateRootChallenged:{{\"l2_slot\":{},\"challenger\":\"{}\",\"fraud_type\":{}}}",
        args.l2_slot,
        challenger.key,
        args.fraud_proof_type as u8,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ResolveChallenge
// ---------------------------------------------------------------------------

fn process_resolve_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = ResolveChallengeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let state_root_account = next_account_info(account_iter)?;
    let challenge_account = next_account_info(account_iter)?;
    let challenger_account = next_account_info(account_iter)?;
    let state_root_poster = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(state_root_account)?;
    assert_writable(challenge_account)?;
    assert_writable(challenger_account)?;
    assert_writable(state_root_poster)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(state_root_account, program_id)?;
    assert_owned_by(challenge_account, program_id)?;

    // Load config
    let config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    // Validate challenge PDA
    let l2_slot_bytes = args.l2_slot.to_le_bytes();
    let (challenge_pda, _) = Pubkey::find_program_address(
        &[CHALLENGE_SEED, &l2_slot_bytes, args.challenger.as_ref()],
        program_id,
    );
    if challenge_account.key != &challenge_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    // Load challenge
    let mut challenge =
        ChallengeAccount::try_from_slice(&challenge_account.data.borrow())?;
    if challenge.status != ChallengeStatus::Active {
        return Err(SettlementError::ChallengeNotActive.into());
    }
    if challenger_account.key != &challenge.challenger {
        return Err(SettlementError::Unauthorized.into());
    }

    // Load state root
    let mut state_root =
        StateRootAccount::try_from_slice(&state_root_account.data.borrow())?;

    // Validate that state_root_poster matches the sequencer who posted this root
    if state_root_poster.key != &state_root.sequencer {
        return Err(SettlementError::InvalidSequencer.into());
    }

    if args.is_valid {
        // Challenge accepted: state root is invalid, return escrowed bond to challenger
        challenge.status = ChallengeStatus::Accepted;
        state_root.status = StateRootStatus::Invalidated;

        // Return all lamports (rent + escrowed bond) from challenge PDA to challenger
        let challenge_lamports = challenge_account.lamports();
        **challenge_account.try_borrow_mut_lamports()? = 0;
        **challenger_account.try_borrow_mut_lamports()? = challenger_account
            .lamports()
            .checked_add(challenge_lamports)
            .ok_or(SettlementError::Overflow)?;

        msg!(
            "EVENT:ChallengeAccepted:{{\"l2_slot\":{},\"challenger\":\"{}\",\"bond_returned\":{}}}",
            args.l2_slot,
            args.challenger,
            challenge.bond_amount,
        );
    } else {
        // Challenge rejected: slash the escrowed bond to the state root poster
        challenge.status = ChallengeStatus::Rejected;

        // Transfer all lamports (rent + escrowed bond) to the state root poster
        let challenge_lamports = challenge_account.lamports();
        **challenge_account.try_borrow_mut_lamports()? = 0;
        **state_root_poster.try_borrow_mut_lamports()? = state_root_poster
            .lamports()
            .checked_add(challenge_lamports)
            .ok_or(SettlementError::Overflow)?;

        // If no other active challenges, revert state root to Posted
        // (simplification: admin can finalize later if no valid challenges remain)
        if state_root.status == StateRootStatus::Challenged {
            state_root.status = StateRootStatus::Posted;
        }

        msg!(
            "EVENT:ChallengeRejected:{{\"l2_slot\":{},\"challenger\":\"{}\",\"bond_slashed\":{},\"slashed_to\":\"{}\"}}",
            args.l2_slot,
            args.challenger,
            challenge.bond_amount,
            state_root_poster.key,
        );
    }

    // Zero out challenge account data before closing
    let data_len = challenge_account.data.borrow().len();
    challenge_account.data.borrow_mut()[..data_len].fill(0);

    state_root.serialize(&mut &mut state_root_account.data.borrow_mut()[..])?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: FinalizeStateRoot
// ---------------------------------------------------------------------------

fn process_finalize_state_root(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = FinalizeStateRootArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let _caller = next_account_info(account_iter)?; // anyone can call
    let config_account = next_account_info(account_iter)?;
    let state_root_account = next_account_info(account_iter)?;

    assert_writable(config_account)?;
    assert_writable(state_root_account)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(state_root_account, program_id)?;

    // Load config
    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }

    // Validate state root PDA
    let l2_slot_bytes = args.l2_slot.to_le_bytes();
    let (state_root_pda, _) =
        Pubkey::find_program_address(&[STATE_ROOT_SEED, &l2_slot_bytes], program_id);
    if state_root_account.key != &state_root_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    // Load state root
    let mut state_root =
        StateRootAccount::try_from_slice(&state_root_account.data.borrow())?;

    // Only Posted roots can be finalized (Challenged roots need resolution first)
    if state_root.status != StateRootStatus::Posted {
        if state_root.status == StateRootStatus::Challenged {
            return Err(SettlementError::HasValidChallenges.into());
        }
        return Err(SettlementError::InvalidStateRootStatus.into());
    }

    // Check challenge period has passed
    let clock = Clock::get()?;
    if (clock.slot as i64) <= state_root.challenge_deadline {
        return Err(SettlementError::ChallengePeriodNotExpired.into());
    }

    state_root.status = StateRootStatus::Finalized;
    state_root.serialize(&mut &mut state_root_account.data.borrow_mut()[..])?;

    // Update config
    config.last_finalized_slot = args.l2_slot;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:StateRootFinalized:{{\"l2_slot\":{}}}",
        args.l2_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: UpdateConfig
// ---------------------------------------------------------------------------

fn process_update_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateConfigArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    if let Some(sequencer) = args.sequencer {
        config.sequencer = sequencer;
    }
    if let Some(period) = args.challenge_period_slots {
        if period < 900 {
            // Minimum ~6 minutes at 400ms slots
            return Err(ProgramError::InvalidArgument);
        }
        config.challenge_period_slots = period;
    }
    if let Some(bond) = args.min_challenger_bond {
        config.min_challenger_bond = bond;
    }

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:ConfigUpdated:{{\"admin\":\"{}\"}}", admin.key);

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: GetLatestFinalized (read-only)
// ---------------------------------------------------------------------------

fn process_get_latest_finalized(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let config_account = next_account_info(account_iter)?;

    assert_owned_by(config_account, program_id)?;

    let config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }

    msg!(
        "EVENT:LatestFinalized:{{\"last_finalized_slot\":{},\"last_posted_slot\":{},\"total_roots\":{}}}",
        config.last_finalized_slot,
        config.last_posted_slot,
        config.total_roots_posted,
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
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
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
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    config.is_paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:Unpaused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ProposeAdmin (two-step admin rotation)
// Accounts: 0=[signer] current admin, 1=[writable] config PDA
// ---------------------------------------------------------------------------

fn process_propose_admin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let new_admin = Pubkey::try_from(&data[..32])
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    config.pending_admin = new_admin;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ProposeAdmin:{{\"current_admin\":\"{}\",\"pending_admin\":\"{}\"}}",
        admin.key, new_admin
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: AcceptAdmin (completes two-step admin rotation)
// Accounts: 0=[signer] pending admin, 1=[writable] config PDA
// ---------------------------------------------------------------------------

fn process_accept_admin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let new_admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(new_admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }

    if config.pending_admin == Pubkey::default() {
        return Err(SettlementError::Unauthorized.into());
    }
    if *new_admin.key != config.pending_admin {
        return Err(SettlementError::Unauthorized.into());
    }

    let old_admin = config.admin;
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:AcceptAdmin:{{\"old_admin\":\"{}\",\"new_admin\":\"{}\"}}",
        old_admin, new_admin.key
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ProposeConfigUpdate (timelock step 1)
// Accounts: 0=[signer, writable] admin (payer), 1=[] config PDA,
//           2=[writable] pending_config PDA, 3=[] system_program
// ---------------------------------------------------------------------------

fn process_propose_config_update(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = ProposeConfigUpdateArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let pending_config_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(pending_config_account)?;
    assert_owned_by(config_account, program_id)?;

    // Validate config PDA
    let (config_pda, _) =
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    // Validate pending config PDA
    let (pending_pda, pending_bump) =
        Pubkey::find_program_address(&[PENDING_CONFIG_SEED], program_id);
    if pending_config_account.key != &pending_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    // Ensure no pending update already exists
    if !pending_config_account.data_is_empty() {
        return Err(SettlementError::PendingConfigExists.into());
    }

    // Validate proposed values
    if let Some(period) = args.challenge_period_slots {
        if period < 900 {
            return Err(ProgramError::InvalidArgument);
        }
    }

    let clock = Clock::get()?;
    let propose_slot = clock.slot;
    let execution_slot = propose_slot
        .checked_add(TIMELOCK_DELAY)
        .ok_or(SettlementError::Overflow)?;

    // Create pending config PDA
    create_pda_account(
        admin,
        PendingConfigUpdate::SIZE,
        program_id,
        system_program,
        pending_config_account,
        &[PENDING_CONFIG_SEED, &[pending_bump]],
    )?;

    let pending = PendingConfigUpdate {
        sequencer: args.sequencer,
        challenge_period_slots: args.challenge_period_slots,
        min_challenger_bond: args.min_challenger_bond,
        propose_slot,
        execution_slot,
        proposer: *admin.key,
        bump: pending_bump,
    };

    pending.serialize(&mut &mut pending_config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ProposeConfigUpdate:{{\"admin\":\"{}\",\"execution_slot\":{}}}",
        admin.key,
        execution_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: ExecuteConfigUpdate (timelock step 2)
// Accounts: 0=[signer] admin, 1=[writable] config PDA,
//           2=[writable] pending_config PDA
// ---------------------------------------------------------------------------

fn process_execute_config_update(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let pending_config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_writable(pending_config_account)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(pending_config_account, program_id)?;

    // Validate config PDA
    let (config_pda, _) =
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let mut config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    // Validate pending config PDA
    let (pending_pda, _) =
        Pubkey::find_program_address(&[PENDING_CONFIG_SEED], program_id);
    if pending_config_account.key != &pending_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    if pending_config_account.data_is_empty() {
        return Err(SettlementError::NoPendingConfig.into());
    }

    let pending =
        PendingConfigUpdate::try_from_slice(&pending_config_account.data.borrow())?;

    // Verify the timelock delay has elapsed
    let clock = Clock::get()?;
    if clock.slot < pending.execution_slot {
        return Err(SettlementError::TimelockNotElapsed.into());
    }

    // Apply the pending config updates
    if let Some(sequencer) = pending.sequencer {
        config.sequencer = sequencer;
    }
    if let Some(period) = pending.challenge_period_slots {
        config.challenge_period_slots = period;
    }
    if let Some(bond) = pending.min_challenger_bond {
        config.min_challenger_bond = bond;
    }

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    // Close the pending config account: zero data, return lamports to admin
    let pending_lamports = pending_config_account.lamports();
    let data_len = pending_config_account.data.borrow().len();
    pending_config_account.data.borrow_mut()[..data_len].fill(0);
    **pending_config_account.try_borrow_mut_lamports()? = 0;
    **admin.try_borrow_mut_lamports()? = admin
        .lamports()
        .checked_add(pending_lamports)
        .ok_or(SettlementError::Overflow)?;

    msg!(
        "EVENT:ExecuteConfigUpdate:{{\"admin\":\"{}\",\"applied_at_slot\":{}}}",
        admin.key,
        clock.slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction: CloseStateRoot (reclaim rent from finalized state roots)
// Accounts: 0=[signer] admin, 1=[] config PDA, 2=[writable] state_root PDA,
//           3=[writable] rent_recipient (admin)
// ---------------------------------------------------------------------------

fn process_close_state_root(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CloseStateRootArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let state_root_account = next_account_info(account_iter)?;
    let rent_recipient = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(state_root_account)?;
    assert_writable(rent_recipient)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(state_root_account, program_id)?;

    // Validate config PDA
    let (config_pda, _) =
        Pubkey::find_program_address(&[SETTLEMENT_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let config =
        SettlementConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(SettlementError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(SettlementError::Unauthorized.into());
    }

    // Validate state root PDA
    let l2_slot_bytes = args.l2_slot.to_le_bytes();
    let (state_root_pda, _) =
        Pubkey::find_program_address(&[STATE_ROOT_SEED, &l2_slot_bytes], program_id);
    if state_root_account.key != &state_root_pda {
        return Err(SettlementError::InvalidPDA.into());
    }

    let state_root =
        StateRootAccount::try_from_slice(&state_root_account.data.borrow())?;

    // Only finalized state roots can be closed
    if state_root.status != StateRootStatus::Finalized {
        return Err(SettlementError::StateRootNotCloseable.into());
    }

    // Zero account data before closing
    let data_len = state_root_account.data.borrow().len();
    state_root_account.data.borrow_mut()[..data_len].fill(0);

    // Transfer lamports to admin (rent refund)
    let state_root_lamports = state_root_account.lamports();
    **state_root_account.try_borrow_mut_lamports()? = 0;
    **rent_recipient.try_borrow_mut_lamports()? = rent_recipient
        .lamports()
        .checked_add(state_root_lamports)
        .ok_or(SettlementError::Overflow)?;

    msg!(
        "EVENT:CloseStateRoot:{{\"l2_slot\":{},\"lamports_refunded\":{}}}",
        args.l2_slot,
        state_root_lamports,
    );

    Ok(())
}
