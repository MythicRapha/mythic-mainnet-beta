// MythicSwap — Constant Product AMM (x*y=k) for Mythic L2
// Program ID: MythSwap1111111111111111111111111111111111

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

solana_program::declare_id!("MythSwap11111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SWAP_CONFIG_SEED: &[u8] = b"swap_config";
const POOL_SEED: &[u8] = b"pool";
const LP_MINT_SEED: &[u8] = b"lp_mint";
const VAULT_A_SEED: &[u8] = b"vault_a";
const VAULT_B_SEED: &[u8] = b"vault_b";
const PROTOCOL_VAULT_SEED: &[u8] = b"protocol_vault";
const LP_POSITION_SEED: &[u8] = b"lp_position";

const BPS_DENOMINATOR: u64 = 10_000;
const FEE_SCALE: u128 = 1_000_000_000_000; // 1e12 for accumulated fee precision
const LP_TOKEN_DECIMALS: u8 = 6;
const MIN_LIQUIDITY: u64 = 1_000; // minimum LP tokens locked on first deposit

/// MYTH Token program ID — fees are routed here for unified burn/distribute.
const MYTH_TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf");
const FEE_CONFIG_SEED: &[u8] = b"fee_config";

/// Fee type discriminators for myth-token CollectFee
const FEE_TYPE_GAS: u8 = 0;

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&disc, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match disc {
        0 => process_initialize(program_id, accounts, rest),
        1 => process_create_pool(program_id, accounts, rest),
        2 => process_add_liquidity(program_id, accounts, rest),
        3 => process_remove_liquidity(program_id, accounts, rest),
        4 => process_swap(program_id, accounts, rest),
        5 => process_harvest_fees(program_id, accounts, rest),
        6 => process_withdraw_protocol_fees(program_id, accounts, rest),
        7 => process_update_config(program_id, accounts, rest),
        8 => process_pause(program_id, accounts),
        9 => process_unpause(program_id, accounts),
        _ => Err(SwapError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SwapError {
    #[error("Invalid instruction discriminator")]
    InvalidInstruction,
    #[error("Already initialized")]
    AlreadyInitialized,
    #[error("Not initialized")]
    NotInitialized,
    #[error("Invalid authority")]
    InvalidAuthority,
    #[error("Invalid PDA")]
    InvalidPDA,
    #[error("Arithmetic overflow")]
    Overflow,
    #[error("Invalid amount (must be > 0)")]
    InvalidAmount,
    #[error("Insufficient funds")]
    InsufficientFunds,
    #[error("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[error("Pool already exists")]
    PoolAlreadyExists,
    #[error("Pool is paused")]
    PoolPaused,
    #[error("Program is paused")]
    ProgramPaused,
    #[error("Mints must be different")]
    IdenticalMints,
    #[error("Mints not in sorted order")]
    MintsNotSorted,
    #[error("Zero liquidity")]
    ZeroLiquidity,
    #[error("Insufficient liquidity minted")]
    InsufficientLiquidityMinted,
    #[error("Insufficient LP tokens")]
    InsufficientLpTokens,
    #[error("No fees to harvest")]
    NoFeesToHarvest,
    #[error("No protocol fees to withdraw")]
    NoProtocolFees,
    #[error("Invalid fee configuration")]
    InvalidFeeConfig,
    #[error("Account not writable")]
    AccountNotWritable,
    #[error("Account not signer")]
    AccountNotSigner,
    #[error("Invalid account owner")]
    InvalidOwner,
    #[error("Constant product invariant violated")]
    InvariantViolated,
}

impl From<SwapError> for ProgramError {
    fn from(e: SwapError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State: SwapConfig
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct SwapConfig {
    pub is_initialized: bool,       // 1
    pub is_paused: bool,            // 1
    pub authority: Pubkey,          // 32
    pub protocol_vault: Pubkey,     // 32
    pub protocol_fee_bps: u16,     // 2  (fee to protocol vault, default 3)
    pub lp_fee_bps: u16,           // 2  (fee to LPs, default 22)
    pub pool_creation_fee: u64,    // 8  (lamports)
    pub total_pools: u64,          // 8
    pub total_volume: u128,        // 16
    pub total_fees_collected: u128, // 16
    pub bump: u8,                  // 1
}

impl SwapConfig {
    pub const SIZE: usize = 1 + 1 + 32 + 32 + 2 + 2 + 8 + 8 + 16 + 16 + 1; // 119
}

// ---------------------------------------------------------------------------
// State: Pool
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Pool {
    pub is_initialized: bool,               // 1
    pub is_paused: bool,                    // 1
    pub mint_a: Pubkey,                     // 32
    pub mint_b: Pubkey,                     // 32
    pub vault_a: Pubkey,                    // 32
    pub vault_b: Pubkey,                    // 32
    pub lp_mint: Pubkey,                    // 32
    pub reserve_a: u64,                     // 8
    pub reserve_b: u64,                     // 8
    pub lp_supply: u64,                     // 8
    pub total_volume: u128,                 // 16
    pub total_fees: u128,                   // 16
    pub accumulated_fees_per_lp_a: u128,    // 16 (scaled by 1e12)
    pub accumulated_fees_per_lp_b: u128,    // 16 (scaled by 1e12)
    pub creator: Pubkey,                    // 32
    pub created_at: i64,                    // 8
    pub bump: u8,                           // 1
}

impl Pool {
    pub const SIZE: usize = 1 + 1 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 16 + 16 + 16 + 16 + 32 + 8 + 1; // 311
}

// ---------------------------------------------------------------------------
// State: LpPosition
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct LpPosition {
    pub is_initialized: bool,       // 1
    pub owner: Pubkey,              // 32
    pub pool: Pubkey,               // 32
    pub lp_amount: u64,             // 8
    pub last_accumulated_a: u128,   // 16
    pub last_accumulated_b: u128,   // 16
    pub bump: u8,                   // 1
}

impl LpPosition {
    pub const SIZE: usize = 1 + 32 + 32 + 8 + 16 + 16 + 1; // 106
}

// ---------------------------------------------------------------------------
// Instruction Data Structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub protocol_fee_bps: u16,
    pub lp_fee_bps: u16,
    pub pool_creation_fee: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct CreatePoolArgs {
    pub initial_amount_a: u64,
    pub initial_amount_b: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct AddLiquidityArgs {
    pub desired_amount_a: u64,
    pub desired_amount_b: u64,
    pub min_lp_tokens: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RemoveLiquidityArgs {
    pub lp_amount: u64,
    pub min_amount_a: u64,
    pub min_amount_b: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SwapArgs {
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub a_to_b: bool,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateConfigArgs {
    pub protocol_fee_bps: Option<u16>,
    pub lp_fee_bps: Option<u16>,
    pub pool_creation_fee: Option<u64>,
    pub authority: Option<Pubkey>,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct WithdrawProtocolFeesArgs {
    pub amount_a: u64,
    pub amount_b: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(info: &AccountInfo) -> ProgramResult {
    if !info.is_signer {
        return Err(SwapError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(info: &AccountInfo) -> ProgramResult {
    if !info.is_writable {
        return Err(SwapError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(info: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if info.owner != owner {
        return Err(SwapError::InvalidOwner.into());
    }
    Ok(())
}

fn create_pda_account<'a>(
    payer: &AccountInfo<'a>,
    space: usize,
    owner: &Pubkey,
    system_program: &AccountInfo<'a>,
    pda: &AccountInfo<'a>,
    seeds: &[&[u8]],
) -> ProgramResult {
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(payer.key, pda.key, lamports, space as u64, owner),
        &[payer.clone(), pda.clone(), system_program.clone()],
        &[seeds],
    )
}

/// Integer square root using Newton's method.
fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Transfer SPL tokens between token accounts.
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
        invoke(
            &ix,
            &[
                source.clone(),
                destination.clone(),
                authority.clone(),
                token_program.clone(),
            ],
        )
    } else {
        invoke_signed(
            &ix,
            &[
                source.clone(),
                destination.clone(),
                authority.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )
    }
}

/// Mint tokens from a PDA-controlled mint.
fn mint_tokens_signed<'a>(
    mint: &AccountInfo<'a>,
    destination: &AccountInfo<'a>,
    mint_authority: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let ix = spl_token::instruction::mint_to(
        token_program.key,
        mint.key,
        destination.key,
        mint_authority.key,
        &[],
        amount,
    )?;

    invoke_signed(
        &ix,
        &[
            mint.clone(),
            destination.clone(),
            mint_authority.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )
}

/// Burn tokens from a token account.
fn burn_tokens<'a>(
    token_account: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    let ix = spl_token::instruction::burn(
        token_program.key,
        token_account.key,
        mint.key,
        authority.key,
        &[],
        amount,
    )?;

    invoke(
        &ix,
        &[
            token_account.clone(),
            mint.clone(),
            authority.clone(),
            token_program.clone(),
        ],
    )
}

/// CPI to myth-token CollectFee to route protocol fees through
/// the unified burn/distribute system. If the CPI fails (e.g., myth-token
/// program not deployed yet), we log a warning and continue — the protocol
/// fee was already transferred to the protocol vault as a fallback.
fn cpi_collect_fee<'a>(
    payer: &AccountInfo<'a>,
    myth_token_program: &AccountInfo<'a>,
    fee_config: &AccountInfo<'a>,
    fee_pool: &AccountInfo<'a>,
    payer_token_account: &AccountInfo<'a>,
    foundation_token_account: &AccountInfo<'a>,
    myth_mint: &AccountInfo<'a>,
    fee_pool_token_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    fee_type: u8,
    amount: u64,
) -> ProgramResult {
    // Build myth-token CollectFee instruction data:
    // discriminator (1 byte) = 4, then CollectFeeArgs { fee_type: u8, amount: u64 }
    let mut ix_data = Vec::with_capacity(10);
    ix_data.push(4u8); // CollectFee discriminator
    ix_data.push(fee_type);
    ix_data.extend_from_slice(&amount.to_le_bytes());

    let ix = solana_program::instruction::Instruction {
        program_id: MYTH_TOKEN_PROGRAM_ID,
        accounts: vec![
            solana_program::instruction::AccountMeta::new(*payer.key, true),
            solana_program::instruction::AccountMeta::new(*fee_config.key, false),
            solana_program::instruction::AccountMeta::new(*fee_pool.key, false),
            solana_program::instruction::AccountMeta::new(*payer_token_account.key, false),
            solana_program::instruction::AccountMeta::new(*foundation_token_account.key, false),
            solana_program::instruction::AccountMeta::new(*myth_mint.key, false),
            solana_program::instruction::AccountMeta::new(*fee_pool_token_account.key, false),
            solana_program::instruction::AccountMeta::new_readonly(*token_program.key, false),
            solana_program::instruction::AccountMeta::new_readonly(*system_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            payer.clone(),
            fee_config.clone(),
            fee_pool.clone(),
            payer_token_account.clone(),
            foundation_token_account.clone(),
            myth_mint.clone(),
            fee_pool_token_account.clone(),
            token_program.clone(),
            system_program.clone(),
            myth_token_program.clone(),
        ],
    )
}

/// Sort two mints and return (lower, higher). Returns error if identical.
fn sort_mints<'a>(mint_a: &'a Pubkey, mint_b: &'a Pubkey) -> Result<(&'a Pubkey, &'a Pubkey), ProgramError> {
    if mint_a == mint_b {
        return Err(SwapError::IdenticalMints.into());
    }
    if mint_a < mint_b {
        Ok((mint_a, mint_b))
    } else {
        Ok((mint_b, mint_a))
    }
}

// ---------------------------------------------------------------------------
// Instruction 0: Initialize
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] authority
//   1. [writable]          swap_config PDA
//   2. []                  system_program

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Validate fee configuration
    let total_fee = (args.protocol_fee_bps as u32)
        .checked_add(args.lp_fee_bps as u32)
        .ok_or(SwapError::Overflow)?;
    if total_fee > 1000 {
        // Max 10% total fee
        return Err(SwapError::InvalidFeeConfig.into());
    }

    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(config_info)?;

    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (config_pda, bump) = Pubkey::find_program_address(&[SWAP_CONFIG_SEED], program_id);
    if config_info.key != &config_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    if !config_info.data_is_empty() {
        return Err(SwapError::AlreadyInitialized.into());
    }

    // Derive protocol vault PDA
    let (protocol_vault_pda, _) =
        Pubkey::find_program_address(&[PROTOCOL_VAULT_SEED], program_id);

    create_pda_account(
        authority,
        SwapConfig::SIZE,
        program_id,
        system_prog,
        config_info,
        &[SWAP_CONFIG_SEED, &[bump]],
    )?;

    let config = SwapConfig {
        is_initialized: true,
        is_paused: false,
        authority: *authority.key,
        protocol_vault: protocol_vault_pda,
        protocol_fee_bps: args.protocol_fee_bps,
        lp_fee_bps: args.lp_fee_bps,
        pool_creation_fee: args.pool_creation_fee,
        total_pools: 0,
        total_volume: 0,
        total_fees_collected: 0,
        bump,
    };

    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:SwapInitialized:{{\"authority\":\"{}\",\"protocol_fee_bps\":{},\"lp_fee_bps\":{},\"pool_creation_fee\":{}}}",
        authority.key,
        args.protocol_fee_bps,
        args.lp_fee_bps,
        args.pool_creation_fee,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 1: CreatePool
// ---------------------------------------------------------------------------
// Accounts:
//   0.  [signer, writable] creator
//   1.  [writable]          swap_config PDA
//   2.  [writable]          pool PDA (seeds: ["pool", mint_a, mint_b])
//   3.  []                  mint_a
//   4.  []                  mint_b
//   5.  [writable]          vault_a PDA (token account for mint_a)
//   6.  [writable]          vault_b PDA (token account for mint_b)
//   7.  [writable]          lp_mint PDA (seeds: ["lp_mint", pool_key])
//   8.  [writable]          creator_token_a (source for initial liquidity)
//   9.  [writable]          creator_token_b (source for initial liquidity)
//   10. [writable]          creator_lp_ata (receives LP tokens — created inline if empty)
//   11. [writable]          protocol_vault (receives creation fee)
//   12. []                  token_program
//   13. []                  system_program
//   14. []                  rent sysvar
//   15. []                  associated_token_program (optional, for ATA creation)

fn process_create_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CreatePoolArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.initial_amount_a == 0 || args.initial_amount_b == 0 {
        return Err(SwapError::InvalidAmount.into());
    }

    let iter = &mut accounts.iter();
    let creator = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let pool_info = next_account_info(iter)?;
    let mint_a_info = next_account_info(iter)?;
    let mint_b_info = next_account_info(iter)?;
    let vault_a_info = next_account_info(iter)?;
    let vault_b_info = next_account_info(iter)?;
    let lp_mint_info = next_account_info(iter)?;
    let creator_token_a = next_account_info(iter)?;
    let creator_token_b = next_account_info(iter)?;
    let creator_lp_ata = next_account_info(iter)?;
    let protocol_vault_info = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;
    let rent_sysvar = next_account_info(iter)?;
    // Optional: associated token program for creating LP ATA inline
    let ata_program = next_account_info(iter).ok();

    assert_signer(creator)?;
    assert_writable(creator)?;
    assert_writable(config_info)?;
    assert_writable(pool_info)?;
    assert_writable(vault_a_info)?;
    assert_writable(vault_b_info)?;
    assert_writable(lp_mint_info)?;
    assert_writable(creator_token_a)?;
    assert_writable(creator_token_b)?;
    assert_writable(creator_lp_ata)?;
    assert_writable(protocol_vault_info)?;
    assert_owned_by(config_info, program_id)?;

    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    if *system_prog.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut config = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(SwapError::ProgramPaused.into());
    }

    // Validate mints are sorted (mint_a < mint_b)
    let (sorted_a, sorted_b) = sort_mints(mint_a_info.key, mint_b_info.key)?;
    if sorted_a != mint_a_info.key || sorted_b != mint_b_info.key {
        return Err(SwapError::MintsNotSorted.into());
    }

    // Derive pool PDA
    let (pool_pda, pool_bump) = Pubkey::find_program_address(
        &[POOL_SEED, mint_a_info.key.as_ref(), mint_b_info.key.as_ref()],
        program_id,
    );
    if pool_info.key != &pool_pda {
        return Err(SwapError::InvalidPDA.into());
    }
    if !pool_info.data_is_empty() {
        return Err(SwapError::PoolAlreadyExists.into());
    }

    // Derive LP mint PDA
    let (lp_mint_pda, lp_mint_bump) = Pubkey::find_program_address(
        &[LP_MINT_SEED, pool_pda.as_ref()],
        program_id,
    );
    if lp_mint_info.key != &lp_mint_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    // Derive vault_a PDA
    let (vault_a_pda, vault_a_bump) = Pubkey::find_program_address(
        &[VAULT_A_SEED, pool_pda.as_ref()],
        program_id,
    );
    if vault_a_info.key != &vault_a_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    // Derive vault_b PDA
    let (vault_b_pda, vault_b_bump) = Pubkey::find_program_address(
        &[VAULT_B_SEED, pool_pda.as_ref()],
        program_id,
    );
    if vault_b_info.key != &vault_b_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    // Charge pool creation fee (SOL lamports to protocol vault)
    if config.pool_creation_fee > 0 {
        invoke(
            &system_instruction::transfer(creator.key, protocol_vault_info.key, config.pool_creation_fee),
            &[creator.clone(), protocol_vault_info.clone(), system_prog.clone()],
        )?;
    }

    // 1. Create Pool PDA account
    create_pda_account(
        creator,
        Pool::SIZE,
        program_id,
        system_prog,
        pool_info,
        &[POOL_SEED, mint_a_info.key.as_ref(), mint_b_info.key.as_ref(), &[pool_bump]],
    )?;

    // 2. Create LP Mint PDA (SPL Token Mint)
    let lp_mint_rent = Rent::get()?.minimum_balance(spl_token::state::Mint::LEN);
    invoke_signed(
        &system_instruction::create_account(
            creator.key,
            &lp_mint_pda,
            lp_mint_rent,
            spl_token::state::Mint::LEN as u64,
            &spl_token::id(),
        ),
        &[creator.clone(), lp_mint_info.clone(), system_prog.clone()],
        &[&[LP_MINT_SEED, pool_pda.as_ref(), &[lp_mint_bump]]],
    )?;

    // Initialize LP mint — pool PDA is the mint authority
    invoke_signed(
        &spl_token::instruction::initialize_mint(
            &spl_token::id(),
            &lp_mint_pda,
            &pool_pda, // mint authority = pool PDA
            None,
            LP_TOKEN_DECIMALS,
        )?,
        &[lp_mint_info.clone(), rent_sysvar.clone()],
        &[&[LP_MINT_SEED, pool_pda.as_ref(), &[lp_mint_bump]]],
    )?;

    // 3. Create vault_a (SPL Token Account owned by pool PDA)
    let vault_rent = Rent::get()?.minimum_balance(spl_token::state::Account::LEN);
    invoke_signed(
        &system_instruction::create_account(
            creator.key,
            &vault_a_pda,
            vault_rent,
            spl_token::state::Account::LEN as u64,
            &spl_token::id(),
        ),
        &[creator.clone(), vault_a_info.clone(), system_prog.clone()],
        &[&[VAULT_A_SEED, pool_pda.as_ref(), &[vault_a_bump]]],
    )?;

    invoke_signed(
        &spl_token::instruction::initialize_account(
            &spl_token::id(),
            &vault_a_pda,
            mint_a_info.key,
            &pool_pda, // owner = pool PDA
        )?,
        &[vault_a_info.clone(), mint_a_info.clone(), pool_info.clone(), rent_sysvar.clone()],
        &[&[VAULT_A_SEED, pool_pda.as_ref(), &[vault_a_bump]]],
    )?;

    // 4. Create vault_b
    invoke_signed(
        &system_instruction::create_account(
            creator.key,
            &vault_b_pda,
            vault_rent,
            spl_token::state::Account::LEN as u64,
            &spl_token::id(),
        ),
        &[creator.clone(), vault_b_info.clone(), system_prog.clone()],
        &[&[VAULT_B_SEED, pool_pda.as_ref(), &[vault_b_bump]]],
    )?;

    invoke_signed(
        &spl_token::instruction::initialize_account(
            &spl_token::id(),
            &vault_b_pda,
            mint_b_info.key,
            &pool_pda, // owner = pool PDA
        )?,
        &[vault_b_info.clone(), mint_b_info.clone(), pool_info.clone(), rent_sysvar.clone()],
        &[&[VAULT_B_SEED, pool_pda.as_ref(), &[vault_b_bump]]],
    )?;

    // 5. Transfer initial liquidity from creator to vaults
    transfer_spl_tokens(
        creator_token_a,
        vault_a_info,
        creator,
        token_program,
        args.initial_amount_a,
        &[],
    )?;

    transfer_spl_tokens(
        creator_token_b,
        vault_b_info,
        creator,
        token_program,
        args.initial_amount_b,
        &[],
    )?;

    // 5b. Create LP ATA for creator if it doesn't exist yet
    //     (LP mint was just created above, so ATA can now be initialized)
    if creator_lp_ata.data_is_empty() {
        if let Some(ata_prog) = ata_program {
            if *ata_prog.key != spl_associated_token_account::id() {
                return Err(ProgramError::IncorrectProgramId);
            }
            invoke(
                &spl_associated_token_account::instruction::create_associated_token_account(
                    creator.key,
                    creator.key,
                    &lp_mint_pda,
                    &spl_token::id(),
                ),
                &[
                    creator.clone(),
                    creator_lp_ata.clone(),
                    creator.clone(),
                    lp_mint_info.clone(),
                    system_prog.clone(),
                    token_program.clone(),
                    ata_prog.clone(),
                ],
            )?;
        } else {
            msg!("LP ATA does not exist and AssociatedTokenProgram not provided");
            return Err(ProgramError::NotEnoughAccountKeys);
        }
    }

    // 6. Calculate initial LP tokens: sqrt(amount_a * amount_b)
    let product = (args.initial_amount_a as u128)
        .checked_mul(args.initial_amount_b as u128)
        .ok_or(SwapError::Overflow)?;
    let lp_amount_total = isqrt(product);
    let lp_amount_total = u64::try_from(lp_amount_total)
        .map_err(|_| SwapError::Overflow)?;

    if lp_amount_total <= MIN_LIQUIDITY {
        return Err(SwapError::InsufficientLiquidityMinted.into());
    }

    // Lock MIN_LIQUIDITY permanently (burned / never mintable)
    let lp_amount_creator = lp_amount_total
        .checked_sub(MIN_LIQUIDITY)
        .ok_or(SwapError::Overflow)?;

    // Mint LP tokens to creator
    let pool_seeds = &[POOL_SEED, mint_a_info.key.as_ref(), mint_b_info.key.as_ref(), &[pool_bump]];

    mint_tokens_signed(
        lp_mint_info,
        creator_lp_ata,
        pool_info,     // pool PDA is mint authority
        token_program,
        lp_amount_creator,
        pool_seeds,
    )?;

    // 7. Store pool state
    let clock = Clock::get()?;
    let pool = Pool {
        is_initialized: true,
        is_paused: false,
        mint_a: *mint_a_info.key,
        mint_b: *mint_b_info.key,
        vault_a: vault_a_pda,
        vault_b: vault_b_pda,
        lp_mint: lp_mint_pda,
        reserve_a: args.initial_amount_a,
        reserve_b: args.initial_amount_b,
        lp_supply: lp_amount_total, // includes locked MIN_LIQUIDITY
        total_volume: 0,
        total_fees: 0,
        accumulated_fees_per_lp_a: 0,
        accumulated_fees_per_lp_b: 0,
        creator: *creator.key,
        created_at: clock.unix_timestamp,
        bump: pool_bump,
    };

    pool.serialize(&mut &mut pool_info.try_borrow_mut_data()?[..])?;

    // 8. Update config
    config.total_pools = config.total_pools
        .checked_add(1)
        .ok_or(SwapError::Overflow)?;
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:PoolCreated:{{\"creator\":\"{}\",\"mint_a\":\"{}\",\"mint_b\":\"{}\",\"initial_a\":{},\"initial_b\":{},\"lp_minted\":{}}}",
        creator.key,
        mint_a_info.key,
        mint_b_info.key,
        args.initial_amount_a,
        args.initial_amount_b,
        lp_amount_creator,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 2: AddLiquidity
// ---------------------------------------------------------------------------
// Accounts:
//   0.  [signer, writable] depositor
//   1.  [writable]          pool PDA
//   2.  [writable]          vault_a
//   3.  [writable]          vault_b
//   4.  [writable]          lp_mint
//   5.  [writable]          depositor_token_a
//   6.  [writable]          depositor_token_b
//   7.  [writable]          depositor_lp_ata
//   8.  [writable]          lp_position PDA (seeds: ["lp_position", pool, owner])
//   9.  []                  token_program
//   10. []                  system_program

fn process_add_liquidity(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = AddLiquidityArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.desired_amount_a == 0 || args.desired_amount_b == 0 {
        return Err(SwapError::InvalidAmount.into());
    }

    let iter = &mut accounts.iter();
    let depositor = next_account_info(iter)?;
    let pool_info = next_account_info(iter)?;
    let vault_a_info = next_account_info(iter)?;
    let vault_b_info = next_account_info(iter)?;
    let lp_mint_info = next_account_info(iter)?;
    let depositor_token_a = next_account_info(iter)?;
    let depositor_token_b = next_account_info(iter)?;
    let depositor_lp_ata = next_account_info(iter)?;
    let lp_position_info = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    assert_signer(depositor)?;
    assert_writable(depositor)?;
    assert_writable(pool_info)?;
    assert_writable(vault_a_info)?;
    assert_writable(vault_b_info)?;
    assert_writable(lp_mint_info)?;
    assert_writable(depositor_token_a)?;
    assert_writable(depositor_token_b)?;
    assert_writable(depositor_lp_ata)?;
    assert_writable(lp_position_info)?;
    assert_owned_by(pool_info, program_id)?;

    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut pool = Pool::try_from_slice(&pool_info.try_borrow_data()?)?;
    if !pool.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if pool.is_paused {
        return Err(SwapError::PoolPaused.into());
    }

    // Validate vault accounts
    if vault_a_info.key != &pool.vault_a || vault_b_info.key != &pool.vault_b {
        return Err(SwapError::InvalidPDA.into());
    }
    if lp_mint_info.key != &pool.lp_mint {
        return Err(SwapError::InvalidPDA.into());
    }

    // Derive lp_position PDA
    let (lp_pos_pda, lp_pos_bump) = Pubkey::find_program_address(
        &[LP_POSITION_SEED, pool_info.key.as_ref(), depositor.key.as_ref()],
        program_id,
    );
    if lp_position_info.key != &lp_pos_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    // Calculate proportional deposit and LP tokens
    let (deposit_a, deposit_b, lp_tokens);

    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        // Should not happen (pool created with initial liquidity), but handle gracefully
        return Err(SwapError::ZeroLiquidity.into());
    }

    // Calculate proportional amounts
    // lp_from_a = desired_amount_a * lp_supply / reserve_a
    // lp_from_b = desired_amount_b * lp_supply / reserve_b
    // Take min to maintain ratio
    let lp_from_a = (args.desired_amount_a as u128)
        .checked_mul(pool.lp_supply as u128)
        .ok_or(SwapError::Overflow)?
        .checked_div(pool.reserve_a as u128)
        .ok_or(SwapError::Overflow)?;

    let lp_from_b = (args.desired_amount_b as u128)
        .checked_mul(pool.lp_supply as u128)
        .ok_or(SwapError::Overflow)?
        .checked_div(pool.reserve_b as u128)
        .ok_or(SwapError::Overflow)?;

    if lp_from_a <= lp_from_b {
        // Token A is the limiting factor
        lp_tokens = u64::try_from(lp_from_a).map_err(|_| SwapError::Overflow)?;
        deposit_a = args.desired_amount_a;
        // deposit_b = lp_tokens * reserve_b / lp_supply (proportional)
        deposit_b = u64::try_from(
            (lp_tokens as u128)
                .checked_mul(pool.reserve_b as u128)
                .ok_or(SwapError::Overflow)?
                .checked_div(pool.lp_supply as u128)
                .ok_or(SwapError::Overflow)?
        ).map_err(|_| SwapError::Overflow)?;
    } else {
        // Token B is the limiting factor
        lp_tokens = u64::try_from(lp_from_b).map_err(|_| SwapError::Overflow)?;
        deposit_b = args.desired_amount_b;
        // deposit_a = lp_tokens * reserve_a / lp_supply
        deposit_a = u64::try_from(
            (lp_tokens as u128)
                .checked_mul(pool.reserve_a as u128)
                .ok_or(SwapError::Overflow)?
                .checked_div(pool.lp_supply as u128)
                .ok_or(SwapError::Overflow)?
        ).map_err(|_| SwapError::Overflow)?;
    }

    if lp_tokens == 0 {
        return Err(SwapError::InsufficientLiquidityMinted.into());
    }
    if lp_tokens < args.min_lp_tokens {
        return Err(SwapError::SlippageExceeded.into());
    }

    // Transfer tokens from depositor to vaults
    if deposit_a > 0 {
        transfer_spl_tokens(
            depositor_token_a,
            vault_a_info,
            depositor,
            token_program,
            deposit_a,
            &[],
        )?;
    }

    if deposit_b > 0 {
        transfer_spl_tokens(
            depositor_token_b,
            vault_b_info,
            depositor,
            token_program,
            deposit_b,
            &[],
        )?;
    }

    // Mint LP tokens to depositor
    let pool_seeds = &[
        POOL_SEED,
        pool.mint_a.as_ref(),
        pool.mint_b.as_ref(),
        &[pool.bump],
    ];

    mint_tokens_signed(
        lp_mint_info,
        depositor_lp_ata,
        pool_info,
        token_program,
        lp_tokens,
        pool_seeds,
    )?;

    // Create or update LP position
    if lp_position_info.data_is_empty() {
        // Create new position
        create_pda_account(
            depositor,
            LpPosition::SIZE,
            program_id,
            system_prog,
            lp_position_info,
            &[LP_POSITION_SEED, pool_info.key.as_ref(), depositor.key.as_ref(), &[lp_pos_bump]],
        )?;

        let position = LpPosition {
            is_initialized: true,
            owner: *depositor.key,
            pool: *pool_info.key,
            lp_amount: lp_tokens,
            last_accumulated_a: pool.accumulated_fees_per_lp_a,
            last_accumulated_b: pool.accumulated_fees_per_lp_b,
            bump: lp_pos_bump,
        };
        position.serialize(&mut &mut lp_position_info.try_borrow_mut_data()?[..])?;
    } else {
        assert_owned_by(lp_position_info, program_id)?;
        let mut position = LpPosition::try_from_slice(&lp_position_info.try_borrow_data()?)?;
        if !position.is_initialized || position.owner != *depositor.key || position.pool != *pool_info.key {
            return Err(SwapError::InvalidPDA.into());
        }

        // Settle any pending fees before updating position
        // (user should harvest first, but we snapshot the current accumulated)
        position.last_accumulated_a = pool.accumulated_fees_per_lp_a;
        position.last_accumulated_b = pool.accumulated_fees_per_lp_b;
        position.lp_amount = position.lp_amount
            .checked_add(lp_tokens)
            .ok_or(SwapError::Overflow)?;
        position.serialize(&mut &mut lp_position_info.try_borrow_mut_data()?[..])?;
    }

    // Update pool reserves and LP supply
    pool.reserve_a = pool.reserve_a
        .checked_add(deposit_a)
        .ok_or(SwapError::Overflow)?;
    pool.reserve_b = pool.reserve_b
        .checked_add(deposit_b)
        .ok_or(SwapError::Overflow)?;
    pool.lp_supply = pool.lp_supply
        .checked_add(lp_tokens)
        .ok_or(SwapError::Overflow)?;

    pool.serialize(&mut &mut pool_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:LiquidityAdded:{{\"depositor\":\"{}\",\"pool\":\"{}\",\"deposit_a\":{},\"deposit_b\":{},\"lp_minted\":{}}}",
        depositor.key,
        pool_info.key,
        deposit_a,
        deposit_b,
        lp_tokens,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 3: RemoveLiquidity
// ---------------------------------------------------------------------------
// Accounts:
//   0.  [signer, writable] withdrawer
//   1.  [writable]          pool PDA
//   2.  [writable]          vault_a
//   3.  [writable]          vault_b
//   4.  [writable]          lp_mint
//   5.  [writable]          withdrawer_token_a
//   6.  [writable]          withdrawer_token_b
//   7.  [writable]          withdrawer_lp_ata (LP tokens burned from here)
//   8.  [writable]          lp_position PDA
//   9.  []                  token_program

fn process_remove_liquidity(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RemoveLiquidityArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.lp_amount == 0 {
        return Err(SwapError::InvalidAmount.into());
    }

    let iter = &mut accounts.iter();
    let withdrawer = next_account_info(iter)?;
    let pool_info = next_account_info(iter)?;
    let vault_a_info = next_account_info(iter)?;
    let vault_b_info = next_account_info(iter)?;
    let lp_mint_info = next_account_info(iter)?;
    let withdrawer_token_a = next_account_info(iter)?;
    let withdrawer_token_b = next_account_info(iter)?;
    let withdrawer_lp_ata = next_account_info(iter)?;
    let lp_position_info = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    assert_signer(withdrawer)?;
    assert_writable(withdrawer)?;
    assert_writable(pool_info)?;
    assert_writable(vault_a_info)?;
    assert_writable(vault_b_info)?;
    assert_writable(lp_mint_info)?;
    assert_writable(withdrawer_token_a)?;
    assert_writable(withdrawer_token_b)?;
    assert_writable(withdrawer_lp_ata)?;
    assert_writable(lp_position_info)?;
    assert_owned_by(pool_info, program_id)?;
    assert_owned_by(lp_position_info, program_id)?;

    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut pool = Pool::try_from_slice(&pool_info.try_borrow_data()?)?;
    if !pool.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }

    // Validate accounts
    if vault_a_info.key != &pool.vault_a || vault_b_info.key != &pool.vault_b {
        return Err(SwapError::InvalidPDA.into());
    }
    if lp_mint_info.key != &pool.lp_mint {
        return Err(SwapError::InvalidPDA.into());
    }

    if pool.lp_supply == 0 {
        return Err(SwapError::ZeroLiquidity.into());
    }

    // Calculate withdrawal amounts
    // amount_a = lp_amount * reserve_a / lp_supply
    // amount_b = lp_amount * reserve_b / lp_supply
    let amount_a = u64::try_from(
        (args.lp_amount as u128)
            .checked_mul(pool.reserve_a as u128)
            .ok_or(SwapError::Overflow)?
            .checked_div(pool.lp_supply as u128)
            .ok_or(SwapError::Overflow)?
    ).map_err(|_| SwapError::Overflow)?;

    let amount_b = u64::try_from(
        (args.lp_amount as u128)
            .checked_mul(pool.reserve_b as u128)
            .ok_or(SwapError::Overflow)?
            .checked_div(pool.lp_supply as u128)
            .ok_or(SwapError::Overflow)?
    ).map_err(|_| SwapError::Overflow)?;

    // Slippage check
    if amount_a < args.min_amount_a {
        return Err(SwapError::SlippageExceeded.into());
    }
    if amount_b < args.min_amount_b {
        return Err(SwapError::SlippageExceeded.into());
    }

    // Burn LP tokens from withdrawer
    burn_tokens(
        withdrawer_lp_ata,
        lp_mint_info,
        withdrawer,
        token_program,
        args.lp_amount,
    )?;

    // Transfer tokens from vaults to withdrawer
    let pool_seeds: &[&[u8]] = &[
        POOL_SEED,
        pool.mint_a.as_ref(),
        pool.mint_b.as_ref(),
        &[pool.bump],
    ];

    if amount_a > 0 {
        transfer_spl_tokens(
            vault_a_info,
            withdrawer_token_a,
            pool_info,
            token_program,
            amount_a,
            pool_seeds,
        )?;
    }

    if amount_b > 0 {
        transfer_spl_tokens(
            vault_b_info,
            withdrawer_token_b,
            pool_info,
            token_program,
            amount_b,
            pool_seeds,
        )?;
    }

    // Update LP position
    let mut position = LpPosition::try_from_slice(&lp_position_info.try_borrow_data()?)?;
    if !position.is_initialized || position.owner != *withdrawer.key || position.pool != *pool_info.key {
        return Err(SwapError::InvalidPDA.into());
    }
    if position.lp_amount < args.lp_amount {
        return Err(SwapError::InsufficientLpTokens.into());
    }

    position.lp_amount = position.lp_amount
        .checked_sub(args.lp_amount)
        .ok_or(SwapError::Overflow)?;
    position.serialize(&mut &mut lp_position_info.try_borrow_mut_data()?[..])?;

    // Update pool state
    pool.reserve_a = pool.reserve_a
        .checked_sub(amount_a)
        .ok_or(SwapError::Overflow)?;
    pool.reserve_b = pool.reserve_b
        .checked_sub(amount_b)
        .ok_or(SwapError::Overflow)?;
    pool.lp_supply = pool.lp_supply
        .checked_sub(args.lp_amount)
        .ok_or(SwapError::Overflow)?;

    pool.serialize(&mut &mut pool_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:LiquidityRemoved:{{\"withdrawer\":\"{}\",\"pool\":\"{}\",\"lp_burned\":{},\"amount_a\":{},\"amount_b\":{}}}",
        withdrawer.key,
        pool_info.key,
        args.lp_amount,
        amount_a,
        amount_b,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 4: Swap
// ---------------------------------------------------------------------------
// Accounts:
//   0.  [signer, writable] trader
//   1.  [writable]          swap_config PDA
//   2.  [writable]          pool PDA
//   3.  [writable]          vault_a
//   4.  [writable]          vault_b
//   5.  [writable]          trader_token_in (source)
//   6.  [writable]          trader_token_out (destination)
//   7.  [writable]          protocol_fee_vault_token (token account for protocol fees)
//   8.  []                  token_program
//
// Optional myth-token CPI accounts (for unified fee collection):
//   9.  []                  myth_token_program
//   10. [writable]          myth_token fee_config PDA
//   11. [writable]          myth_token fee_pool PDA
//   12. [writable]          foundation_token_account
//   13. [writable]          myth_mint
//   14. [writable]          fee_pool_token_account
//   15. []                  system_program

fn process_swap(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = SwapArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount_in == 0 {
        return Err(SwapError::InvalidAmount.into());
    }

    let iter = &mut accounts.iter();
    let trader = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let pool_info = next_account_info(iter)?;
    let vault_a_info = next_account_info(iter)?;
    let vault_b_info = next_account_info(iter)?;
    let trader_token_in = next_account_info(iter)?;
    let trader_token_out = next_account_info(iter)?;
    let protocol_fee_vault = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    assert_signer(trader)?;
    assert_writable(trader)?;
    assert_writable(pool_info)?;
    assert_writable(vault_a_info)?;
    assert_writable(vault_b_info)?;
    assert_writable(trader_token_in)?;
    assert_writable(trader_token_out)?;
    assert_writable(protocol_fee_vault)?;
    assert_owned_by(config_info, program_id)?;
    assert_owned_by(pool_info, program_id)?;

    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let config = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(SwapError::ProgramPaused.into());
    }

    let mut pool = Pool::try_from_slice(&pool_info.try_borrow_data()?)?;
    if !pool.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if pool.is_paused {
        return Err(SwapError::PoolPaused.into());
    }

    // Validate vault accounts
    if vault_a_info.key != &pool.vault_a || vault_b_info.key != &pool.vault_b {
        return Err(SwapError::InvalidPDA.into());
    }

    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return Err(SwapError::ZeroLiquidity.into());
    }

    // Determine input/output based on direction
    let (reserve_in, reserve_out, vault_in, vault_out) = if args.a_to_b {
        (pool.reserve_a, pool.reserve_b, vault_a_info, vault_b_info)
    } else {
        (pool.reserve_b, pool.reserve_a, vault_b_info, vault_a_info)
    };

    // Calculate total fee: protocol_fee_bps + lp_fee_bps
    let total_fee_bps = (config.protocol_fee_bps as u64)
        .checked_add(config.lp_fee_bps as u64)
        .ok_or(SwapError::Overflow)?;

    // effective_input = amount_in * (10000 - total_fee_bps) / 10000
    let amount_in_128 = args.amount_in as u128;
    let effective_input = amount_in_128
        .checked_mul(
            (BPS_DENOMINATOR as u128)
                .checked_sub(total_fee_bps as u128)
                .ok_or(SwapError::Overflow)?,
        )
        .ok_or(SwapError::Overflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(SwapError::Overflow)?;

    // amount_out = reserve_out * effective_input / (reserve_in + effective_input)
    let numerator = (reserve_out as u128)
        .checked_mul(effective_input)
        .ok_or(SwapError::Overflow)?;
    let denominator = (reserve_in as u128)
        .checked_add(effective_input)
        .ok_or(SwapError::Overflow)?;
    let amount_out = numerator
        .checked_div(denominator)
        .ok_or(SwapError::Overflow)?;
    let amount_out = u64::try_from(amount_out)
        .map_err(|_| SwapError::Overflow)?;

    if amount_out == 0 {
        return Err(SwapError::InvalidAmount.into());
    }
    if amount_out > reserve_out {
        return Err(SwapError::InsufficientFunds.into());
    }

    // Slippage check
    if amount_out < args.min_amount_out {
        return Err(SwapError::SlippageExceeded.into());
    }

    // Calculate protocol fee portion (in input tokens)
    // protocol_fee = amount_in * protocol_fee_bps / 10000
    let protocol_fee = u64::try_from(
        amount_in_128
            .checked_mul(config.protocol_fee_bps as u128)
            .ok_or(SwapError::Overflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(SwapError::Overflow)?
    ).map_err(|_| SwapError::Overflow)?;

    // LP fee stays in the pool (added to reserves), protocol fee sent to protocol vault
    let lp_fee = u64::try_from(
        amount_in_128
            .checked_mul(config.lp_fee_bps as u128)
            .ok_or(SwapError::Overflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(SwapError::Overflow)?
    ).map_err(|_| SwapError::Overflow)?;

    // The actual input deposited to pool = amount_in - protocol_fee
    let pool_input = args.amount_in
        .checked_sub(protocol_fee)
        .ok_or(SwapError::Overflow)?;

    // 1. Transfer input tokens from trader to input vault
    transfer_spl_tokens(
        trader_token_in,
        vault_in,
        trader,
        token_program,
        pool_input,
        &[],
    )?;

    // 2. Transfer protocol fee from trader to protocol fee vault
    if protocol_fee > 0 {
        transfer_spl_tokens(
            trader_token_in,
            protocol_fee_vault,
            trader,
            token_program,
            protocol_fee,
            &[],
        )?;
    }

    // 2b. If myth-token CPI accounts are provided, route fee through unified collection
    if protocol_fee > 0 {
        let myth_token_program = next_account_info(iter);
        if let Ok(myth_prog) = myth_token_program {
            if myth_prog.key == &MYTH_TOKEN_PROGRAM_ID {
                let fee_config_info = next_account_info(iter)?;
                let fee_pool_info = next_account_info(iter)?;
                let foundation_token_info = next_account_info(iter)?;
                let myth_mint_info = next_account_info(iter)?;
                let fee_pool_token_info = next_account_info(iter)?;
                let system_prog = next_account_info(iter)?;

                // Best-effort CPI — if it fails we still completed the swap
                let _ = cpi_collect_fee(
                    trader,
                    myth_prog,
                    fee_config_info,
                    fee_pool_info,
                    protocol_fee_vault, // payer_token_account = protocol fee vault (already funded)
                    foundation_token_info,
                    myth_mint_info,
                    fee_pool_token_info,
                    token_program,
                    system_prog,
                    FEE_TYPE_GAS,
                    protocol_fee,
                );
            }
        }
    }

    // 3. Transfer output tokens from output vault to trader
    let pool_seeds: &[&[u8]] = &[
        POOL_SEED,
        pool.mint_a.as_ref(),
        pool.mint_b.as_ref(),
        &[pool.bump],
    ];

    transfer_spl_tokens(
        vault_out,
        trader_token_out,
        pool_info,
        token_program,
        amount_out,
        pool_seeds,
    )?;

    // 4. Update reserves
    // New reserve_in = old_reserve_in + pool_input (includes lp_fee)
    // New reserve_out = old_reserve_out - amount_out
    let new_reserve_in = (reserve_in as u128)
        .checked_add(pool_input as u128)
        .ok_or(SwapError::Overflow)?;
    let new_reserve_out = (reserve_out as u128)
        .checked_sub(amount_out as u128)
        .ok_or(SwapError::Overflow)?;

    // Verify constant product invariant: new_k >= old_k
    let old_k = (reserve_in as u128)
        .checked_mul(reserve_out as u128)
        .ok_or(SwapError::Overflow)?;
    let new_k = new_reserve_in
        .checked_mul(new_reserve_out)
        .ok_or(SwapError::Overflow)?;

    if new_k < old_k {
        return Err(SwapError::InvariantViolated.into());
    }

    if args.a_to_b {
        pool.reserve_a = u64::try_from(new_reserve_in).map_err(|_| SwapError::Overflow)?;
        pool.reserve_b = u64::try_from(new_reserve_out).map_err(|_| SwapError::Overflow)?;
    } else {
        pool.reserve_b = u64::try_from(new_reserve_in).map_err(|_| SwapError::Overflow)?;
        pool.reserve_a = u64::try_from(new_reserve_out).map_err(|_| SwapError::Overflow)?;
    }

    // 5. Update accumulated fees per LP for fee tracking
    if pool.lp_supply > 0 && lp_fee > 0 {
        let fee_per_lp = (lp_fee as u128)
            .checked_mul(FEE_SCALE)
            .ok_or(SwapError::Overflow)?
            .checked_div(pool.lp_supply as u128)
            .ok_or(SwapError::Overflow)?;

        if args.a_to_b {
            pool.accumulated_fees_per_lp_a = pool.accumulated_fees_per_lp_a
                .checked_add(fee_per_lp)
                .ok_or(SwapError::Overflow)?;
        } else {
            pool.accumulated_fees_per_lp_b = pool.accumulated_fees_per_lp_b
                .checked_add(fee_per_lp)
                .ok_or(SwapError::Overflow)?;
        }
    }

    // 6. Update pool volume and fee stats
    pool.total_volume = pool.total_volume
        .checked_add(args.amount_in as u128)
        .ok_or(SwapError::Overflow)?;
    pool.total_fees = pool.total_fees
        .checked_add(protocol_fee as u128)
        .ok_or(SwapError::Overflow)?
        .checked_add(lp_fee as u128)
        .ok_or(SwapError::Overflow)?;

    pool.serialize(&mut &mut pool_info.try_borrow_mut_data()?[..])?;

    // 7. Update global config stats
    let mut config_mut = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    config_mut.total_volume = config_mut.total_volume
        .checked_add(args.amount_in as u128)
        .ok_or(SwapError::Overflow)?;
    config_mut.total_fees_collected = config_mut.total_fees_collected
        .checked_add(protocol_fee as u128)
        .ok_or(SwapError::Overflow)?;
    config_mut.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:Swap:{{\"trader\":\"{}\",\"pool\":\"{}\",\"a_to_b\":{},\"amount_in\":{},\"amount_out\":{},\"protocol_fee\":{},\"lp_fee\":{}}}",
        trader.key,
        pool_info.key,
        args.a_to_b,
        args.amount_in,
        amount_out,
        protocol_fee,
        lp_fee,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 5: HarvestFees
// ---------------------------------------------------------------------------
// LP providers claim accumulated fees.
//
// Accounts:
//   0.  [signer]   owner
//   1.  [writable] pool PDA
//   2.  [writable] vault_a
//   3.  [writable] vault_b
//   4.  [writable] lp_position PDA
//   5.  [writable] owner_token_a
//   6.  [writable] owner_token_b
//   7.  []         token_program

fn process_harvest_fees(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let owner = next_account_info(iter)?;
    let pool_info = next_account_info(iter)?;
    let vault_a_info = next_account_info(iter)?;
    let vault_b_info = next_account_info(iter)?;
    let lp_position_info = next_account_info(iter)?;
    let owner_token_a = next_account_info(iter)?;
    let owner_token_b = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    assert_signer(owner)?;
    assert_writable(pool_info)?;
    assert_writable(vault_a_info)?;
    assert_writable(vault_b_info)?;
    assert_writable(lp_position_info)?;
    assert_writable(owner_token_a)?;
    assert_writable(owner_token_b)?;
    assert_owned_by(pool_info, program_id)?;
    assert_owned_by(lp_position_info, program_id)?;

    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let pool = Pool::try_from_slice(&pool_info.try_borrow_data()?)?;
    if !pool.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }

    if vault_a_info.key != &pool.vault_a || vault_b_info.key != &pool.vault_b {
        return Err(SwapError::InvalidPDA.into());
    }

    let mut position = LpPosition::try_from_slice(&lp_position_info.try_borrow_data()?)?;
    if !position.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if position.owner != *owner.key {
        return Err(SwapError::InvalidAuthority.into());
    }
    if position.pool != *pool_info.key {
        return Err(SwapError::InvalidPDA.into());
    }

    if position.lp_amount == 0 {
        return Err(SwapError::NoFeesToHarvest.into());
    }

    // Calculate claimable fees:
    // claimable_a = (accumulated_fees_per_lp_a - last_accumulated_a) * lp_amount / FEE_SCALE
    let delta_a = pool.accumulated_fees_per_lp_a
        .checked_sub(position.last_accumulated_a)
        .ok_or(SwapError::Overflow)?;
    let claimable_a = delta_a
        .checked_mul(position.lp_amount as u128)
        .ok_or(SwapError::Overflow)?
        .checked_div(FEE_SCALE)
        .ok_or(SwapError::Overflow)?;
    let claimable_a = u64::try_from(claimable_a).map_err(|_| SwapError::Overflow)?;

    let delta_b = pool.accumulated_fees_per_lp_b
        .checked_sub(position.last_accumulated_b)
        .ok_or(SwapError::Overflow)?;
    let claimable_b = delta_b
        .checked_mul(position.lp_amount as u128)
        .ok_or(SwapError::Overflow)?
        .checked_div(FEE_SCALE)
        .ok_or(SwapError::Overflow)?;
    let claimable_b = u64::try_from(claimable_b).map_err(|_| SwapError::Overflow)?;

    if claimable_a == 0 && claimable_b == 0 {
        return Err(SwapError::NoFeesToHarvest.into());
    }

    let pool_seeds: &[&[u8]] = &[
        POOL_SEED,
        pool.mint_a.as_ref(),
        pool.mint_b.as_ref(),
        &[pool.bump],
    ];

    // Transfer fees from vaults
    if claimable_a > 0 {
        transfer_spl_tokens(
            vault_a_info,
            owner_token_a,
            pool_info,
            token_program,
            claimable_a,
            pool_seeds,
        )?;
    }

    if claimable_b > 0 {
        transfer_spl_tokens(
            vault_b_info,
            owner_token_b,
            pool_info,
            token_program,
            claimable_b,
            pool_seeds,
        )?;
    }

    // Update position checkpoint
    position.last_accumulated_a = pool.accumulated_fees_per_lp_a;
    position.last_accumulated_b = pool.accumulated_fees_per_lp_b;
    position.serialize(&mut &mut lp_position_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:FeesHarvested:{{\"owner\":\"{}\",\"pool\":\"{}\",\"amount_a\":{},\"amount_b\":{}}}",
        owner.key,
        pool_info.key,
        claimable_a,
        claimable_b,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 6: WithdrawProtocolFees
// ---------------------------------------------------------------------------
// Authority-only. Withdraw accumulated protocol fees from protocol fee token accounts.
//
// Accounts:
//   0. [signer]   authority
//   1. [writable] swap_config PDA
//   2. [writable] protocol_fee_source_a
//   3. [writable] protocol_fee_source_b
//   4. [writable] destination_a
//   5. [writable] destination_b
//   6. []         protocol_vault PDA (signer for transfers)
//   7. []         token_program

fn process_withdraw_protocol_fees(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = WithdrawProtocolFeesArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let fee_source_a = next_account_info(iter)?;
    let fee_source_b = next_account_info(iter)?;
    let dest_a = next_account_info(iter)?;
    let dest_b = next_account_info(iter)?;
    let protocol_vault_info = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(config_info)?;
    assert_writable(fee_source_a)?;
    assert_writable(fee_source_b)?;
    assert_writable(dest_a)?;
    assert_writable(dest_b)?;
    assert_owned_by(config_info, program_id)?;

    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let config = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if authority.key != &config.authority {
        return Err(SwapError::InvalidAuthority.into());
    }

    // Validate protocol vault PDA
    let (pv_pda, pv_bump) = Pubkey::find_program_address(&[PROTOCOL_VAULT_SEED], program_id);
    if protocol_vault_info.key != &pv_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    let vault_seeds: &[&[u8]] = &[PROTOCOL_VAULT_SEED, &[pv_bump]];

    if args.amount_a > 0 {
        transfer_spl_tokens(
            fee_source_a,
            dest_a,
            protocol_vault_info,
            token_program,
            args.amount_a,
            vault_seeds,
        )?;
    }

    if args.amount_b > 0 {
        transfer_spl_tokens(
            fee_source_b,
            dest_b,
            protocol_vault_info,
            token_program,
            args.amount_b,
            vault_seeds,
        )?;
    }

    msg!(
        "EVENT:ProtocolFeesWithdrawn:{{\"authority\":\"{}\",\"amount_a\":{},\"amount_b\":{}}}",
        authority.key,
        args.amount_a,
        args.amount_b,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 7: UpdateConfig
// ---------------------------------------------------------------------------
// Authority-only.
//
// Accounts:
//   0. [signer]   authority
//   1. [writable] swap_config PDA

fn process_update_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateConfigArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(config_info)?;
    assert_owned_by(config_info, program_id)?;

    let mut config = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if authority.key != &config.authority {
        return Err(SwapError::InvalidAuthority.into());
    }

    if let Some(pfee) = args.protocol_fee_bps {
        let total = (pfee as u32)
            .checked_add(config.lp_fee_bps as u32)
            .ok_or(SwapError::Overflow)?;
        if total > 1000 {
            return Err(SwapError::InvalidFeeConfig.into());
        }
        config.protocol_fee_bps = pfee;
    }

    if let Some(lfee) = args.lp_fee_bps {
        let total = (config.protocol_fee_bps as u32)
            .checked_add(lfee as u32)
            .ok_or(SwapError::Overflow)?;
        if total > 1000 {
            return Err(SwapError::InvalidFeeConfig.into());
        }
        config.lp_fee_bps = lfee;
    }

    if let Some(fee) = args.pool_creation_fee {
        config.pool_creation_fee = fee;
    }

    if let Some(new_auth) = args.authority {
        config.authority = new_auth;
    }

    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!(
        "EVENT:ConfigUpdated:{{\"authority\":\"{}\",\"protocol_fee_bps\":{},\"lp_fee_bps\":{},\"pool_creation_fee\":{}}}",
        authority.key,
        config.protocol_fee_bps,
        config.lp_fee_bps,
        config.pool_creation_fee,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 8: Pause (authority-only)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   authority
//   1. [writable] swap_config PDA

fn process_pause(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(config_info)?;
    assert_owned_by(config_info, program_id)?;

    let (config_pda, _) = Pubkey::find_program_address(&[SWAP_CONFIG_SEED], program_id);
    if *config_info.key != config_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    let mut config = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if authority.key != &config.authority {
        return Err(SwapError::InvalidAuthority.into());
    }

    config.is_paused = true;
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!("EVENT:Paused:{{\"authority\":\"{}\"}}", authority.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 9: Unpause (authority-only)
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   authority
//   1. [writable] swap_config PDA

fn process_unpause(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;

    assert_signer(authority)?;
    assert_writable(config_info)?;
    assert_owned_by(config_info, program_id)?;

    let (config_pda, _) = Pubkey::find_program_address(&[SWAP_CONFIG_SEED], program_id);
    if *config_info.key != config_pda {
        return Err(SwapError::InvalidPDA.into());
    }

    let mut config = SwapConfig::try_from_slice(&config_info.try_borrow_data()?)?;
    if !config.is_initialized {
        return Err(SwapError::NotInitialized.into());
    }
    if authority.key != &config.authority {
        return Err(SwapError::InvalidAuthority.into());
    }

    config.is_paused = false;
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;

    msg!("EVENT:Unpaused:{{\"authority\":\"{}\"}}", authority.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_isqrt() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9), 3);
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(1_000_000), 1_000);
        // Non-perfect squares round down
        assert_eq!(isqrt(2), 1);
        assert_eq!(isqrt(8), 2);
        assert_eq!(isqrt(10), 3);
    }

    #[test]
    fn test_isqrt_large() {
        // sqrt(1e18) = 1e9
        assert_eq!(isqrt(1_000_000_000_000_000_000), 1_000_000_000);
        // sqrt(1e12 * 1e12) = 1e12
        let product: u128 = 1_000_000_000_000u128 * 1_000_000_000_000u128;
        assert_eq!(isqrt(product), 1_000_000_000_000);
    }

    #[test]
    fn test_constant_product_swap_math() {
        // Pool: reserve_a = 1000, reserve_b = 1000
        // Swap 100 A -> B with 25 bps total fee (0.25%)
        let reserve_a: u128 = 1_000_000_000; // 1000 tokens (6 decimals)
        let reserve_b: u128 = 1_000_000_000;
        let amount_in: u128 = 100_000_000; // 100 tokens
        let total_fee_bps: u128 = 25;

        let effective_input = amount_in * (10_000 - total_fee_bps) / 10_000;
        let amount_out = reserve_b * effective_input / (reserve_a + effective_input);

        // amount_out should be slightly less than 100 due to constant product + fee
        assert!(amount_out < 100_000_000);
        assert!(amount_out > 90_000_000); // should be ~90.68M with these numbers

        // Verify invariant: new_k >= old_k
        let old_k = reserve_a * reserve_b;
        let new_reserve_a = reserve_a + amount_in - (amount_in * total_fee_bps / 10_000); // protocol fee removed
        let new_reserve_b = reserve_b - amount_out;
        let new_k = new_reserve_a * new_reserve_b;
        assert!(new_k >= old_k);
    }

    #[test]
    fn test_lp_token_initial_mint() {
        // Initial deposit: 1000 A, 4000 B
        // LP = sqrt(1000 * 4000) = sqrt(4_000_000) = 2000
        let amount_a: u128 = 1_000_000_000; // 1000 tokens (6 dec)
        let amount_b: u128 = 4_000_000_000; // 4000 tokens
        let product = amount_a * amount_b;
        let lp = isqrt(product);
        assert_eq!(lp, 2_000_000_000); // 2000 tokens
    }

    #[test]
    fn test_proportional_deposit() {
        // Pool: reserve_a = 1000, reserve_b = 2000, lp_supply = 1414 (sqrt(2M))
        let reserve_a: u128 = 1_000;
        let reserve_b: u128 = 2_000;
        let lp_supply: u128 = 1_414;

        let desired_a: u128 = 100;
        let desired_b: u128 = 200;

        let lp_from_a = desired_a * lp_supply / reserve_a;
        let lp_from_b = desired_b * lp_supply / reserve_b;

        // Both should yield same LP amount since ratio is maintained
        assert_eq!(lp_from_a, 141); // 100 * 1414 / 1000
        assert_eq!(lp_from_b, 141); // 200 * 1414 / 2000
    }

    #[test]
    fn test_proportional_withdrawal() {
        let reserve_a: u128 = 10_000;
        let reserve_b: u128 = 20_000;
        let lp_supply: u128 = 14_142;
        let lp_amount: u128 = 1_414; // ~10% of supply

        let amount_a = lp_amount * reserve_a / lp_supply;
        let amount_b = lp_amount * reserve_b / lp_supply;

        // Should get ~10% of each reserve
        assert_eq!(amount_a, 999);   // ~10%
        assert_eq!(amount_b, 1_999); // ~10%
    }

    #[test]
    fn test_fee_accumulation() {
        // Pool with 1000 LP tokens, fee of 10 token_a
        let lp_supply: u128 = 1_000;
        let fee: u128 = 10;

        let fee_per_lp = fee * FEE_SCALE / lp_supply;

        // LP holder with 100 LP tokens (10% of supply)
        let lp_balance: u128 = 100;
        let claimable = fee_per_lp * lp_balance / FEE_SCALE;

        // Should get 10% of 10 = 1
        assert_eq!(claimable, 1);
    }

    #[test]
    fn test_swap_config_size() {
        let config = SwapConfig {
            is_initialized: true,
            is_paused: false,
            authority: Pubkey::default(),
            protocol_vault: Pubkey::default(),
            protocol_fee_bps: 3,
            lp_fee_bps: 22,
            pool_creation_fee: 100_000_000,
            total_pools: 0,
            total_volume: 0,
            total_fees_collected: 0,
            bump: 255,
        };
        let serialized = borsh::to_vec(&config).unwrap();
        assert_eq!(serialized.len(), SwapConfig::SIZE);
    }

    #[test]
    fn test_pool_size() {
        let pool = Pool {
            is_initialized: true,
            is_paused: false,
            mint_a: Pubkey::default(),
            mint_b: Pubkey::default(),
            vault_a: Pubkey::default(),
            vault_b: Pubkey::default(),
            lp_mint: Pubkey::default(),
            reserve_a: 0,
            reserve_b: 0,
            lp_supply: 0,
            total_volume: 0,
            total_fees: 0,
            accumulated_fees_per_lp_a: 0,
            accumulated_fees_per_lp_b: 0,
            creator: Pubkey::default(),
            created_at: 0,
            bump: 255,
        };
        let serialized = borsh::to_vec(&pool).unwrap();
        assert_eq!(serialized.len(), Pool::SIZE);
    }

    #[test]
    fn test_lp_position_size() {
        let pos = LpPosition {
            is_initialized: true,
            owner: Pubkey::default(),
            pool: Pubkey::default(),
            lp_amount: 0,
            last_accumulated_a: 0,
            last_accumulated_b: 0,
            bump: 255,
        };
        let serialized = borsh::to_vec(&pos).unwrap();
        assert_eq!(serialized.len(), LpPosition::SIZE);
    }

    #[test]
    fn test_sort_mints() {
        let a = Pubkey::new_from_array([1u8; 32]);
        let b = Pubkey::new_from_array([2u8; 32]);

        let (low, high) = sort_mints(&a, &b).unwrap();
        assert_eq!(low, &a);
        assert_eq!(high, &b);

        let (low2, high2) = sort_mints(&b, &a).unwrap();
        assert_eq!(low2, &a);
        assert_eq!(high2, &b);
    }

    #[test]
    fn test_sort_mints_identical_fails() {
        let a = Pubkey::new_from_array([1u8; 32]);
        assert!(sort_mints(&a, &a).is_err());
    }

    #[test]
    fn test_min_liquidity_lock() {
        // Initial deposit that yields exactly MIN_LIQUIDITY LP tokens should fail
        // Need > MIN_LIQUIDITY
        let amount_a: u128 = 1_000;
        let amount_b: u128 = 1_000;
        let lp = isqrt(amount_a * amount_b);
        assert_eq!(lp, 1_000);
        assert_eq!(lp as u64, MIN_LIQUIDITY);
        // Creator would get 0 LP tokens — this should be rejected
    }
}
