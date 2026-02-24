// MythicPad — AI Token Bonding Curve Launchpad for Mythic L2
// PumpFun-style launchpad: create tokens with bonding curves, buy/sell on curve,
// auto-graduate to MythicSwap DEX when threshold is reached.

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
    sysvar::Sysvar,
};

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

solana_program::declare_id!("62dVNKTPhChmGVzQu7YzK19vVtTk371Zg7iHfNzk635c");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAUNCHPAD_CONFIG_SEED: &[u8] = b"launchpad_config";
const TOKEN_LAUNCH_SEED: &[u8] = b"token_launch";
const MINT_SEED: &[u8] = b"mint";
const CURVE_VAULT_SEED: &[u8] = b"curve_vault";
const BPS_DENOMINATOR: u64 = 10_000;
const MAX_TOKEN_NAME_LEN: usize = 32;
const MAX_TOKEN_SYMBOL_LEN: usize = 10;
const MAX_TOKEN_URI_LEN: usize = 200;
const MAX_DESCRIPTION_LEN: usize = 256;
const TOKEN_DECIMALS: u8 = 6;

/// MYTH Token program ID — fees are routed here for unified burn/distribute.
const MYTH_TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf");
const FEE_CONFIG_SEED_MT: &[u8] = b"fee_config";

/// Fee type discriminators for myth-token CollectFee
const FEE_TYPE_COMPUTE: u8 = 1;

// Default values (used in tests and client-side configuration)
pub const DEFAULT_GRADUATION_THRESHOLD: u64 = 85_000_000_000; // 85 MYTH
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 100; // 1%

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
        1 => process_create_token(program_id, accounts, data),
        2 => process_buy(program_id, accounts, data),
        3 => process_sell(program_id, accounts, data),
        4 => process_graduate(program_id, accounts, data),
        5 => process_update_config(program_id, accounts, data),
        6 => process_claim_creator_fee(program_id, accounts, data),
        7 => process_pause(program_id, accounts),
        8 => process_unpause(program_id, accounts),
        _ => Err(LaunchpadError::InvalidInstruction.into()),
    }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum LaunchpadError {
    #[error("Invalid instruction discriminator")]
    InvalidInstruction,
    #[error("Token name exceeds 32 bytes")]
    TokenNameTooLong,
    #[error("Token symbol exceeds 10 bytes")]
    TokenSymbolTooLong,
    #[error("Token URI exceeds 200 bytes")]
    TokenUriTooLong,
    #[error("Description exceeds 256 bytes")]
    DescriptionTooLong,
    #[error("Insufficient funds for this operation")]
    InsufficientFunds,
    #[error("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[error("Bonding curve is not active")]
    CurveNotActive,
    #[error("Bonding curve already graduated")]
    CurveAlreadyGraduated,
    #[error("Graduation threshold not yet met")]
    GraduationThresholdNotMet,
    #[error("Invalid amount (must be > 0)")]
    InvalidAmount,
    #[error("Arithmetic overflow")]
    Overflow,
    #[error("Invalid authority for this operation")]
    InvalidAuthority,
    #[error("Account already initialized")]
    AlreadyInitialized,
    #[error("Account not initialized")]
    NotInitialized,
    #[error("Invalid PDA derivation")]
    InvalidPDA,
    #[error("Account not writable")]
    AccountNotWritable,
    #[error("Account not signer")]
    AccountNotSigner,
    #[error("Invalid account owner")]
    InvalidOwner,
    #[error("Max supply exceeded")]
    MaxSupplyExceeded,
    #[error("No creator fee to claim")]
    NoCreatorFee,
    #[error("Invalid protocol fee (must be <= 1000 bps / 10%)")]
    InvalidProtocolFee,
    #[error("Program is paused")]
    ProgramPaused,
}

impl From<LaunchpadError> for ProgramError {
    fn from(e: LaunchpadError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ---------------------------------------------------------------------------
// State: LaunchpadConfig
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct LaunchpadConfig {
    pub is_initialized: bool,       // 1
    pub admin: Pubkey,               // 32
    pub graduation_threshold: u64,   // 8
    pub protocol_fee_bps: u16,       // 2
    pub foundation_wallet: Pubkey,   // 32
    pub total_tokens_launched: u64,  // 8
    pub total_myth_collected: u64,   // 8
    pub total_graduations: u64,      // 8
    pub is_paused: bool,             // 1
    pub bump: u8,                    // 1
}

impl LaunchpadConfig {
    // 1 + 32 + 8 + 2 + 32 + 8 + 8 + 8 + 1 + 1 = 101
    pub const SIZE: usize = 101;
}

// ---------------------------------------------------------------------------
// State: TokenLaunch
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum LaunchStatus {
    Active = 0,
    Graduated = 1,
    Failed = 2,
}

impl TryFrom<u8> for LaunchStatus {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(LaunchStatus::Active),
            1 => Ok(LaunchStatus::Graduated),
            2 => Ok(LaunchStatus::Failed),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct TokenLaunch {
    pub is_initialized: bool,           // 1
    pub creator: Pubkey,                // 32
    pub mint: Pubkey,                   // 32
    pub token_name: [u8; 32],          // 32
    pub token_symbol: [u8; 10],        // 10
    pub token_uri: [u8; 200],          // 200
    pub description: [u8; 256],        // 256
    pub ai_model_hash: [u8; 32],       // 32
    pub has_ai_model: bool,            // 1
    pub base_price: u64,               // 8
    pub slope: u64,                    // 8
    pub max_supply: u64,               // 8
    pub tokens_sold: u64,              // 8
    pub myth_collected: u64,           // 8
    pub status: u8,                    // 1  (LaunchStatus as u8)
    pub created_at: i64,               // 8
    pub graduated_at: i64,             // 8
    pub launch_index: u64,             // 8
    pub creator_fee_lamports: u64,     // 8  — creator's 10% share after graduation
    pub creator_fee_claimed: bool,     // 1
    pub bump: u8,                      // 1
}

impl TokenLaunch {
    // 1+32+32+32+10+200+256+32+1+8+8+8+8+8+1+8+8+8+8+1+1 = 671
    pub const SIZE: usize = 671;

    pub fn get_status(&self) -> Result<LaunchStatus, ProgramError> {
        LaunchStatus::try_from(self.status)
    }
}

// ---------------------------------------------------------------------------
// Instruction data structs
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub graduation_threshold: u64,
    pub protocol_fee_bps: u16,
    pub foundation_wallet: Pubkey,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct CreateTokenArgs {
    pub token_name: String,
    pub token_symbol: String,
    pub token_uri: String,
    pub description: String,
    pub ai_model_hash: Option<[u8; 32]>,
    pub base_price: u64,
    pub slope: u64,
    pub max_supply: u64,
    pub creator_buy_amount: u64, // 0 = no pre-buy
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BuyArgs {
    pub amount: u64,
    pub max_cost: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SellArgs {
    pub amount: u64,
    pub min_refund: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateConfigArgs {
    pub graduation_threshold: Option<u64>,
    pub protocol_fee_bps: Option<u16>,
    pub foundation_wallet: Option<Pubkey>,
}

// ---------------------------------------------------------------------------
// Bonding Curve Math
// ---------------------------------------------------------------------------
// Linear bonding curve: price(x) = base_price + slope * x
// where x = tokens_sold (in raw token units, 6 decimals)
//
// Cost to buy N tokens starting at tokens_sold = S:
//   cost = integral from S to S+N of (base_price + slope * x) dx
//        = N * base_price + slope * (S*N + N*(N-1)/2)
//
// Refund for selling N tokens starting at tokens_sold = S:
//   refund = integral from S-N to S of (base_price + slope * x) dx
//          = N * base_price + slope * ((S-N)*N + N*(N-1)/2)

/// Calculate cost to buy `amount` tokens when `tokens_sold` have already been sold.
/// All arithmetic done in u128 to prevent overflow, result fits in u64.
fn calculate_buy_cost(
    base_price: u64,
    slope: u64,
    tokens_sold: u64,
    amount: u64,
) -> Result<u64, ProgramError> {
    if amount == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let n = amount as u128;
    let s = tokens_sold as u128;
    let bp = base_price as u128;
    let sl = slope as u128;

    // cost = N * base_price + slope * (S * N + N * (N - 1) / 2)
    let base_cost = n
        .checked_mul(bp)
        .ok_or(LaunchpadError::Overflow)?;

    let s_times_n = s
        .checked_mul(n)
        .ok_or(LaunchpadError::Overflow)?;

    let n_minus_1 = n.checked_sub(1).ok_or(LaunchpadError::Overflow)?;
    let triangle = n
        .checked_mul(n_minus_1)
        .ok_or(LaunchpadError::Overflow)?
        / 2;

    let slope_part = s_times_n
        .checked_add(triangle)
        .ok_or(LaunchpadError::Overflow)?;

    let slope_cost = sl
        .checked_mul(slope_part)
        .ok_or(LaunchpadError::Overflow)?;

    let total = base_cost
        .checked_add(slope_cost)
        .ok_or(LaunchpadError::Overflow)?;

    u64::try_from(total).map_err(|_| LaunchpadError::Overflow.into())
}

/// Calculate refund for selling `amount` tokens when `tokens_sold` tokens exist.
fn calculate_sell_refund(
    base_price: u64,
    slope: u64,
    tokens_sold: u64,
    amount: u64,
) -> Result<u64, ProgramError> {
    if amount == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }
    if amount > tokens_sold {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let n = amount as u128;
    let s = tokens_sold as u128;
    let bp = base_price as u128;
    let sl = slope as u128;

    // refund = N * base_price + slope * ((S - N) * N + N * (N - 1) / 2)
    let base_refund = n
        .checked_mul(bp)
        .ok_or(LaunchpadError::Overflow)?;

    let s_minus_n = s
        .checked_sub(n)
        .ok_or(LaunchpadError::Overflow)?;

    let s_minus_n_times_n = s_minus_n
        .checked_mul(n)
        .ok_or(LaunchpadError::Overflow)?;

    let n_minus_1 = n.checked_sub(1).ok_or(LaunchpadError::Overflow)?;
    let triangle = n
        .checked_mul(n_minus_1)
        .ok_or(LaunchpadError::Overflow)?
        / 2;

    let slope_part = s_minus_n_times_n
        .checked_add(triangle)
        .ok_or(LaunchpadError::Overflow)?;

    let slope_refund = sl
        .checked_mul(slope_part)
        .ok_or(LaunchpadError::Overflow)?;

    let total = base_refund
        .checked_add(slope_refund)
        .ok_or(LaunchpadError::Overflow)?;

    u64::try_from(total).map_err(|_| LaunchpadError::Overflow.into())
}

/// Calculate the instantaneous price at the current tokens_sold level.
fn calculate_current_price(base_price: u64, slope: u64, tokens_sold: u64) -> Result<u64, ProgramError> {
    let price = (base_price as u128)
        .checked_add(
            (slope as u128)
                .checked_mul(tokens_sold as u128)
                .ok_or(LaunchpadError::Overflow)?,
        )
        .ok_or(LaunchpadError::Overflow)?;
    u64::try_from(price).map_err(|_| LaunchpadError::Overflow.into())
}

/// Calculate protocol fee: amount * fee_bps / 10_000
fn calculate_fee(amount: u64, fee_bps: u16) -> Result<u64, ProgramError> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(LaunchpadError::Overflow)?
        / (BPS_DENOMINATOR as u128);
    u64::try_from(fee).map_err(|_| LaunchpadError::Overflow.into())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(LaunchpadError::AccountNotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(LaunchpadError::AccountNotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(LaunchpadError::InvalidOwner.into());
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

/// Extract a printable string from a fixed-size byte array (up to first null or end).
pub fn fixed_to_string(buf: &[u8]) -> String {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).to_string()
}

/// Transfer $MYTH (SPL tokens) between token accounts.
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

/// Mint new tokens from a PDA-controlled mint.
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
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let ix = spl_token::instruction::burn(
        token_program.key,
        token_account.key,
        mint.key,
        authority.key,
        &[],
        amount,
    )?;

    if signer_seeds.is_empty() {
        invoke(
            &ix,
            &[
                token_account.clone(),
                mint.clone(),
                authority.clone(),
                token_program.clone(),
            ],
        )
    } else {
        invoke_signed(
            &ix,
            &[
                token_account.clone(),
                mint.clone(),
                authority.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )
    }
}

/// CPI to myth-token CollectFee — routes protocol fees through the unified
/// burn/distribution engine. Best-effort: callers should ignore errors so
/// that the launchpad still works even if the myth-token program is not
/// deployed or the accounts are missing.
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

// ---------------------------------------------------------------------------
// Instruction 0: Initialize
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] admin
//   1. [writable]          launchpad_config PDA
//   2. []                  system_program

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.protocol_fee_bps > 1000 {
        return Err(LaunchpadError::InvalidProtocolFee.into());
    }

    let account_iter = &mut accounts.iter();
    let admin = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;

    // Derive config PDA
    let (config_pda, config_bump) =
        Pubkey::find_program_address(&[LAUNCHPAD_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    if !config_account.data_is_empty() {
        return Err(LaunchpadError::AlreadyInitialized.into());
    }

    create_pda_account(
        admin,
        LaunchpadConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[LAUNCHPAD_CONFIG_SEED, &[config_bump]],
    )?;

    let config = LaunchpadConfig {
        is_initialized: true,
        admin: *admin.key,
        graduation_threshold: args.graduation_threshold,
        protocol_fee_bps: args.protocol_fee_bps,
        foundation_wallet: args.foundation_wallet,
        total_tokens_launched: 0,
        total_myth_collected: 0,
        total_graduations: 0,
        is_paused: false,
        bump: config_bump,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:LaunchpadInitialized:{{\"admin\":\"{}\",\"graduation_threshold\":{},\"protocol_fee_bps\":{},\"foundation\":\"{}\"}}",
        admin.key,
        args.graduation_threshold,
        args.protocol_fee_bps,
        args.foundation_wallet,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 1: CreateToken
// ---------------------------------------------------------------------------
// Accounts:
//   0.  [signer, writable] creator
//   1.  [writable]          launchpad_config PDA
//   2.  [writable]          token_launch PDA (seeds: ["token_launch", mint.key])
//   3.  [writable]          mint PDA (seeds: ["mint", launch_index.to_le_bytes()])
//   4.  [writable]          curve_vault — $MYTH ATA owned by curve_vault_authority
//   5.  []                  curve_vault_authority — PDA (seeds: ["curve_vault", mint.key])
//   6.  []                  myth_mint — the $MYTH token mint
//   7.  [writable]          creator_myth_ata — creator's $MYTH token account (for pre-buy cost)
//   8.  [writable]          creator_token_ata — creator's ATA for the new token (receives pre-buy)
//   9.  [writable]          foundation_myth_ata — foundation $MYTH account (receives fees)
//   10. []                  token_program (spl_token)
//   11. []                  associated_token_program
//   12. []                  system_program
//   13. []                  rent sysvar

fn process_create_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CreateTokenArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Validate string lengths
    if args.token_name.len() > MAX_TOKEN_NAME_LEN {
        return Err(LaunchpadError::TokenNameTooLong.into());
    }
    if args.token_symbol.len() > MAX_TOKEN_SYMBOL_LEN {
        return Err(LaunchpadError::TokenSymbolTooLong.into());
    }
    if args.token_uri.len() > MAX_TOKEN_URI_LEN {
        return Err(LaunchpadError::TokenUriTooLong.into());
    }
    if args.description.len() > MAX_DESCRIPTION_LEN {
        return Err(LaunchpadError::DescriptionTooLong.into());
    }
    if args.max_supply == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }
    if args.base_price == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let account_iter = &mut accounts.iter();
    let creator = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let token_launch_account = next_account_info(account_iter)?;
    let mint_account = next_account_info(account_iter)?;
    let curve_vault = next_account_info(account_iter)?;
    let curve_vault_authority = next_account_info(account_iter)?;
    let myth_mint = next_account_info(account_iter)?;
    let creator_myth_ata = next_account_info(account_iter)?;
    let creator_token_ata = next_account_info(account_iter)?;
    let foundation_myth_ata = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let associated_token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    assert_signer(creator)?;
    assert_writable(creator)?;
    assert_writable(config_account)?;
    assert_writable(token_launch_account)?;
    assert_writable(mint_account)?;
    assert_writable(curve_vault)?;
    assert_owned_by(config_account, program_id)?;

    // Load and check config
    let mut config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(LaunchpadError::ProgramPaused.into());
    }

    let launch_index = config.total_tokens_launched;
    let launch_index_bytes = launch_index.to_le_bytes();

    // Derive mint PDA
    let (mint_pda, mint_bump) =
        Pubkey::find_program_address(&[MINT_SEED, &launch_index_bytes], program_id);
    if mint_account.key != &mint_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    // Derive token_launch PDA (seeds: ["token_launch", mint_pubkey])
    let (launch_pda, launch_bump) =
        Pubkey::find_program_address(&[TOKEN_LAUNCH_SEED, mint_pda.as_ref()], program_id);
    if token_launch_account.key != &launch_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    // Derive curve_vault authority PDA (seeds: ["curve_vault", mint_pubkey])
    let (vault_pda, _vault_bump) =
        Pubkey::find_program_address(&[CURVE_VAULT_SEED, mint_pda.as_ref()], program_id);
    if curve_vault_authority.key != &vault_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    // curve_vault (account[4]) is the ATA for $MYTH owned by the vault PDA.
    // Validate it's the correct ATA derivation.
    let expected_vault_ata = spl_associated_token_account::get_associated_token_address(
        &vault_pda,
        myth_mint.key,
    );
    if curve_vault.key != &expected_vault_ata {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    if !token_launch_account.data_is_empty() {
        return Err(LaunchpadError::AlreadyInitialized.into());
    }

    // 1. Create the SPL Token Mint (PDA-owned by the program)
    let mint_rent = Rent::get()?.minimum_balance(spl_token::state::Mint::LEN);
    invoke_signed(
        &system_instruction::create_account(
            creator.key,
            &mint_pda,
            mint_rent,
            spl_token::state::Mint::LEN as u64,
            &spl_token::id(),
        ),
        &[creator.clone(), mint_account.clone(), system_program.clone()],
        &[&[MINT_SEED, &launch_index_bytes, &[mint_bump]]],
    )?;

    // Initialize the mint with the mint PDA itself as authority (the program signs via PDA)
    invoke_signed(
        &spl_token::instruction::initialize_mint(
            &spl_token::id(),
            &mint_pda,
            &mint_pda, // mint authority = the mint PDA itself (program signs)
            None,       // no freeze authority
            TOKEN_DECIMALS,
        )?,
        &[mint_account.clone(), rent_sysvar.clone()],
        &[&[MINT_SEED, &launch_index_bytes, &[mint_bump]]],
    )?;

    // 2. Create the curve vault ATA for $MYTH (owned by the vault PDA).
    //    Uses idempotent create — succeeds even if already created.
    invoke(
        &spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            creator.key,
            &vault_pda,    // owner of the ATA = the curve_vault authority PDA
            myth_mint.key, // $MYTH mint
            &spl_token::id(),
        ),
        &[
            creator.clone(),              // funding account (payer)
            curve_vault.clone(),          // associated token account to create
            curve_vault_authority.clone(), // wallet (owner of the ATA)
            myth_mint.clone(),            // token mint
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
    )?;

    // 3. Create the TokenLaunch PDA account
    create_pda_account(
        creator,
        TokenLaunch::SIZE,
        program_id,
        system_program,
        token_launch_account,
        &[TOKEN_LAUNCH_SEED, mint_pda.as_ref(), &[launch_bump]],
    )?;

    let clock = Clock::get()?;

    let (ai_model_hash, has_ai_model) = match args.ai_model_hash {
        Some(hash) => (hash, true),
        None => ([0u8; 32], false),
    };

    let mut launch = TokenLaunch {
        is_initialized: true,
        creator: *creator.key,
        mint: mint_pda,
        token_name: string_to_fixed::<32>(&args.token_name),
        token_symbol: string_to_fixed::<10>(&args.token_symbol),
        token_uri: string_to_fixed::<200>(&args.token_uri),
        description: string_to_fixed::<256>(&args.description),
        ai_model_hash,
        has_ai_model,
        base_price: args.base_price,
        slope: args.slope,
        max_supply: args.max_supply,
        tokens_sold: 0,
        myth_collected: 0,
        status: LaunchStatus::Active as u8,
        created_at: clock.unix_timestamp,
        graduated_at: 0,
        launch_index: launch_index,
        creator_fee_lamports: 0,
        creator_fee_claimed: false,
        bump: launch_bump,
    };

    // 4. Update config counter
    config.total_tokens_launched = config
        .total_tokens_launched
        .checked_add(1)
        .ok_or(LaunchpadError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    // 5. Handle creator pre-buy if requested
    if args.creator_buy_amount > 0 {
        // Validate the pre-buy doesn't exceed max supply
        if args.creator_buy_amount > args.max_supply {
            return Err(LaunchpadError::MaxSupplyExceeded.into());
        }

        let cost = calculate_buy_cost(
            args.base_price,
            args.slope,
            0, // tokens_sold starts at 0
            args.creator_buy_amount,
        )?;

        let fee = calculate_fee(cost, config.protocol_fee_bps)?;
        let total_cost = cost.checked_add(fee).ok_or(LaunchpadError::Overflow)?;

        // Transfer $MYTH from creator to curve vault
        transfer_spl_tokens(
            creator_myth_ata,
            curve_vault,
            creator,
            token_program,
            cost,
            &[],
        )?;

        // Transfer fee to foundation
        if fee > 0 {
            transfer_spl_tokens(
                creator_myth_ata,
                foundation_myth_ata,
                creator,
                token_program,
                fee,
                &[],
            )?;
        }

        // Mint tokens to creator's ATA
        // Create creator's token ATA if needed
        invoke(
            &spl_associated_token_account::instruction::create_associated_token_account_idempotent(
                creator.key,
                creator.key,
                &mint_pda,
                &spl_token::id(),
            ),
            &[
                creator.clone(),
                creator_token_ata.clone(),
                creator.clone(),
                mint_account.clone(),
                system_program.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;

        mint_tokens_signed(
            mint_account,
            creator_token_ata,
            mint_account, // mint authority is the mint PDA
            token_program,
            args.creator_buy_amount,
            &[MINT_SEED, &launch_index_bytes, &[mint_bump]],
        )?;

        launch.tokens_sold = args.creator_buy_amount;
        launch.myth_collected = cost;

        let price = calculate_current_price(args.base_price, args.slope, launch.tokens_sold)?;
        msg!(
            "EVENT:Trade:{{\"trader\":\"{}\",\"mint\":\"{}\",\"side\":\"Buy\",\"amount\":{},\"cost_or_refund\":{},\"price_per_token\":{},\"tokens_sold_after\":{}}}",
            creator.key,
            mint_pda,
            args.creator_buy_amount,
            total_cost,
            price,
            launch.tokens_sold,
        );
    }

    launch.serialize(&mut &mut token_launch_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:TokenCreated:{{\"creator\":\"{}\",\"mint\":\"{}\",\"name\":\"{}\",\"symbol\":\"{}\",\"base_price\":{},\"slope\":{},\"max_supply\":{},\"launch_index\":{}}}",
        creator.key,
        mint_pda,
        args.token_name,
        args.token_symbol,
        args.base_price,
        args.slope,
        args.max_supply,
        launch_index,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 2: Buy
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] buyer
//   1. [writable]          launchpad_config PDA
//   2. [writable]          token_launch PDA
//   3. [writable]          mint PDA
//   4. [writable]          curve_vault — $MYTH ATA for the curve
//   5. [writable]          buyer_myth_ata — buyer's $MYTH token account
//   6. [writable]          buyer_token_ata — buyer's ATA for the launched token
//   7. [writable]          foundation_myth_ata — foundation $MYTH account (fees)
//   8. []                  myth_mint — the $MYTH token mint
//   9. []                  token_program
//   10. []                 associated_token_program
//   11. []                 system_program
//
// Optional myth-token CPI accounts (for unified fee collection):
//   12. []                 myth_token_program
//   13. [writable]         myth_token fee_config PDA
//   14. [writable]         myth_token fee_pool PDA
//   15. [writable]         myth_mint (for burning)
//   16. [writable]         fee_pool_token_account

fn process_buy(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = BuyArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let account_iter = &mut accounts.iter();
    let buyer = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let token_launch_account = next_account_info(account_iter)?;
    let mint_account = next_account_info(account_iter)?;
    let curve_vault = next_account_info(account_iter)?;
    let buyer_myth_ata = next_account_info(account_iter)?;
    let buyer_token_ata = next_account_info(account_iter)?;
    let foundation_myth_ata = next_account_info(account_iter)?;
    let _myth_mint = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let associated_token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(buyer)?;
    assert_writable(buyer)?;
    assert_writable(config_account)?;
    assert_writable(token_launch_account)?;
    assert_writable(mint_account)?;
    assert_writable(curve_vault)?;
    assert_writable(buyer_myth_ata)?;
    assert_writable(buyer_token_ata)?;
    assert_writable(foundation_myth_ata)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(token_launch_account, program_id)?;

    // Validate token_program
    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }

    let mut launch = TokenLaunch::try_from_slice(&token_launch_account.data.borrow())?;
    if !launch.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if launch.get_status()? != LaunchStatus::Active {
        return Err(LaunchpadError::CurveNotActive.into());
    }

    // Validate mint matches
    if mint_account.key != &launch.mint {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    // Check max supply
    let new_tokens_sold = launch
        .tokens_sold
        .checked_add(args.amount)
        .ok_or(LaunchpadError::Overflow)?;
    if new_tokens_sold > launch.max_supply {
        return Err(LaunchpadError::MaxSupplyExceeded.into());
    }

    // Calculate cost
    let cost = calculate_buy_cost(
        launch.base_price,
        launch.slope,
        launch.tokens_sold,
        args.amount,
    )?;

    let fee = calculate_fee(cost, config.protocol_fee_bps)?;
    let total_cost = cost.checked_add(fee).ok_or(LaunchpadError::Overflow)?;

    // Slippage check
    if total_cost > args.max_cost {
        return Err(LaunchpadError::SlippageExceeded.into());
    }

    // Transfer $MYTH from buyer to curve vault
    transfer_spl_tokens(
        buyer_myth_ata,
        curve_vault,
        buyer,
        token_program,
        cost,
        &[],
    )?;

    // Transfer fee to foundation
    if fee > 0 {
        transfer_spl_tokens(
            buyer_myth_ata,
            foundation_myth_ata,
            buyer,
            token_program,
            fee,
            &[],
        )?;
    }

    // Optional myth-token CPI for unified fee tracking/burning
    if fee > 0 {
        let myth_token_program = next_account_info(account_iter);
        if let Ok(myth_prog) = myth_token_program {
            if myth_prog.key == &MYTH_TOKEN_PROGRAM_ID {
                let fee_config_info = next_account_info(account_iter)?;
                let fee_pool_info = next_account_info(account_iter)?;
                let myth_mint_info = next_account_info(account_iter)?;
                let fee_pool_token_info = next_account_info(account_iter)?;

                let _ = cpi_collect_fee(
                    buyer,
                    myth_prog,
                    fee_config_info,
                    fee_pool_info,
                    foundation_myth_ata,
                    foundation_myth_ata,
                    myth_mint_info,
                    fee_pool_token_info,
                    token_program,
                    system_program,
                    FEE_TYPE_COMPUTE,
                    fee,
                );
            }
        }
    }

    // Create buyer's token ATA if needed (idempotent)
    invoke(
        &spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            buyer.key,
            buyer.key,
            &launch.mint,
            &spl_token::id(),
        ),
        &[
            buyer.clone(),
            buyer_token_ata.clone(),
            buyer.clone(),
            mint_account.clone(),
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
    )?;

    // Mint tokens to buyer — mint authority is the mint PDA
    let launch_index_bytes = launch.launch_index.to_le_bytes();
    let (_, mint_bump) =
        Pubkey::find_program_address(&[MINT_SEED, &launch_index_bytes], program_id);

    mint_tokens_signed(
        mint_account,
        buyer_token_ata,
        mint_account,
        token_program,
        args.amount,
        &[MINT_SEED, &launch_index_bytes, &[mint_bump]],
    )?;

    // Update launch state
    launch.tokens_sold = new_tokens_sold;
    launch.myth_collected = launch
        .myth_collected
        .checked_add(cost)
        .ok_or(LaunchpadError::Overflow)?;

    let price = calculate_current_price(launch.base_price, launch.slope, launch.tokens_sold)?;

    // Check if we should auto-graduate
    if launch.myth_collected >= config.graduation_threshold {
        launch.status = LaunchStatus::Graduated as u8;
        let clock = Clock::get()?;
        launch.graduated_at = clock.unix_timestamp;

        msg!(
            "EVENT:Graduation:{{\"mint\":\"{}\",\"total_myth_collected\":{},\"tokens_sold\":{},\"dex_liquidity\":0,\"creator_share\":0}}",
            launch.mint,
            launch.myth_collected,
            launch.tokens_sold,
        );
    }

    launch.serialize(&mut &mut token_launch_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:Trade:{{\"trader\":\"{}\",\"mint\":\"{}\",\"side\":\"Buy\",\"amount\":{},\"cost_or_refund\":{},\"price_per_token\":{},\"tokens_sold_after\":{}}}",
        buyer.key,
        launch.mint,
        args.amount,
        total_cost,
        price,
        launch.tokens_sold,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 3: Sell
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer, writable] seller
//   1. [writable]          launchpad_config PDA
//   2. [writable]          token_launch PDA
//   3. [writable]          mint PDA
//   4. [writable]          curve_vault — $MYTH ATA for the curve
//   5. [writable]          curve_vault_authority PDA (seeds: ["curve_vault", mint])
//   6. [writable]          seller_myth_ata — seller's $MYTH token account
//   7. [writable]          seller_token_ata — seller's token account (tokens burned from here)
//   8. [writable]          foundation_myth_ata — foundation $MYTH account (fees)
//   9. []                  token_program
//
// Optional myth-token CPI accounts (for unified fee collection):
//   10. []                 myth_token_program
//   11. [writable]         myth_token fee_config PDA
//   12. [writable]         myth_token fee_pool PDA
//   13. [writable]         myth_mint (for burning)
//   14. [writable]         fee_pool_token_account

fn process_sell(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = SellArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let account_iter = &mut accounts.iter();
    let seller = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let token_launch_account = next_account_info(account_iter)?;
    let mint_account = next_account_info(account_iter)?;
    let curve_vault = next_account_info(account_iter)?;
    let curve_vault_authority = next_account_info(account_iter)?;
    let seller_myth_ata = next_account_info(account_iter)?;
    let seller_token_ata = next_account_info(account_iter)?;
    let foundation_myth_ata = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    assert_signer(seller)?;
    assert_writable(seller)?;
    assert_writable(token_launch_account)?;
    assert_writable(mint_account)?;
    assert_writable(curve_vault)?;
    assert_writable(seller_myth_ata)?;
    assert_writable(seller_token_ata)?;
    assert_writable(foundation_myth_ata)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(token_launch_account, program_id)?;

    // Validate token_program
    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if config.is_paused {
        return Err(LaunchpadError::ProgramPaused.into());
    }

    let mut launch = TokenLaunch::try_from_slice(&token_launch_account.data.borrow())?;
    if !launch.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if launch.get_status()? != LaunchStatus::Active {
        return Err(LaunchpadError::CurveNotActive.into());
    }

    // Validate mint matches
    if mint_account.key != &launch.mint {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    // Validate curve_vault_authority PDA
    let (vault_auth_pda, vault_auth_bump) =
        Pubkey::find_program_address(&[CURVE_VAULT_SEED, launch.mint.as_ref()], program_id);
    if curve_vault_authority.key != &vault_auth_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    // Check seller has enough tokens
    if args.amount > launch.tokens_sold {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    // Calculate refund
    let gross_refund = calculate_sell_refund(
        launch.base_price,
        launch.slope,
        launch.tokens_sold,
        args.amount,
    )?;

    let fee = calculate_fee(gross_refund, config.protocol_fee_bps)?;
    let net_refund = gross_refund.checked_sub(fee).ok_or(LaunchpadError::Overflow)?;

    // Slippage check
    if net_refund < args.min_refund {
        return Err(LaunchpadError::SlippageExceeded.into());
    }

    // Check vault has enough $MYTH
    if gross_refund > launch.myth_collected {
        return Err(LaunchpadError::InsufficientFunds.into());
    }

    // Burn tokens from seller's ATA
    burn_tokens(
        seller_token_ata,
        mint_account,
        seller,
        token_program,
        args.amount,
        &[], // seller signs directly (they own the token account)
    )?;

    // Transfer $MYTH refund from curve vault to seller
    let vault_seeds = &[CURVE_VAULT_SEED, launch.mint.as_ref(), &[vault_auth_bump]];

    transfer_spl_tokens(
        curve_vault,
        seller_myth_ata,
        curve_vault_authority,
        token_program,
        net_refund,
        vault_seeds,
    )?;

    // Transfer fee from curve vault to foundation
    if fee > 0 {
        transfer_spl_tokens(
            curve_vault,
            foundation_myth_ata,
            curve_vault_authority,
            token_program,
            fee,
            vault_seeds,
        )?;
    }

    // Optional myth-token CPI for unified fee tracking/burning
    if fee > 0 {
        let myth_token_program = next_account_info(account_iter);
        if let Ok(myth_prog) = myth_token_program {
            if myth_prog.key == &MYTH_TOKEN_PROGRAM_ID {
                let fee_config_info = next_account_info(account_iter)?;
                let fee_pool_info = next_account_info(account_iter)?;
                let myth_mint_info = next_account_info(account_iter)?;
                let fee_pool_token_info = next_account_info(account_iter)?;
                let system_prog = next_account_info(account_iter)?;

                let _ = cpi_collect_fee(
                    seller,
                    myth_prog,
                    fee_config_info,
                    fee_pool_info,
                    foundation_myth_ata,
                    foundation_myth_ata,
                    myth_mint_info,
                    fee_pool_token_info,
                    token_program,
                    system_prog,
                    FEE_TYPE_COMPUTE,
                    fee,
                );
            }
        }
    }

    // Update launch state
    launch.tokens_sold = launch
        .tokens_sold
        .checked_sub(args.amount)
        .ok_or(LaunchpadError::Overflow)?;
    launch.myth_collected = launch
        .myth_collected
        .checked_sub(gross_refund)
        .ok_or(LaunchpadError::Overflow)?;

    launch.serialize(&mut &mut token_launch_account.data.borrow_mut()[..])?;

    let price = calculate_current_price(launch.base_price, launch.slope, launch.tokens_sold)?;

    msg!(
        "EVENT:Trade:{{\"trader\":\"{}\",\"mint\":\"{}\",\"side\":\"Sell\",\"amount\":{},\"cost_or_refund\":{},\"price_per_token\":{},\"tokens_sold_after\":{}}}",
        seller.key,
        launch.mint,
        args.amount,
        net_refund,
        price,
        launch.tokens_sold,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 4: Graduate
// ---------------------------------------------------------------------------
// Manually trigger graduation (crank). Anyone can call this.
//
// Accounts:
//   0.  [signer, writable] cranker (pays for any new accounts)
//   1.  [writable]          launchpad_config PDA
//   2.  [writable]          token_launch PDA
//   3.  [writable]          mint PDA
//   4.  [writable]          curve_vault — $MYTH ATA for the curve
//   5.  [writable]          curve_vault_authority PDA
//   6.  [writable]          foundation_myth_ata — receives 10% of vault
//   7.  [writable]          creator_myth_ata — receives 10% of vault (or allocation stored)
//   8.  [writable]          dex_myth_ata — receives 80% of vault (MythicSwap LP creation)
//   9.  [writable]          dex_token_ata — receives remaining tokens for LP
//   10. []                  token_program
//
// Optional myth-token CPI accounts (for unified fee collection on foundation 10%):
//   11. []                 myth_token_program
//   12. [writable]         myth_token fee_config PDA
//   13. [writable]         myth_token fee_pool PDA
//   14. [writable]         myth_mint (for burning)
//   15. [writable]         fee_pool_token_account
//   16. []                 system_program

fn process_graduate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data;

    let account_iter = &mut accounts.iter();
    let cranker = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let token_launch_account = next_account_info(account_iter)?;
    let mint_account = next_account_info(account_iter)?;
    let curve_vault = next_account_info(account_iter)?;
    let curve_vault_authority = next_account_info(account_iter)?;
    let foundation_myth_ata = next_account_info(account_iter)?;
    let creator_myth_ata = next_account_info(account_iter)?;
    let dex_myth_ata = next_account_info(account_iter)?;
    let dex_token_ata = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    assert_signer(cranker)?;
    assert_writable(config_account)?;
    assert_writable(token_launch_account)?;
    assert_writable(mint_account)?;
    assert_writable(curve_vault)?;
    assert_writable(foundation_myth_ata)?;
    assert_writable(creator_myth_ata)?;
    assert_writable(dex_myth_ata)?;
    assert_writable(dex_token_ata)?;
    assert_owned_by(config_account, program_id)?;
    assert_owned_by(token_launch_account, program_id)?;

    let mut config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }

    let mut launch = TokenLaunch::try_from_slice(&token_launch_account.data.borrow())?;
    if !launch.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }

    match launch.get_status()? {
        LaunchStatus::Graduated => return Err(LaunchpadError::CurveAlreadyGraduated.into()),
        LaunchStatus::Failed => return Err(LaunchpadError::CurveNotActive.into()),
        LaunchStatus::Active => {}
    }

    // Verify graduation threshold is met
    if launch.myth_collected < config.graduation_threshold {
        return Err(LaunchpadError::GraduationThresholdNotMet.into());
    }

    // Validate PDA keys
    if mint_account.key != &launch.mint {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    let (vault_auth_pda, vault_auth_bump) =
        Pubkey::find_program_address(&[CURVE_VAULT_SEED, launch.mint.as_ref()], program_id);
    if curve_vault_authority.key != &vault_auth_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    let vault_seeds = &[CURVE_VAULT_SEED, launch.mint.as_ref(), &[vault_auth_bump]];

    let total_myth = launch.myth_collected;

    // Split: 80% to DEX, 10% to creator, 10% to foundation
    let dex_share = total_myth
        .checked_mul(80)
        .ok_or(LaunchpadError::Overflow)?
        .checked_div(100)
        .ok_or(LaunchpadError::Overflow)?;

    let creator_share = total_myth
        .checked_mul(10)
        .ok_or(LaunchpadError::Overflow)?
        .checked_div(100)
        .ok_or(LaunchpadError::Overflow)?;

    // Foundation gets the remainder (avoids rounding dust)
    let foundation_share = total_myth
        .checked_sub(dex_share)
        .ok_or(LaunchpadError::Overflow)?
        .checked_sub(creator_share)
        .ok_or(LaunchpadError::Overflow)?;

    // Transfer 80% to DEX
    if dex_share > 0 {
        transfer_spl_tokens(
            curve_vault,
            dex_myth_ata,
            curve_vault_authority,
            token_program,
            dex_share,
            vault_seeds,
        )?;
    }

    // Transfer 10% to creator
    if creator_share > 0 {
        transfer_spl_tokens(
            curve_vault,
            creator_myth_ata,
            curve_vault_authority,
            token_program,
            creator_share,
            vault_seeds,
        )?;
    }

    // Transfer remaining to foundation
    if foundation_share > 0 {
        transfer_spl_tokens(
            curve_vault,
            foundation_myth_ata,
            curve_vault_authority,
            token_program,
            foundation_share,
            vault_seeds,
        )?;
    }

    // Optional myth-token CPI for unified fee tracking/burning on foundation share
    if foundation_share > 0 {
        let myth_token_program = next_account_info(account_iter);
        if let Ok(myth_prog) = myth_token_program {
            if myth_prog.key == &MYTH_TOKEN_PROGRAM_ID {
                let fee_config_info = next_account_info(account_iter)?;
                let fee_pool_info = next_account_info(account_iter)?;
                let myth_mint_info = next_account_info(account_iter)?;
                let fee_pool_token_info = next_account_info(account_iter)?;
                let system_prog = next_account_info(account_iter)?;

                let _ = cpi_collect_fee(
                    cranker,
                    myth_prog,
                    fee_config_info,
                    fee_pool_info,
                    foundation_myth_ata,
                    foundation_myth_ata,
                    myth_mint_info,
                    fee_pool_token_info,
                    token_program,
                    system_prog,
                    FEE_TYPE_COMPUTE,
                    foundation_share,
                );
            }
        }
    }

    // Mint remaining tokens (max_supply - tokens_sold) to the DEX token ATA
    let remaining_tokens = launch
        .max_supply
        .checked_sub(launch.tokens_sold)
        .ok_or(LaunchpadError::Overflow)?;

    if remaining_tokens > 0 {
        let launch_index_bytes = launch.launch_index.to_le_bytes();
        let (_, mint_bump) =
            Pubkey::find_program_address(&[MINT_SEED, &launch_index_bytes], program_id);

        mint_tokens_signed(
            mint_account,
            dex_token_ata,
            mint_account,
            token_program,
            remaining_tokens,
            &[MINT_SEED, &launch_index_bytes, &[mint_bump]],
        )?;
    }

    // Update state
    let clock = Clock::get()?;
    launch.status = LaunchStatus::Graduated as u8;
    launch.graduated_at = clock.unix_timestamp;
    launch.creator_fee_lamports = creator_share;
    launch.creator_fee_claimed = true; // auto-sent during graduation
    launch.serialize(&mut &mut token_launch_account.data.borrow_mut()[..])?;

    config.total_graduations = config
        .total_graduations
        .checked_add(1)
        .ok_or(LaunchpadError::Overflow)?;
    config.total_myth_collected = config
        .total_myth_collected
        .checked_add(total_myth)
        .ok_or(LaunchpadError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:Graduation:{{\"mint\":\"{}\",\"total_myth_collected\":{},\"tokens_sold\":{},\"dex_liquidity\":{},\"creator_share\":{}}}",
        launch.mint,
        total_myth,
        launch.tokens_sold,
        dex_share,
        creator_share,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 5: UpdateConfig
// ---------------------------------------------------------------------------
// Accounts:
//   0. [signer]   admin
//   1. [writable] launchpad_config PDA

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

    let mut config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(LaunchpadError::InvalidAuthority.into());
    }

    if let Some(threshold) = args.graduation_threshold {
        config.graduation_threshold = threshold;
    }
    if let Some(fee_bps) = args.protocol_fee_bps {
        if fee_bps > 1000 {
            return Err(LaunchpadError::InvalidProtocolFee.into());
        }
        config.protocol_fee_bps = fee_bps;
    }
    if let Some(wallet) = args.foundation_wallet {
        config.foundation_wallet = wallet;
    }

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:ConfigUpdated:{{\"admin\":\"{}\",\"graduation_threshold\":{},\"protocol_fee_bps\":{}}}",
        admin.key,
        config.graduation_threshold,
        config.protocol_fee_bps,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 6: ClaimCreatorFee
// ---------------------------------------------------------------------------
// After graduation, if for some reason the creator fee was not auto-sent
// (e.g., the creator_myth_ata was not writable during graduation), the
// creator can claim it here. In the current flow, graduation auto-sends,
// so this is a safety fallback.
//
// Accounts:
//   0. [signer]   creator
//   1. [writable] token_launch PDA
//   2. [writable] curve_vault
//   3. [writable] curve_vault_authority PDA
//   4. [writable] creator_myth_ata
//   5. []         token_program

fn process_claim_creator_fee(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let _ = data;

    let account_iter = &mut accounts.iter();
    let creator = next_account_info(account_iter)?;
    let token_launch_account = next_account_info(account_iter)?;
    let curve_vault = next_account_info(account_iter)?;
    let curve_vault_authority = next_account_info(account_iter)?;
    let creator_myth_ata = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    assert_signer(creator)?;
    assert_writable(token_launch_account)?;
    assert_writable(curve_vault)?;
    assert_writable(creator_myth_ata)?;
    assert_owned_by(token_launch_account, program_id)?;

    let mut launch = TokenLaunch::try_from_slice(&token_launch_account.data.borrow())?;
    if !launch.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if launch.get_status()? != LaunchStatus::Graduated {
        return Err(LaunchpadError::CurveNotActive.into());
    }
    if creator.key != &launch.creator {
        return Err(LaunchpadError::InvalidAuthority.into());
    }
    if launch.creator_fee_claimed {
        return Err(LaunchpadError::NoCreatorFee.into());
    }
    if launch.creator_fee_lamports == 0 {
        return Err(LaunchpadError::NoCreatorFee.into());
    }

    // Validate curve_vault_authority PDA
    let (vault_auth_pda, vault_auth_bump) =
        Pubkey::find_program_address(&[CURVE_VAULT_SEED, launch.mint.as_ref()], program_id);
    if curve_vault_authority.key != &vault_auth_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    let vault_seeds = &[CURVE_VAULT_SEED, launch.mint.as_ref(), &[vault_auth_bump]];

    transfer_spl_tokens(
        curve_vault,
        creator_myth_ata,
        curve_vault_authority,
        token_program,
        launch.creator_fee_lamports,
        vault_seeds,
    )?;

    launch.creator_fee_claimed = true;
    launch.serialize(&mut &mut token_launch_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:CreatorFeeClaimed:{{\"creator\":\"{}\",\"mint\":\"{}\",\"amount\":{}}}",
        creator.key,
        launch.mint,
        launch.creator_fee_lamports,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 7: Pause (admin-only)
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
        Pubkey::find_program_address(&[LAUNCHPAD_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    let mut config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(LaunchpadError::InvalidAuthority.into());
    }

    config.is_paused = true;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:Paused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction 8: Unpause (admin-only)
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
        Pubkey::find_program_address(&[LAUNCHPAD_CONFIG_SEED], program_id);
    if *config_account.key != config_pda {
        return Err(LaunchpadError::InvalidPDA.into());
    }

    let mut config = LaunchpadConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(LaunchpadError::NotInitialized.into());
    }
    if admin.key != &config.admin {
        return Err(LaunchpadError::InvalidAuthority.into());
    }

    config.is_paused = false;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!("EVENT:Unpaused:{{\"admin\":\"{}\"}}", admin.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bonding_curve_buy_cost() {
        // base_price = 100, slope = 1, tokens_sold = 0, buy 1000
        // cost = 1000 * 100 + 1 * (0 * 1000 + 1000 * 999 / 2)
        //      = 100_000 + 499_500
        //      = 599_500
        let cost = calculate_buy_cost(100, 1, 0, 1000).unwrap();
        assert_eq!(cost, 599_500);
    }

    #[test]
    fn test_bonding_curve_buy_cost_nonzero_sold() {
        // base_price = 100, slope = 1, tokens_sold = 500, buy 500
        // cost = 500 * 100 + 1 * (500 * 500 + 500 * 499 / 2)
        //      = 50_000 + 1 * (250_000 + 124_750)
        //      = 50_000 + 374_750
        //      = 424_750
        let cost = calculate_buy_cost(100, 1, 500, 500).unwrap();
        assert_eq!(cost, 424_750);
    }

    #[test]
    fn test_bonding_curve_sell_refund() {
        // Buy 1000 at 0, then sell 1000 at 1000
        // Refund should equal original buy cost (no fees in math)
        let cost = calculate_buy_cost(100, 1, 0, 1000).unwrap();
        let refund = calculate_sell_refund(100, 1, 1000, 1000).unwrap();
        assert_eq!(cost, refund);
    }

    #[test]
    fn test_bonding_curve_partial_sell() {
        // base_price = 100, slope = 1, tokens_sold = 1000, sell 500
        // refund = 500 * 100 + 1 * ((1000 - 500) * 500 + 500 * 499 / 2)
        //        = 50_000 + 1 * (250_000 + 124_750)
        //        = 50_000 + 374_750
        //        = 424_750
        let refund = calculate_sell_refund(100, 1, 1000, 500).unwrap();
        assert_eq!(refund, 424_750);
    }

    #[test]
    fn test_bonding_curve_consistency() {
        // Buying 500 at 0, then 500 at 500, should equal buying 1000 at 0
        let cost_all = calculate_buy_cost(100, 1, 0, 1000).unwrap();
        let cost_first = calculate_buy_cost(100, 1, 0, 500).unwrap();
        let cost_second = calculate_buy_cost(100, 1, 500, 500).unwrap();
        assert_eq!(cost_all, cost_first + cost_second);
    }

    #[test]
    fn test_bonding_curve_sell_consistency() {
        // After buying 1000 tokens:
        // Selling 500 from 1000 + selling 500 from 500 = selling 1000 from 1000
        let refund_all = calculate_sell_refund(100, 1, 1000, 1000).unwrap();
        let refund_first = calculate_sell_refund(100, 1, 1000, 500).unwrap();
        let refund_second = calculate_sell_refund(100, 1, 500, 500).unwrap();
        assert_eq!(refund_all, refund_first + refund_second);
    }

    #[test]
    fn test_fee_calculation() {
        // 100 bps = 1% fee on 1_000_000
        let fee = calculate_fee(1_000_000, 100).unwrap();
        assert_eq!(fee, 10_000);

        // 0 bps = no fee
        let fee_zero = calculate_fee(1_000_000, 0).unwrap();
        assert_eq!(fee_zero, 0);

        // 1000 bps = 10%
        let fee_max = calculate_fee(1_000_000, 1000).unwrap();
        assert_eq!(fee_max, 100_000);
    }

    #[test]
    fn test_current_price() {
        // At tokens_sold = 0: price = base_price
        let p0 = calculate_current_price(100, 1, 0).unwrap();
        assert_eq!(p0, 100);

        // At tokens_sold = 1000: price = 100 + 1 * 1000 = 1100
        let p1000 = calculate_current_price(100, 1, 1000).unwrap();
        assert_eq!(p1000, 1100);
    }

    #[test]
    fn test_string_to_fixed() {
        let buf: [u8; 32] = string_to_fixed("Hello");
        assert_eq!(&buf[..5], b"Hello");
        assert_eq!(buf[5], 0);
    }

    #[test]
    fn test_fixed_to_string() {
        let mut buf = [0u8; 32];
        buf[..5].copy_from_slice(b"Hello");
        assert_eq!(fixed_to_string(&buf), "Hello");
    }

    #[test]
    fn test_buy_single_token() {
        // Buy 1 token at tokens_sold = 0
        // cost = 1 * 100 + 1 * (0 * 1 + 1 * 0 / 2) = 100
        let cost = calculate_buy_cost(100, 1, 0, 1).unwrap();
        assert_eq!(cost, 100);
    }

    #[test]
    fn test_sell_invalid_amount() {
        // Can't sell more than tokens_sold
        let result = calculate_sell_refund(100, 1, 500, 501);
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_amount_buy() {
        let result = calculate_buy_cost(100, 1, 0, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_amount_sell() {
        let result = calculate_sell_refund(100, 1, 100, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_launch_status_roundtrip() {
        assert_eq!(LaunchStatus::try_from(0).unwrap(), LaunchStatus::Active);
        assert_eq!(LaunchStatus::try_from(1).unwrap(), LaunchStatus::Graduated);
        assert_eq!(LaunchStatus::try_from(2).unwrap(), LaunchStatus::Failed);
        assert!(LaunchStatus::try_from(3).is_err());
    }

    #[test]
    fn test_launchpad_config_size() {
        // Verify our SIZE constant is correct for Borsh serialization
        let config = LaunchpadConfig {
            is_initialized: true,
            admin: Pubkey::default(),
            graduation_threshold: DEFAULT_GRADUATION_THRESHOLD,
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            foundation_wallet: Pubkey::default(),
            total_tokens_launched: 0,
            total_myth_collected: 0,
            total_graduations: 0,
            is_paused: false,
            bump: 255,
        };
        let serialized = borsh::to_vec(&config).unwrap();
        assert_eq!(serialized.len(), LaunchpadConfig::SIZE);
    }

    #[test]
    fn test_token_launch_size() {
        let launch = TokenLaunch {
            is_initialized: true,
            creator: Pubkey::default(),
            mint: Pubkey::default(),
            token_name: [0u8; 32],
            token_symbol: [0u8; 10],
            token_uri: [0u8; 200],
            description: [0u8; 256],
            ai_model_hash: [0u8; 32],
            has_ai_model: false,
            base_price: 100,
            slope: 1,
            max_supply: 1_000_000_000,
            tokens_sold: 0,
            myth_collected: 0,
            status: 0,
            created_at: 0,
            graduated_at: 0,
            launch_index: 0,
            creator_fee_lamports: 0,
            creator_fee_claimed: false,
            bump: 255,
        };
        let serialized = borsh::to_vec(&launch).unwrap();
        assert_eq!(serialized.len(), TokenLaunch::SIZE);
    }
}
