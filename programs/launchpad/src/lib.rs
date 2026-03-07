// MythicPad — AI Token Bonding Curve Launchpad for Mythic L2
// Constant-product (x*y=k) bonding curve launchpad: create tokens with virtual AMM,
// buy/sell on curve, auto-graduate to MythicSwap DEX when threshold is reached.

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

solana_program::declare_id!("CLBeDnHqa55wcgYeQwYdFyaG7WXoBdSrJwijA7DUgNy1");

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
const MAX_SOCIAL_LEN: usize = 64;
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
    #[error("Token account mint mismatch")]
    TokenMintMismatch,
    #[error("Token account owner mismatch")]
    TokenOwnerMismatch,
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
// State: TokenLaunch (constant product bonding curve)
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

#[derive(BorshSerialize, Debug, Clone)]
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
    pub virtual_base_reserve: u64,     // 8  (virtual token reserve)
    pub virtual_quote_reserve: u64,    // 8  (virtual MYTH reserve)
    pub max_supply: u64,               // 8
    pub tokens_sold: u64,              // 8
    pub myth_collected: u64,           // 8  (total real MYTH deposited into vault)
    pub status: u8,                    // 1  (LaunchStatus as u8)
    pub created_at: i64,               // 8
    pub graduated_at: i64,             // 8
    pub launch_index: u64,             // 8
    pub creator_fee_lamports: u64,     // 8
    pub creator_fee_claimed: bool,     // 1
    pub bump: u8,                      // 1
    pub graduation_threshold: u64,     // 8  (kept for compat, = migration_quote_threshold)
    // New fields appended for constant product curve:
    pub k_constant: u128,              // 16
    pub migration_quote_threshold: u64, // 8
    pub creation_fee_lamports: u64,    // 8
    pub initial_virtual_quote: u64,    // 8  (needed to calculate actual deposits vs virtual)
    // Social links (v2) — zero-filled for v1 719-byte accounts
    pub twitter: [u8; 64],             // 64
    pub telegram: [u8; 64],            // 64
    pub website: [u8; 64],             // 64
    pub vanity_nonce: u64,             // 8  (nonce used to grind vanity mint address)
}

// Custom deserialization: supports both v1 (719-byte) and v2 (919-byte) accounts.
impl BorshDeserialize for TokenLaunch {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let is_initialized = bool::deserialize_reader(reader)?;
        let creator = Pubkey::deserialize_reader(reader)?;
        let mint = Pubkey::deserialize_reader(reader)?;
        let token_name = <[u8; 32]>::deserialize_reader(reader)?;
        let token_symbol = <[u8; 10]>::deserialize_reader(reader)?;
        let token_uri = <[u8; 200]>::deserialize_reader(reader)?;
        let description = <[u8; 256]>::deserialize_reader(reader)?;
        let ai_model_hash = <[u8; 32]>::deserialize_reader(reader)?;
        let has_ai_model = bool::deserialize_reader(reader)?;
        let virtual_base_reserve = u64::deserialize_reader(reader)?;
        let virtual_quote_reserve = u64::deserialize_reader(reader)?;
        let max_supply = u64::deserialize_reader(reader)?;
        let tokens_sold = u64::deserialize_reader(reader)?;
        let myth_collected = u64::deserialize_reader(reader)?;
        let status = u8::deserialize_reader(reader)?;
        let created_at = i64::deserialize_reader(reader)?;
        let graduated_at = i64::deserialize_reader(reader)?;
        let launch_index = u64::deserialize_reader(reader)?;
        let creator_fee_lamports = u64::deserialize_reader(reader)?;
        let creator_fee_claimed = bool::deserialize_reader(reader)?;
        let bump = u8::deserialize_reader(reader)?;
        let graduation_threshold = u64::deserialize_reader(reader)?;
        let k_constant = u128::deserialize_reader(reader)?;
        let migration_quote_threshold = u64::deserialize_reader(reader)?;
        let creation_fee_lamports = u64::deserialize_reader(reader)?;
        let initial_virtual_quote = u64::deserialize_reader(reader)?;
        // v2 social fields — default to zero if account is v1 (719 bytes)
        let twitter = <[u8; 64]>::deserialize_reader(reader).unwrap_or([0u8; 64]);
        let telegram = <[u8; 64]>::deserialize_reader(reader).unwrap_or([0u8; 64]);
        let website = <[u8; 64]>::deserialize_reader(reader).unwrap_or([0u8; 64]);
        let vanity_nonce = u64::deserialize_reader(reader).unwrap_or(0);
        Ok(Self {
            is_initialized, creator, mint, token_name, token_symbol, token_uri,
            description, ai_model_hash, has_ai_model, virtual_base_reserve,
            virtual_quote_reserve, max_supply, tokens_sold, myth_collected,
            status, created_at, graduated_at, launch_index, creator_fee_lamports,
            creator_fee_claimed, bump, graduation_threshold, k_constant,
            migration_quote_threshold, creation_fee_lamports, initial_virtual_quote,
            twitter, telegram, website, vanity_nonce,
        })
    }
}

impl TokenLaunch {
    pub const SIZE: usize = 919;
    pub const V1_SIZE: usize = 719;

    pub fn get_status(&self) -> Result<LaunchStatus, ProgramError> {
        LaunchStatus::try_from(self.status)
    }

    /// Serialize to account data, writing only the bytes that fit.
    /// V1 accounts (719 bytes) get only core fields; V2 accounts (919) get everything.
    pub fn serialize_to_account(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        let full = borsh::to_vec(self).map_err(|_| ProgramError::BorshIoError("serialize".to_string()))?;
        let len = data.len().min(full.len());
        data[..len].copy_from_slice(&full[..len]);
        Ok(())
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
    pub max_supply: u64,              // total token supply (e.g. 1B * 10^6)
    pub initial_virtual_quote: u64,   // initial MYTH in virtual pool (sets starting price)
    pub migration_quote_threshold: u64, // MYTH to graduate (e.g. 20 SOL equiv, from client oracle)
    pub creation_fee: u64,            // $2 USD in MYTH (from client oracle), 0 = no fee
    pub creator_buy_amount: u64,      // MYTH to spend on pre-buy, 0 = no pre-buy
    pub twitter: String,              // Twitter/X handle or URL (max 64)
    pub telegram: String,             // Telegram group URL (max 64)
    pub website: String,              // Website URL (max 64)
    pub vanity_nonce: u64,            // Nonce for vanity mint address grinding
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BuyArgs {
    pub myth_amount: u64,       // MYTH to spend
    pub min_tokens_out: u64,    // slippage protection
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct SellArgs {
    pub token_amount: u64,      // tokens to sell
    pub min_myth_out: u64,      // slippage protection
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateConfigArgs {
    pub graduation_threshold: Option<u64>,
    pub protocol_fee_bps: Option<u16>,
    pub foundation_wallet: Option<Pubkey>,
}

// ---------------------------------------------------------------------------
// Constant Product Bonding Curve Math
// ---------------------------------------------------------------------------
// Virtual AMM: x * y = k
// where x = virtual_base_reserve (tokens), y = virtual_quote_reserve (MYTH)
//
// Buy: user deposits myth_in, receives tokens_out
//   new_y = y + myth_in
//   new_x = k / new_y  (rounded up to preserve k)
//   tokens_out = x - new_x
//
// Sell: user deposits tokens_in, receives myth_out
//   new_x = x + tokens_in
//   new_y = k / new_x  (rounded down, user gets less)
//   myth_out = y - new_y

/// Constant product buy: user deposits myth_in, receives tokens_out.
/// Returns (tokens_out, new_base_reserve, new_quote_reserve).
fn calculate_buy_output(
    virtual_base: u64,
    virtual_quote: u64,
    k: u128,
    myth_in: u64,
) -> Result<(u64, u64, u64), ProgramError> {
    if myth_in == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let new_quote = (virtual_quote as u128)
        .checked_add(myth_in as u128)
        .ok_or(LaunchpadError::Overflow)?;
    let new_base = k
        .checked_div(new_quote)
        .ok_or(LaunchpadError::Overflow)?;
    // Round up new_base to preserve k invariant
    let new_base = if k % new_quote != 0 { new_base + 1 } else { new_base };
    let tokens_out = (virtual_base as u128)
        .checked_sub(new_base)
        .ok_or(LaunchpadError::Overflow)?;

    let tokens_out = u64::try_from(tokens_out).map_err(|_| LaunchpadError::Overflow)?;
    let new_base = u64::try_from(new_base).map_err(|_| LaunchpadError::Overflow)?;
    let new_quote = u64::try_from(new_quote).map_err(|_| LaunchpadError::Overflow)?;

    Ok((tokens_out, new_base, new_quote))
}

/// Constant product sell: user deposits tokens_in, receives myth_out.
/// Returns (myth_out, new_base_reserve, new_quote_reserve).
fn calculate_sell_output(
    virtual_base: u64,
    virtual_quote: u64,
    k: u128,
    tokens_in: u64,
) -> Result<(u64, u64, u64), ProgramError> {
    if tokens_in == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }

    let new_base = (virtual_base as u128)
        .checked_add(tokens_in as u128)
        .ok_or(LaunchpadError::Overflow)?;
    let new_quote = k
        .checked_div(new_base)
        .ok_or(LaunchpadError::Overflow)?;
    // Round down new_quote (user gets less)
    let myth_out = (virtual_quote as u128)
        .checked_sub(new_quote)
        .ok_or(LaunchpadError::Overflow)?;

    let myth_out = u64::try_from(myth_out).map_err(|_| LaunchpadError::Overflow)?;
    let new_base = u64::try_from(new_base).map_err(|_| LaunchpadError::Overflow)?;
    let new_quote = u64::try_from(new_quote).map_err(|_| LaunchpadError::Overflow)?;

    Ok((myth_out, new_base, new_quote))
}

/// Calculate the instantaneous price: virtual_quote / virtual_base, scaled by 10^6.
fn calculate_current_price(virtual_base: u64, virtual_quote: u64) -> Result<u64, ProgramError> {
    if virtual_base == 0 {
        return Err(LaunchpadError::Overflow.into());
    }
    let price = (virtual_quote as u128)
        .checked_mul(1_000_000)
        .ok_or(LaunchpadError::Overflow)?
        .checked_div(virtual_base as u128)
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

/// Validate that a token account has the expected mint and owner.
/// Unpacks the SPL token account data to check.
fn assert_token_account(
    token_account: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> ProgramResult {
    if token_account.owner != &spl_token::id() {
        return Err(LaunchpadError::InvalidOwner.into());
    }
    let account_data = spl_token::state::Account::unpack(&token_account.data.borrow())?;
    if &account_data.mint != expected_mint {
        return Err(LaunchpadError::TokenMintMismatch.into());
    }
    if &account_data.owner != expected_owner {
        return Err(LaunchpadError::TokenOwnerMismatch.into());
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
//   7.  [writable]          creator_myth_ata — creator's $MYTH token account (for pre-buy cost + creation fee)
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
    if args.twitter.len() > MAX_SOCIAL_LEN {
        return Err(LaunchpadError::DescriptionTooLong.into());
    }
    if args.telegram.len() > MAX_SOCIAL_LEN {
        return Err(LaunchpadError::DescriptionTooLong.into());
    }
    if args.website.len() > MAX_SOCIAL_LEN {
        return Err(LaunchpadError::DescriptionTooLong.into());
    }
    if args.max_supply == 0 {
        return Err(LaunchpadError::InvalidAmount.into());
    }
    if args.initial_virtual_quote == 0 {
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
    let vanity_nonce_bytes = args.vanity_nonce.to_le_bytes();

    // Derive mint PDA (includes vanity_nonce for address grinding)
    let (mint_pda, mint_bump) =
        Pubkey::find_program_address(&[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes], program_id);
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
        &[&[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes, &[mint_bump]]],
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
        &[&[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes, &[mint_bump]]],
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

    // Compute constant product invariant
    let k_constant = (args.max_supply as u128)
        .checked_mul(args.initial_virtual_quote as u128)
        .ok_or(LaunchpadError::Overflow)?;

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
        virtual_base_reserve: args.max_supply,
        virtual_quote_reserve: args.initial_virtual_quote,
        max_supply: args.max_supply,
        tokens_sold: 0,
        myth_collected: 0,
        status: LaunchStatus::Active as u8,
        created_at: clock.unix_timestamp,
        graduated_at: 0,
        launch_index,
        creator_fee_lamports: 0,
        creator_fee_claimed: false,
        bump: launch_bump,
        graduation_threshold: args.migration_quote_threshold,
        k_constant,
        migration_quote_threshold: args.migration_quote_threshold,
        creation_fee_lamports: args.creation_fee,
        initial_virtual_quote: args.initial_virtual_quote,
        twitter: string_to_fixed::<64>(&args.twitter),
        telegram: string_to_fixed::<64>(&args.telegram),
        website: string_to_fixed::<64>(&args.website),
        vanity_nonce: args.vanity_nonce,
    };

    // 4. Update config counter
    config.total_tokens_launched = config
        .total_tokens_launched
        .checked_add(1)
        .ok_or(LaunchpadError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    // 5. Charge creation fee if specified
    if args.creation_fee > 0 {
        transfer_spl_tokens(
            creator_myth_ata,
            foundation_myth_ata,
            creator,
            token_program,
            args.creation_fee,
            &[],
        )?;
    }

    // 6. Handle creator pre-buy if requested (myth_amount to spend, not tokens)
    if args.creator_buy_amount > 0 {
        let fee = calculate_fee(args.creator_buy_amount, config.protocol_fee_bps)?;
        let effective_myth = args.creator_buy_amount
            .checked_sub(fee)
            .ok_or(LaunchpadError::Overflow)?;

        let (tokens_out, new_base, new_quote) = calculate_buy_output(
            launch.virtual_base_reserve,
            launch.virtual_quote_reserve,
            launch.k_constant,
            effective_myth,
        )?;

        // Transfer MYTH from creator to curve vault (the effective portion)
        transfer_spl_tokens(
            creator_myth_ata,
            curve_vault,
            creator,
            token_program,
            effective_myth,
            &[],
        )?;

        // Transfer fee to foundation (70% protocol, 30% creator — but creator IS the buyer here,
        // so send full fee to foundation)
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
            tokens_out,
            &[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes, &[mint_bump]],
        )?;

        launch.virtual_base_reserve = new_base;
        launch.virtual_quote_reserve = new_quote;
        launch.tokens_sold = tokens_out;
        launch.myth_collected = effective_myth;

        let price = calculate_current_price(launch.virtual_base_reserve, launch.virtual_quote_reserve)?;
        msg!(
            "EVENT:Trade:{{\"trader\":\"{}\",\"mint\":\"{}\",\"side\":\"Buy\",\"tokens\":{},\"myth_amount\":{},\"price_per_token\":{},\"tokens_sold_after\":{}}}",
            creator.key,
            mint_pda,
            tokens_out,
            args.creator_buy_amount,
            price,
            launch.tokens_sold,
        );
    }

    launch.serialize_to_account(&mut token_launch_account.data.borrow_mut())?;

    msg!(
        "EVENT:TokenCreated:{{\"creator\":\"{}\",\"mint\":\"{}\",\"name\":\"{}\",\"symbol\":\"{}\",\"max_supply\":{},\"initial_virtual_quote\":{},\"k\":{},\"migration_threshold\":{},\"launch_index\":{}}}",
        creator.key,
        mint_pda,
        args.token_name,
        args.token_symbol,
        args.max_supply,
        args.initial_virtual_quote,
        k_constant,
        args.migration_quote_threshold,
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

    if args.myth_amount == 0 {
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

    // Validate config PDA derivation
    let (config_pda, _) = Pubkey::find_program_address(&[LAUNCHPAD_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(LaunchpadError::InvalidPDA.into());
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

    // Apply fee first: effective_myth = myth_amount - fee
    let fee = calculate_fee(args.myth_amount, config.protocol_fee_bps)?;
    let effective_myth = args.myth_amount
        .checked_sub(fee)
        .ok_or(LaunchpadError::Overflow)?;

    // Calculate tokens out using constant product
    let (tokens_out, new_base, new_quote) = calculate_buy_output(
        launch.virtual_base_reserve,
        launch.virtual_quote_reserve,
        launch.k_constant,
        effective_myth,
    )?;

    // Slippage check
    if tokens_out < args.min_tokens_out {
        return Err(LaunchpadError::SlippageExceeded.into());
    }

    // Split fee: 70% to foundation (protocol_fee), 30% to creator
    let creator_fee_share = fee
        .checked_mul(30)
        .ok_or(LaunchpadError::Overflow)?
        .checked_div(100)
        .ok_or(LaunchpadError::Overflow)?;
    let protocol_fee_share = fee
        .checked_sub(creator_fee_share)
        .ok_or(LaunchpadError::Overflow)?;

    // Transfer effective MYTH from buyer to curve vault
    transfer_spl_tokens(
        buyer_myth_ata,
        curve_vault,
        buyer,
        token_program,
        effective_myth,
        &[],
    )?;

    // Transfer protocol fee portion to foundation
    if protocol_fee_share > 0 {
        transfer_spl_tokens(
            buyer_myth_ata,
            foundation_myth_ata,
            buyer,
            token_program,
            protocol_fee_share,
            &[],
        )?;
    }

    // Transfer creator fee share to curve vault (stored for creator)
    if creator_fee_share > 0 {
        transfer_spl_tokens(
            buyer_myth_ata,
            curve_vault,
            buyer,
            token_program,
            creator_fee_share,
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
    let vanity_nonce_bytes = launch.vanity_nonce.to_le_bytes();
    let (_, mint_bump) =
        Pubkey::find_program_address(&[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes], program_id);

    mint_tokens_signed(
        mint_account,
        buyer_token_ata,
        mint_account,
        token_program,
        tokens_out,
        &[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes, &[mint_bump]],
    )?;

    // Update launch state
    launch.virtual_base_reserve = new_base;
    launch.virtual_quote_reserve = new_quote;
    launch.tokens_sold = launch
        .tokens_sold
        .checked_add(tokens_out)
        .ok_or(LaunchpadError::Overflow)?;
    launch.myth_collected = launch
        .myth_collected
        .checked_add(effective_myth)
        .ok_or(LaunchpadError::Overflow)?;
    // Accumulate creator fee share
    launch.creator_fee_lamports = launch
        .creator_fee_lamports
        .checked_add(creator_fee_share)
        .ok_or(LaunchpadError::Overflow)?;

    let price = calculate_current_price(launch.virtual_base_reserve, launch.virtual_quote_reserve)?;

    // Check if we should auto-graduate
    if launch.virtual_quote_reserve >= launch.migration_quote_threshold {
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

    launch.serialize_to_account(&mut token_launch_account.data.borrow_mut())?;

    msg!(
        "EVENT:Trade:{{\"trader\":\"{}\",\"mint\":\"{}\",\"side\":\"Buy\",\"tokens\":{},\"myth_amount\":{},\"price_per_token\":{},\"tokens_sold_after\":{}}}",
        buyer.key,
        launch.mint,
        tokens_out,
        args.myth_amount,
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

    if args.token_amount == 0 {
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

    // Validate config PDA derivation
    let (config_pda, _) = Pubkey::find_program_address(&[LAUNCHPAD_CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(LaunchpadError::InvalidPDA.into());
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

    // H-3 Fix: Validate seller's token account has correct mint and owner
    assert_token_account(seller_token_ata, &launch.mint, seller.key)?;

    // Calculate MYTH out using constant product
    let (gross_myth_out, new_base, new_quote) = calculate_sell_output(
        launch.virtual_base_reserve,
        launch.virtual_quote_reserve,
        launch.k_constant,
        args.token_amount,
    )?;

    // Apply fee
    let fee = calculate_fee(gross_myth_out, config.protocol_fee_bps)?;
    let creator_fee_share = fee
        .checked_mul(30)
        .ok_or(LaunchpadError::Overflow)?
        .checked_div(100)
        .ok_or(LaunchpadError::Overflow)?;
    let protocol_fee_share = fee
        .checked_sub(creator_fee_share)
        .ok_or(LaunchpadError::Overflow)?;
    let net_myth_out = gross_myth_out
        .checked_sub(fee)
        .ok_or(LaunchpadError::Overflow)?;

    // Slippage check
    if net_myth_out < args.min_myth_out {
        return Err(LaunchpadError::SlippageExceeded.into());
    }

    // Check vault has enough $MYTH (actual deposits must cover the payout)
    if gross_myth_out > launch.myth_collected {
        return Err(LaunchpadError::InsufficientFunds.into());
    }

    // Burn tokens from seller's ATA
    burn_tokens(
        seller_token_ata,
        mint_account,
        seller,
        token_program,
        args.token_amount,
        &[], // seller signs directly (they own the token account)
    )?;

    // Transfer $MYTH refund from curve vault to seller
    let vault_seeds = &[CURVE_VAULT_SEED, launch.mint.as_ref(), &[vault_auth_bump]];

    transfer_spl_tokens(
        curve_vault,
        seller_myth_ata,
        curve_vault_authority,
        token_program,
        net_myth_out,
        vault_seeds,
    )?;

    // Transfer protocol fee from curve vault to foundation
    if protocol_fee_share > 0 {
        transfer_spl_tokens(
            curve_vault,
            foundation_myth_ata,
            curve_vault_authority,
            token_program,
            protocol_fee_share,
            vault_seeds,
        )?;
    }

    // Creator fee share stays in vault (tracked in creator_fee_lamports)

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
    launch.virtual_base_reserve = new_base;
    launch.virtual_quote_reserve = new_quote;
    launch.tokens_sold = launch
        .tokens_sold
        .checked_sub(args.token_amount)
        .ok_or(LaunchpadError::Overflow)?;
    launch.myth_collected = launch
        .myth_collected
        .checked_sub(gross_myth_out)
        .ok_or(LaunchpadError::Overflow)?;
    // Accumulate creator fee share (stays in vault)
    launch.creator_fee_lamports = launch
        .creator_fee_lamports
        .checked_add(creator_fee_share)
        .ok_or(LaunchpadError::Overflow)?;

    launch.serialize_to_account(&mut token_launch_account.data.borrow_mut())?;

    let price = calculate_current_price(launch.virtual_base_reserve, launch.virtual_quote_reserve)?;

    msg!(
        "EVENT:Trade:{{\"trader\":\"{}\",\"mint\":\"{}\",\"side\":\"Sell\",\"tokens\":{},\"myth_amount\":{},\"price_per_token\":{},\"tokens_sold_after\":{}}}",
        seller.key,
        launch.mint,
        args.token_amount,
        net_myth_out,
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
        LaunchStatus::Graduated => {
            // Allow processing auto-graduated tokens that haven't had funds distributed yet.
            // creator_fee_claimed is set to true only after process_graduate distributes funds.
            if launch.creator_fee_claimed {
                return Err(LaunchpadError::CurveAlreadyGraduated.into());
            }
        }
        LaunchStatus::Failed => return Err(LaunchpadError::CurveNotActive.into()),
        LaunchStatus::Active => {
            // Verify graduation threshold is met
            if launch.virtual_quote_reserve < launch.migration_quote_threshold {
                return Err(LaunchpadError::GraduationThresholdNotMet.into());
            }
        }
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

    // myth_collected tracks total real MYTH deposited. Use that for splits.
    let total_myth = launch.myth_collected;

    // Split: 80% to DEX, 10% to creator, 10% to foundation/protocol
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

    // Protocol gets the remainder (avoids rounding dust)
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

    let launch_index_bytes = launch.launch_index.to_le_bytes();
    let vanity_nonce_bytes = launch.vanity_nonce.to_le_bytes();
    let account_len = token_launch_account.data_len();

    // V1 accounts (719 bytes) use [MINT_SEED, launch_index] for mint PDA.
    // V2 accounts (919 bytes) use [MINT_SEED, launch_index, vanity_nonce].
    let is_v1 = account_len <= TokenLaunch::V1_SIZE;

    let mint_bump;
    if is_v1 {
        let (_, bump) = Pubkey::find_program_address(
            &[MINT_SEED, &launch_index_bytes], program_id,
        );
        mint_bump = bump;
    } else {
        let (_, bump) = Pubkey::find_program_address(
            &[MINT_SEED, &launch_index_bytes, &vanity_nonce_bytes], program_id,
        );
        mint_bump = bump;
    }

    // Build signer seeds matching the version
    let v1_seeds: &[&[u8]] = &[MINT_SEED, launch_index_bytes.as_ref(), &[mint_bump]];
    let v2_seeds: &[&[u8]] = &[MINT_SEED, launch_index_bytes.as_ref(), vanity_nonce_bytes.as_ref(), &[mint_bump]];
    let mint_seeds: &[&[u8]] = if is_v1 { v1_seeds } else { v2_seeds };

    if remaining_tokens > 0 {
        mint_tokens_signed(
            mint_account,
            dex_token_ata,
            mint_account,
            token_program,
            remaining_tokens,
            mint_seeds,
        )?;
    }

    // I-7 Fix: Revoke mint authority after graduation — makes tokens immutable
    let revoke_ix = spl_token::instruction::set_authority(
        &spl_token::id(),
        mint_account.key,
        None, // set authority to None (revoke)
        spl_token::instruction::AuthorityType::MintTokens,
        mint_account.key, // current authority is the mint PDA
        &[],
    )?;
    invoke_signed(
        &revoke_ix,
        &[mint_account.clone(), token_program.clone()],
        &[mint_seeds],
    )?;
    msg!("Mint authority revoked for graduated token {}", launch.mint);

    // Update state
    let clock = Clock::get()?;
    launch.status = LaunchStatus::Graduated as u8;
    launch.graduated_at = clock.unix_timestamp;
    launch.creator_fee_lamports = creator_share;
    launch.creator_fee_claimed = true; // auto-sent during graduation
    launch.serialize_to_account(&mut token_launch_account.data.borrow_mut())?;

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
    launch.serialize_to_account(&mut token_launch_account.data.borrow_mut())?;

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
    fn test_constant_product_buy() {
        // virtual_base = 1_000_000, virtual_quote = 1_000
        // k = 1_000_000 * 1_000 = 1_000_000_000
        // Buy with myth_in = 100
        // new_quote = 1_000 + 100 = 1_100
        // new_base = 1_000_000_000 / 1_100 = 909_090 (rounded up to 909_091 since 1B % 1100 != 0)
        // tokens_out = 1_000_000 - 909_091 = 90_909
        let k: u128 = 1_000_000 * 1_000;
        let (tokens_out, new_base, new_quote) =
            calculate_buy_output(1_000_000, 1_000, k, 100).unwrap();
        assert_eq!(new_quote, 1_100);
        // k / 1100 = 909090.909... => rounded up = 909091
        assert_eq!(new_base, 909_091);
        assert_eq!(tokens_out, 1_000_000 - 909_091);
        // Verify k invariant is preserved (new_base * new_quote >= k)
        assert!((new_base as u128) * (new_quote as u128) >= k);
    }

    #[test]
    fn test_constant_product_sell() {
        // Start from post-buy state: base=909_091, quote=1_100
        // k = 1_000_000_000
        // Sell 90_909 tokens
        // new_base = 909_091 + 90_909 = 1_000_000
        // new_quote = 1_000_000_000 / 1_000_000 = 1_000
        // myth_out = 1_100 - 1_000 = 100
        let k: u128 = 1_000_000_000;
        let (myth_out, new_base, new_quote) =
            calculate_sell_output(909_091, 1_100, k, 90_909).unwrap();
        assert_eq!(new_base, 1_000_000);
        assert_eq!(new_quote, 1_000);
        assert_eq!(myth_out, 100);
    }

    #[test]
    fn test_constant_product_price_impact() {
        // Larger buys have more price impact
        let k: u128 = 1_000_000_000_000; // 1M * 1M
        let (small_out, _, _) = calculate_buy_output(1_000_000, 1_000_000, k, 1_000).unwrap();
        let (large_out, _, _) = calculate_buy_output(1_000_000, 1_000_000, k, 100_000).unwrap();
        // 100x more MYTH should yield less than 100x more tokens (price impact)
        assert!(large_out < small_out * 100);
    }

    #[test]
    fn test_constant_product_round_trip() {
        // Buy then sell should return slightly less due to rounding
        let k: u128 = 1_000_000_000_000_000; // large k
        let (tokens_out, new_base, new_quote) =
            calculate_buy_output(1_000_000_000, 1_000_000, k, 10_000).unwrap();
        let (myth_back, final_base, final_quote) =
            calculate_sell_output(new_base, new_quote, k, tokens_out).unwrap();
        // Due to rounding, we get back slightly less or equal
        assert!(myth_back <= 10_000);
        // Reserves should be close to original
        assert!(final_base >= 1_000_000_000 - 1);
        assert!(final_quote >= 1_000_000 - 1);
    }

    #[test]
    fn test_buy_zero_fails() {
        let k: u128 = 1_000_000_000;
        let result = calculate_buy_output(1_000_000, 1_000, k, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_sell_zero_fails() {
        let k: u128 = 1_000_000_000;
        let result = calculate_sell_output(1_000_000, 1_000, k, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_current_price() {
        // price = virtual_quote / virtual_base * 10^6
        let price = calculate_current_price(1_000_000, 1_000).unwrap();
        // 1_000 / 1_000_000 * 1_000_000 = 1_000
        assert_eq!(price, 1_000);

        // After some buying, base decreases, quote increases => higher price
        let price2 = calculate_current_price(500_000, 2_000).unwrap();
        // 2_000 / 500_000 * 1_000_000 = 4_000
        assert_eq!(price2, 4_000);
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
    fn test_launch_status_roundtrip() {
        assert_eq!(LaunchStatus::try_from(0).unwrap(), LaunchStatus::Active);
        assert_eq!(LaunchStatus::try_from(1).unwrap(), LaunchStatus::Graduated);
        assert_eq!(LaunchStatus::try_from(2).unwrap(), LaunchStatus::Failed);
        assert!(LaunchStatus::try_from(3).is_err());
    }

    #[test]
    fn test_launchpad_config_size() {
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
            virtual_base_reserve: 1_000_000_000,
            virtual_quote_reserve: 1_000_000,
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
            graduation_threshold: DEFAULT_GRADUATION_THRESHOLD,
            k_constant: 1_000_000_000_000_000,
            migration_quote_threshold: DEFAULT_GRADUATION_THRESHOLD,
            creation_fee_lamports: 0,
            initial_virtual_quote: 1_000_000,
        };
        let serialized = borsh::to_vec(&launch).unwrap();
        assert_eq!(serialized.len(), TokenLaunch::SIZE);
    }

    #[test]
    fn test_k_invariant_preserved_after_buy() {
        let base: u64 = 1_000_000_000; // 1B tokens
        let quote: u64 = 30_000_000;   // 30 MYTH
        let k: u128 = (base as u128) * (quote as u128);

        let (_, new_base, new_quote) = calculate_buy_output(base, quote, k, 5_000_000).unwrap();
        // k should be preserved or slightly larger (due to rounding up)
        assert!((new_base as u128) * (new_quote as u128) >= k);
    }

    #[test]
    fn test_k_invariant_preserved_after_sell() {
        let base: u64 = 900_000_000;
        let quote: u64 = 33_333_334;
        let k: u128 = 30_000_000_000_000_000; // original k

        let (_, new_base, new_quote) = calculate_sell_output(base, quote, k, 50_000_000).unwrap();
        // After sell, new_base * new_quote should be <= k (rounding down quote favors protocol)
        assert!((new_base as u128) * (new_quote as u128) <= k + (new_base as u128));
    }
}
