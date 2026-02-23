// Mythic L2 — Governance Program
// On-chain governance: create proposals, vote with MYTH weight, execute after quorum.

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

solana_program::declare_id!("MythGov111111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOVERNANCE_CONFIG_SEED: &[u8] = b"governance_config";
const PROPOSAL_SEED: &[u8] = b"proposal";
const VOTE_RECORD_SEED: &[u8] = b"vote";
const GOVERNANCE_TREASURY_SEED: &[u8] = b"governance_treasury";

const MAX_TITLE_LEN: usize = 64;

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
        1 => process_create_proposal(program_id, accounts, data),
        2 => process_cast_vote(program_id, accounts, data),
        3 => process_execute_proposal(program_id, accounts, data),
        4 => process_cancel_proposal(program_id, accounts, data),
        5 => process_set_voting_power(program_id, accounts, data),
        6 => process_delegate_voting_power(program_id, accounts, data),
        7 => process_treasury_withdraw(program_id, accounts, data),
        8 => process_transfer_admin(program_id, accounts, data),
        _ => Err(GovernanceError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum GovernanceError {
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
    #[error("Title exceeds 64 bytes")]
    TitleTooLong,
    #[error("Insufficient voting power to create proposal")]
    InsufficientVotingPower,
    #[error("Proposal is not active")]
    ProposalNotActive,
    #[error("Voting period has ended")]
    VotingPeriodEnded,
    #[error("Voting period has not ended")]
    VotingPeriodNotEnded,
    #[error("Already voted on this proposal")]
    AlreadyVoted,
    #[error("Quorum not reached")]
    QuorumNotReached,
    #[error("Proposal did not pass (no majority)")]
    ProposalDidNotPass,
    #[error("Proposal already executed")]
    ProposalAlreadyExecuted,
    #[error("Vote weight must be greater than zero")]
    ZeroVoteWeight,
    #[error("Invalid voting period (must be > 0)")]
    InvalidVotingPeriod,
    #[error("Treasury has insufficient funds")]
    TreasuryInsufficientFunds,
    #[error("Proposal must be executed before treasury action")]
    ProposalNotExecuted,
    #[error("Self-delegation is not allowed")]
    SelfDelegation,
    #[error("Delegation amount exceeds available power")]
    DelegationExceedsPower,
}

impl From<GovernanceError> for ProgramError {
    fn from(e: GovernanceError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State: GovernanceConfig
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct GovernanceConfig {
    pub is_initialized: bool,       // 1
    pub admin: Pubkey,              // 32
    pub proposal_count: u64,        // 8
    pub voting_period: u64,         // 8  (in slots)
    pub quorum_votes: u64,          // 8  (minimum total votes for quorum)
    pub proposal_threshold: u64,    // 8  (minimum MYTH to create proposal)
    pub treasury_vault: Pubkey,     // 32
    pub bump: u8,                   // 1
}

impl GovernanceConfig {
    // 1 + 32 + 8 + 8 + 8 + 8 + 32 + 1 = 98
    pub const SIZE: usize = 98;
}

// ---------------------------------------------------------------------------
// State: Proposal
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum ProposalStatus {
    Active = 0,
    Passed = 1,
    Failed = 2,
    Executed = 3,
    Cancelled = 4,
}

impl TryFrom<u8> for ProposalStatus {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(ProposalStatus::Active),
            1 => Ok(ProposalStatus::Passed),
            2 => Ok(ProposalStatus::Failed),
            3 => Ok(ProposalStatus::Executed),
            4 => Ok(ProposalStatus::Cancelled),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Proposal {
    pub is_initialized: bool,           // 1
    pub id: u64,                        // 8
    pub creator: Pubkey,                // 32
    pub title: [u8; 64],               // 64
    pub description_hash: [u8; 32],    // 32
    pub start_slot: u64,                // 8
    pub end_slot: u64,                  // 8
    pub yes_votes: u64,                 // 8
    pub no_votes: u64,                  // 8
    pub status: u8,                     // 1  (ProposalStatus as u8)
    pub executed_at: i64,               // 8
    pub bump: u8,                       // 1
}

impl Proposal {
    // 1 + 8 + 32 + 64 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 1 = 179
    pub const SIZE: usize = 179;

    pub fn get_status(&self) -> Result<ProposalStatus, ProgramError> {
        ProposalStatus::try_from(self.status)
    }
}

// ---------------------------------------------------------------------------
// State: VoteRecord
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum VoteSide {
    Yes = 0,
    No = 1,
}

impl TryFrom<u8> for VoteSide {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(VoteSide::Yes),
            1 => Ok(VoteSide::No),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VoteRecord {
    pub is_initialized: bool,   // 1
    pub voter: Pubkey,          // 32
    pub proposal_id: u64,       // 8
    pub vote_weight: u64,       // 8
    pub vote_side: u8,          // 1  (VoteSide as u8)
    pub bump: u8,               // 1
}

impl VoteRecord {
    // 1 + 32 + 8 + 8 + 1 + 1 = 51
    pub const SIZE: usize = 51;
}

// ---------------------------------------------------------------------------
// State: VotingPower (snapshot-based registration)
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VotingPower {
    pub is_initialized: bool,       // 1
    pub voter: Pubkey,              // 32
    pub power: u64,                 // 8  (own voting power from MYTH snapshot)
    pub delegated_power: u64,       // 8  (power received from others)
    pub delegated_to: Pubkey,       // 32 (who this voter delegates to; Pubkey::default = none)
    pub delegated_amount: u64,      // 8  (how much power delegated away)
    pub updated_at: i64,            // 8
    pub bump: u8,                   // 1
}

impl VotingPower {
    // 1 + 32 + 8 + 8 + 32 + 8 + 8 + 1 = 98
    pub const SIZE: usize = 98;

    /// Effective voting power = own power - delegated_away + received_delegations
    pub fn effective_power(&self) -> Result<u64, ProgramError> {
        self.power
            .checked_sub(self.delegated_amount)
            .ok_or(GovernanceError::Overflow)?
            .checked_add(self.delegated_power)
            .ok_or(GovernanceError::Overflow.into())
    }
}

const VOTING_POWER_SEED: &[u8] = b"voting_power";

// ---------------------------------------------------------------------------
// Instruction data structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub voting_period: u64,
    pub quorum_votes: u64,
    pub proposal_threshold: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct CreateProposalArgs {
    pub title: String,
    pub description_hash: [u8; 32],
    pub voting_period: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct CastVoteArgs {
    pub proposal_id: u64,
    pub vote_side: u8,
    pub vote_weight: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SetVotingPowerArgs {
    pub voter: Pubkey,
    pub power: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DelegateVotingPowerArgs {
    pub delegate_to: Pubkey,
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct TreasuryWithdrawArgs {
    pub proposal_id: u64,
    pub amount: u64,
    pub recipient: Pubkey,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct TransferAdminArgs {
    pub new_admin: Pubkey,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(GovernanceError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(GovernanceError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(GovernanceError::InvalidOwner.into());
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
        &system_instruction::create_account(
            payer.key,
            new_account.key,
            lamports,
            space as u64,
            owner,
        ),
        &[payer.clone(), new_account.clone(), system_program.clone()],
        &[seeds],
    )
}

/// Copy a string into a fixed-size byte array, zero-padding the rest.
fn string_to_fixed<const N: usize>(s: &str) -> [u8; N] {
    let mut buf = [0u8; N];
    let bytes = s.as_bytes();
    let len = bytes.len().min(N);
    buf[..len].copy_from_slice(&bytes[..len]);
    buf
}

// ---------------------------------------------------------------------------
// Instruction 0: Initialize
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] admin
//   1. [writable]          governance_config PDA
//   2. []                  system_program

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.voting_period == 0 {
        return Err(GovernanceError::InvalidVotingPeriod.into());
    }

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;

    // Derive config PDA
    let (config_pda, config_bump) =
        Pubkey::find_program_address(&[GOVERNANCE_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    if !config_account.data_is_empty() {
        return Err(GovernanceError::AlreadyInitialized.into());
    }

    create_pda_account(
        admin,
        GovernanceConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[GOVERNANCE_CONFIG_SEED, &[config_bump]],
    )?;

    // Derive treasury PDA
    let (treasury_pda, _) =
        Pubkey::find_program_address(&[GOVERNANCE_TREASURY_SEED], program_id);

    let config = GovernanceConfig {
        is_initialized: true,
        admin: *admin.key,
        proposal_count: 0,
        voting_period: args.voting_period,
        quorum_votes: args.quorum_votes,
        proposal_threshold: args.proposal_threshold,
        treasury_vault: treasury_pda,
        bump: config_bump,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:GovernanceInitialized:{{\"admin\":\"{}\",\"voting_period\":{},\"quorum_votes\":{},\"proposal_threshold\":{},\"treasury\":\"{}\"}}",
        admin.key,
        args.voting_period,
        args.quorum_votes,
        args.proposal_threshold,
        treasury_pda,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 1: CreateProposal
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] creator
//   1. [writable]          governance_config PDA
//   2. [writable]          proposal PDA (seeds: ["proposal", proposal_id as le_bytes])
//   3. []                  voting_power PDA (seeds: ["voting_power", creator])
//   4. []                  system_program

fn process_create_proposal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CreateProposalArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.title.len() > MAX_TITLE_LEN {
        return Err(GovernanceError::TitleTooLong.into());
    }
    if args.voting_period == 0 {
        return Err(GovernanceError::InvalidVotingPeriod.into());
    }

    let account_iter = &mut accounts.iter();
    let creator = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let proposal_account = next_account_info(account_iter)?;
    let voting_power_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(creator)?;
    assert_writable(creator)?;
    assert_writable(config_account)?;
    assert_writable(proposal_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = GovernanceConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }

    // Check voting power meets proposal threshold
    if config.proposal_threshold > 0 {
        assert_owned_by(voting_power_account, program_id)?;

        // Validate voting_power PDA
        let (vp_pda, _) =
            Pubkey::find_program_address(&[VOTING_POWER_SEED, creator.key.as_ref()], program_id);
        if voting_power_account.key != &vp_pda {
            return Err(GovernanceError::InvalidPDA.into());
        }

        let vp = VotingPower::try_from_slice(&voting_power_account.data.borrow())?;
        if !vp.is_initialized {
            return Err(GovernanceError::InsufficientVotingPower.into());
        }
        let effective = vp.effective_power()?;
        if effective < config.proposal_threshold {
            return Err(GovernanceError::InsufficientVotingPower.into());
        }
    }

    let proposal_id = config.proposal_count;
    let proposal_id_bytes = proposal_id.to_le_bytes();

    // Derive proposal PDA
    let (proposal_pda, proposal_bump) =
        Pubkey::find_program_address(&[PROPOSAL_SEED, &proposal_id_bytes], program_id);
    if proposal_account.key != &proposal_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    if !proposal_account.data_is_empty() {
        return Err(GovernanceError::AlreadyInitialized.into());
    }

    create_pda_account(
        creator,
        Proposal::SIZE,
        program_id,
        system_program,
        proposal_account,
        &[PROPOSAL_SEED, &proposal_id_bytes, &[proposal_bump]],
    )?;

    let clock = Clock::get()?;
    let start_slot = clock.slot;
    let end_slot = start_slot
        .checked_add(args.voting_period)
        .ok_or(GovernanceError::Overflow)?;

    let proposal = Proposal {
        is_initialized: true,
        id: proposal_id,
        creator: *creator.key,
        title: string_to_fixed::<64>(&args.title),
        description_hash: args.description_hash,
        start_slot,
        end_slot,
        yes_votes: 0,
        no_votes: 0,
        status: ProposalStatus::Active as u8,
        executed_at: 0,
        bump: proposal_bump,
    };

    proposal.serialize(&mut &mut proposal_account.data.borrow_mut()[..])?;

    // Increment proposal count
    config.proposal_count = config
        .proposal_count
        .checked_add(1)
        .ok_or(GovernanceError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ProposalCreated:{{\"id\":{},\"creator\":\"{}\",\"title\":\"{}\",\"start_slot\":{},\"end_slot\":{}}}",
        proposal_id,
        creator.key,
        args.title,
        start_slot,
        end_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 2: CastVote
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] voter
//   1. [writable]          proposal PDA
//   2. [writable]          vote_record PDA (seeds: ["vote", proposal_id as le_bytes, voter])
//   3. []                  voting_power PDA (seeds: ["voting_power", voter])
//   4. []                  system_program

fn process_cast_vote(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CastVoteArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.vote_weight == 0 {
        return Err(GovernanceError::ZeroVoteWeight.into());
    }

    let vote_side = VoteSide::try_from(args.vote_side)?;

    let account_iter = &mut accounts.iter();
    let voter = next_account_info(account_iter)?;
    let proposal_account = next_account_info(account_iter)?;
    let vote_record_account = next_account_info(account_iter)?;
    let voting_power_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(voter)?;
    assert_writable(voter)?;
    assert_writable(proposal_account)?;
    assert_writable(vote_record_account)?;
    assert_owned_by(proposal_account, program_id)?;

    // Load and validate proposal
    let mut proposal = Proposal::try_from_slice(&proposal_account.data.borrow())?;
    if !proposal.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if proposal.get_status()? != ProposalStatus::Active {
        return Err(GovernanceError::ProposalNotActive.into());
    }

    let clock = Clock::get()?;
    if clock.slot > proposal.end_slot {
        return Err(GovernanceError::VotingPeriodEnded.into());
    }

    // Validate voting power
    assert_owned_by(voting_power_account, program_id)?;
    let (vp_pda, _) =
        Pubkey::find_program_address(&[VOTING_POWER_SEED, voter.key.as_ref()], program_id);
    if voting_power_account.key != &vp_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    let vp = VotingPower::try_from_slice(&voting_power_account.data.borrow())?;
    if !vp.is_initialized {
        return Err(GovernanceError::InsufficientVotingPower.into());
    }
    let effective = vp.effective_power()?;
    if effective < args.vote_weight {
        return Err(GovernanceError::InsufficientVotingPower.into());
    }

    // Derive vote record PDA
    let proposal_id_bytes = args.proposal_id.to_le_bytes();
    let (vote_pda, vote_bump) = Pubkey::find_program_address(
        &[VOTE_RECORD_SEED, &proposal_id_bytes, voter.key.as_ref()],
        program_id,
    );
    if vote_record_account.key != &vote_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    // Ensure this voter hasn't already voted
    if !vote_record_account.data_is_empty() {
        return Err(GovernanceError::AlreadyVoted.into());
    }

    create_pda_account(
        voter,
        VoteRecord::SIZE,
        program_id,
        system_program,
        vote_record_account,
        &[VOTE_RECORD_SEED, &proposal_id_bytes, voter.key.as_ref(), &[vote_bump]],
    )?;

    let record = VoteRecord {
        is_initialized: true,
        voter: *voter.key,
        proposal_id: args.proposal_id,
        vote_weight: args.vote_weight,
        vote_side: vote_side as u8,
        bump: vote_bump,
    };

    record.serialize(&mut &mut vote_record_account.data.borrow_mut()[..])?;

    // Update proposal vote tallies
    match vote_side {
        VoteSide::Yes => {
            proposal.yes_votes = proposal
                .yes_votes
                .checked_add(args.vote_weight)
                .ok_or(GovernanceError::Overflow)?;
        }
        VoteSide::No => {
            proposal.no_votes = proposal
                .no_votes
                .checked_add(args.vote_weight)
                .ok_or(GovernanceError::Overflow)?;
        }
    }

    proposal.serialize(&mut &mut proposal_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:VoteCast:{{\"voter\":\"{}\",\"proposal_id\":{},\"side\":\"{}\",\"weight\":{},\"yes_total\":{},\"no_total\":{}}}",
        voter.key,
        args.proposal_id,
        match vote_side { VoteSide::Yes => "Yes", VoteSide::No => "No" },
        args.vote_weight,
        proposal.yes_votes,
        proposal.no_votes,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 3: ExecuteProposal
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   executor (anyone can call after voting ends)
//   1. []         governance_config PDA
//   2. [writable] proposal PDA

fn process_execute_proposal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data;

    let account_iter = &mut accounts.iter();
    let executor = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let proposal_account = next_account_info(account_iter)?;

    assert_signer(executor)?;
    assert_writable(proposal_account)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(proposal_account, program_id)?;

    let config = GovernanceConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }

    let mut proposal = Proposal::try_from_slice(&proposal_account.data.borrow())?;
    if !proposal.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if proposal.get_status()? != ProposalStatus::Active {
        return Err(GovernanceError::ProposalNotActive.into());
    }

    // Voting period must have ended
    let clock = Clock::get()?;
    if clock.slot <= proposal.end_slot {
        return Err(GovernanceError::VotingPeriodNotEnded.into());
    }

    // Check quorum
    let total_votes = proposal
        .yes_votes
        .checked_add(proposal.no_votes)
        .ok_or(GovernanceError::Overflow)?;

    if total_votes < config.quorum_votes {
        // Not enough participation — mark as Failed
        proposal.status = ProposalStatus::Failed as u8;
        proposal.serialize(&mut &mut proposal_account.data.borrow_mut()[..])?;

        msg!(
            "EVENT:ProposalFailed:{{\"id\":{},\"reason\":\"quorum_not_reached\",\"total_votes\":{},\"quorum\":{}}}",
            proposal.id,
            total_votes,
            config.quorum_votes,
        );

        return Err(GovernanceError::QuorumNotReached.into());
    }

    // Check majority
    if proposal.yes_votes <= proposal.no_votes {
        // No majority — mark as Failed
        proposal.status = ProposalStatus::Failed as u8;
        proposal.serialize(&mut &mut proposal_account.data.borrow_mut()[..])?;

        msg!(
            "EVENT:ProposalFailed:{{\"id\":{},\"reason\":\"no_majority\",\"yes\":{},\"no\":{}}}",
            proposal.id,
            proposal.yes_votes,
            proposal.no_votes,
        );

        return Err(GovernanceError::ProposalDidNotPass.into());
    }

    // Quorum met + majority yes — mark as Executed
    proposal.status = ProposalStatus::Executed as u8;
    proposal.executed_at = clock.unix_timestamp;
    proposal.serialize(&mut &mut proposal_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ProposalExecuted:{{\"id\":{},\"yes\":{},\"no\":{},\"total\":{},\"executed_at\":{}}}",
        proposal.id,
        proposal.yes_votes,
        proposal.no_votes,
        total_votes,
        proposal.executed_at,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 4: CancelProposal (admin-only)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   admin
//   1. []         governance_config PDA
//   2. [writable] proposal PDA

fn process_cancel_proposal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let proposal_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(proposal_account)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(proposal_account, program_id)?;

    let config = GovernanceConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(GovernanceError::Unauthorized.into());
    }

    let mut proposal = Proposal::try_from_slice(&proposal_account.data.borrow())?;
    if !proposal.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if proposal.get_status()? == ProposalStatus::Executed {
        return Err(GovernanceError::ProposalAlreadyExecuted.into());
    }

    proposal.status = ProposalStatus::Cancelled as u8;
    proposal.serialize(&mut &mut proposal_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ProposalCancelled:{{\"id\":{},\"admin\":\"{}\"}}",
        proposal.id,
        admin.key,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 5: SetVotingPower (admin-only, snapshot-based)
// ---------------------------------------------------------------------------
// Admin sets/updates a voter's voting power based on MYTH token snapshot.
// Accounts:
//   0. [signer, writable] admin
//   1. []                  governance_config PDA
//   2. [writable]          voting_power PDA (seeds: ["voting_power", voter])
//   3. []                  system_program

fn process_set_voting_power(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = SetVotingPowerArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let voting_power_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(admin)?;
    assert_writable(voting_power_account)?;
    assert_owned_by(config_account, program_id)?;

    let config = GovernanceConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(GovernanceError::Unauthorized.into());
    }

    // Derive voting_power PDA
    let (vp_pda, vp_bump) =
        Pubkey::find_program_address(&[VOTING_POWER_SEED, args.voter.as_ref()], program_id);
    if voting_power_account.key != &vp_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    let clock = Clock::get()?;

    if voting_power_account.data_is_empty() {
        // Create new voting power account
        create_pda_account(
            admin,
            VotingPower::SIZE,
            program_id,
            system_program,
            voting_power_account,
            &[VOTING_POWER_SEED, args.voter.as_ref(), &[vp_bump]],
        )?;

        let vp = VotingPower {
            is_initialized: true,
            voter: args.voter,
            power: args.power,
            delegated_power: 0,
            delegated_to: Pubkey::default(),
            delegated_amount: 0,
            updated_at: clock.unix_timestamp,
            bump: vp_bump,
        };

        vp.serialize(&mut &mut voting_power_account.data.borrow_mut()[..])?;
    } else {
        // Update existing
        assert_owned_by(voting_power_account, program_id)?;

        let mut vp = VotingPower::try_from_slice(&voting_power_account.data.borrow())?;
        vp.power = args.power;
        vp.updated_at = clock.unix_timestamp;
        vp.serialize(&mut &mut voting_power_account.data.borrow_mut()[..])?;
    }

    msg!(
        "EVENT:VotingPowerSet:{{\"voter\":\"{}\",\"power\":{},\"admin\":\"{}\"}}",
        args.voter,
        args.power,
        admin.key,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 6: DelegateVotingPower
// ---------------------------------------------------------------------------
// A voter delegates part or all of their voting power to another address.
// To undelegate, call with delegate_to = Pubkey::default() and amount = 0.
//
// Accounts:
//   0. [signer, writable] delegator
//   1. [writable]          delegator's voting_power PDA
//   2. [writable]          delegate's voting_power PDA
//   3. []                  system_program

fn process_delegate_voting_power(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = DelegateVotingPowerArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let delegator = next_account_info(account_iter)?;
    let delegator_vp_account = next_account_info(account_iter)?;
    let delegate_vp_account = next_account_info(account_iter)?;

    assert_signer(delegator)?;
    assert_writable(delegator_vp_account)?;
    assert_writable(delegate_vp_account)?;
    assert_owned_by(delegator_vp_account, program_id)?;
    assert_owned_by(delegate_vp_account, program_id)?;

    // Validate delegator VotingPower PDA
    let (delegator_pda, _) =
        Pubkey::find_program_address(&[VOTING_POWER_SEED, delegator.key.as_ref()], program_id);
    if delegator_vp_account.key != &delegator_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    // Validate delegate VotingPower PDA
    let (delegate_pda, _) =
        Pubkey::find_program_address(&[VOTING_POWER_SEED, args.delegate_to.as_ref()], program_id);
    if delegate_vp_account.key != &delegate_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    // Cannot delegate to self
    if delegator.key == &args.delegate_to {
        return Err(GovernanceError::SelfDelegation.into());
    }

    let mut delegator_vp = VotingPower::try_from_slice(&delegator_vp_account.data.borrow())?;
    if !delegator_vp.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }

    let mut delegate_vp = VotingPower::try_from_slice(&delegate_vp_account.data.borrow())?;
    if !delegate_vp.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }

    // If delegator already has existing delegation, undo it first
    if delegator_vp.delegated_amount > 0 && delegator_vp.delegated_to == args.delegate_to {
        // Removing from same delegate — subtract old amount first
        delegate_vp.delegated_power = delegate_vp
            .delegated_power
            .checked_sub(delegator_vp.delegated_amount)
            .ok_or(GovernanceError::Overflow)?;
        delegator_vp.delegated_amount = 0;
    } else if delegator_vp.delegated_amount > 0 {
        // Delegating to a different person while already delegated is not allowed;
        // must undelegate first (call with amount=0, delegate_to=current_delegate)
        return Err(GovernanceError::DelegationExceedsPower.into());
    }

    // Handle undelegation (amount = 0)
    if args.amount == 0 {
        delegator_vp.delegated_to = Pubkey::default();
        delegator_vp.delegated_amount = 0;

        let clock = Clock::get()?;
        delegator_vp.updated_at = clock.unix_timestamp;
        delegate_vp.updated_at = clock.unix_timestamp;

        delegator_vp.serialize(&mut &mut delegator_vp_account.data.borrow_mut()[..])?;
        delegate_vp.serialize(&mut &mut delegate_vp_account.data.borrow_mut()[..])?;

        msg!(
            "EVENT:VotingPowerUndelegated:{{\"delegator\":\"{}\",\"delegate\":\"{}\"}}",
            delegator.key,
            args.delegate_to,
        );
        return Ok(());
    }

    // Check delegator has enough power
    if args.amount > delegator_vp.power {
        return Err(GovernanceError::DelegationExceedsPower.into());
    }

    // Apply delegation
    delegator_vp.delegated_to = args.delegate_to;
    delegator_vp.delegated_amount = args.amount;
    delegate_vp.delegated_power = delegate_vp
        .delegated_power
        .checked_add(args.amount)
        .ok_or(GovernanceError::Overflow)?;

    let clock = Clock::get()?;
    delegator_vp.updated_at = clock.unix_timestamp;
    delegate_vp.updated_at = clock.unix_timestamp;

    delegator_vp.serialize(&mut &mut delegator_vp_account.data.borrow_mut()[..])?;
    delegate_vp.serialize(&mut &mut delegate_vp_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:VotingPowerDelegated:{{\"delegator\":\"{}\",\"delegate\":\"{}\",\"amount\":{}}}",
        delegator.key,
        args.delegate_to,
        args.amount,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 7: TreasuryWithdraw (proposal-based)
// ---------------------------------------------------------------------------
// Withdraw SOL from the governance treasury PDA. Requires a passed+executed
// proposal that authorized this withdrawal.
//
// Accounts:
//   0. [signer]            executor (anyone can crank after proposal executed)
//   1. []                  governance_config PDA
//   2. []                  proposal PDA (must be Executed)
//   3. [writable]          treasury PDA (seeds: ["governance_treasury"])
//   4. [writable]          recipient (receives SOL)
//   5. []                  system_program

fn process_treasury_withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = TreasuryWithdrawArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let executor = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let proposal_account = next_account_info(account_iter)?;
    let treasury_account = next_account_info(account_iter)?;
    let recipient = next_account_info(account_iter)?;

    assert_signer(executor)?;
    assert_writable(treasury_account)?;
    assert_writable(recipient)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(proposal_account, program_id)?;

    let config = GovernanceConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }

    // Validate treasury PDA
    let (treasury_pda, treasury_bump) =
        Pubkey::find_program_address(&[GOVERNANCE_TREASURY_SEED], program_id);
    if treasury_account.key != &treasury_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    // Validate proposal is executed
    let proposal_id_bytes = args.proposal_id.to_le_bytes();
    let (proposal_pda, _) =
        Pubkey::find_program_address(&[PROPOSAL_SEED, &proposal_id_bytes], program_id);
    if proposal_account.key != &proposal_pda {
        return Err(GovernanceError::InvalidPDA.into());
    }

    let proposal = Proposal::try_from_slice(&proposal_account.data.borrow())?;
    if !proposal.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if proposal.get_status()? != ProposalStatus::Executed {
        return Err(GovernanceError::ProposalNotExecuted.into());
    }

    // Validate recipient matches args
    if recipient.key != &args.recipient {
        return Err(GovernanceError::InvalidPDA.into());
    }

    // Check treasury has enough funds
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(0);
    let available = treasury_account
        .lamports()
        .checked_sub(min_balance)
        .unwrap_or(0);

    if args.amount > available {
        return Err(GovernanceError::TreasuryInsufficientFunds.into());
    }

    // Transfer SOL from treasury PDA to recipient
    **treasury_account.try_borrow_mut_lamports()? = treasury_account
        .lamports()
        .checked_sub(args.amount)
        .ok_or(GovernanceError::Overflow)?;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(args.amount)
        .ok_or(GovernanceError::Overflow)?;

    msg!(
        "EVENT:TreasuryWithdraw:{{\"proposal_id\":{},\"recipient\":\"{}\",\"amount\":{},\"executor\":\"{}\"}}",
        args.proposal_id,
        args.recipient,
        args.amount,
        executor.key,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 8: TransferAdmin (admin-only key rotation)
// ---------------------------------------------------------------------------
// Transfers governance admin authority to a new key. Can be used for
// multi-sig migration or Ledger hardware wallet transition.
//
// Accounts:
//   0. [signer]   current admin
//   1. [writable] governance_config PDA

fn process_transfer_admin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = TransferAdminArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;
    assert_owned_by(config_account, program_id)?;

    let mut config = GovernanceConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(GovernanceError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(GovernanceError::Unauthorized.into());
    }

    let old_admin = config.admin;
    config.admin = args.new_admin;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:AdminTransferred:{{\"old_admin\":\"{}\",\"new_admin\":\"{}\"}}",
        old_admin,
        args.new_admin,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_governance_config_size() {
        let config = GovernanceConfig {
            is_initialized: true,
            admin: Pubkey::default(),
            proposal_count: 0,
            voting_period: 100,
            quorum_votes: 1000,
            proposal_threshold: 500,
            treasury_vault: Pubkey::default(),
            bump: 255,
        };
        let serialized = borsh::to_vec(&config).unwrap();
        assert_eq!(serialized.len(), GovernanceConfig::SIZE);
    }

    #[test]
    fn test_proposal_size() {
        let proposal = Proposal {
            is_initialized: true,
            id: 0,
            creator: Pubkey::default(),
            title: [0u8; 64],
            description_hash: [0u8; 32],
            start_slot: 0,
            end_slot: 100,
            yes_votes: 0,
            no_votes: 0,
            status: 0,
            executed_at: 0,
            bump: 255,
        };
        let serialized = borsh::to_vec(&proposal).unwrap();
        assert_eq!(serialized.len(), Proposal::SIZE);
    }

    #[test]
    fn test_vote_record_size() {
        let record = VoteRecord {
            is_initialized: true,
            voter: Pubkey::default(),
            proposal_id: 0,
            vote_weight: 100,
            vote_side: 0,
            bump: 255,
        };
        let serialized = borsh::to_vec(&record).unwrap();
        assert_eq!(serialized.len(), VoteRecord::SIZE);
    }

    #[test]
    fn test_voting_power_size() {
        let vp = VotingPower {
            is_initialized: true,
            voter: Pubkey::default(),
            power: 1000,
            updated_at: 0,
            bump: 255,
        };
        let serialized = borsh::to_vec(&vp).unwrap();
        assert_eq!(serialized.len(), VotingPower::SIZE);
    }

    #[test]
    fn test_proposal_status_roundtrip() {
        assert_eq!(ProposalStatus::try_from(0).unwrap(), ProposalStatus::Active);
        assert_eq!(ProposalStatus::try_from(1).unwrap(), ProposalStatus::Passed);
        assert_eq!(ProposalStatus::try_from(2).unwrap(), ProposalStatus::Failed);
        assert_eq!(ProposalStatus::try_from(3).unwrap(), ProposalStatus::Executed);
        assert_eq!(ProposalStatus::try_from(4).unwrap(), ProposalStatus::Cancelled);
        assert!(ProposalStatus::try_from(5).is_err());
    }

    #[test]
    fn test_vote_side_roundtrip() {
        assert_eq!(VoteSide::try_from(0).unwrap(), VoteSide::Yes);
        assert_eq!(VoteSide::try_from(1).unwrap(), VoteSide::No);
        assert!(VoteSide::try_from(2).is_err());
    }

    #[test]
    fn test_string_to_fixed() {
        let buf: [u8; 64] = string_to_fixed("Test Proposal");
        assert_eq!(&buf[..13], b"Test Proposal");
        assert_eq!(buf[13], 0);
    }
}
