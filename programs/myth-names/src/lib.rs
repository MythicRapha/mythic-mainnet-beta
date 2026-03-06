use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
    clock::Clock,
};

solana_program::declare_id!("GCmfmfV8LeVAsWBtHkwGvRU2r2gE37NWnHjMcQFyBV97");

// ── Seeds ──────────────────────────────────────────────────────────────────
const CONFIG_SEED: &[u8] = b"myth_names_config";
const DOMAIN_SEED: &[u8] = b"myth_domain";

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_DOMAIN_LEN: usize = 24;
const MAX_URI_LEN: usize = 128;
const MIN_DOMAIN_LEN: usize = 2;

// ── Errors ─────────────────────────────────────────────────────────────────
#[derive(Debug, thiserror::Error)]
pub enum NamesError {
    #[error("Invalid instruction")]
    InvalidInstruction,
    #[error("Already initialized")]
    AlreadyInitialized,
    #[error("Not initialized")]
    NotInitialized,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Invalid PDA")]
    InvalidPDA,
    #[error("Account not writable")]
    NotWritable,
    #[error("Account not signer")]
    NotSigner,
    #[error("Invalid owner")]
    InvalidOwner,
    #[error("Domain already registered")]
    DomainTaken,
    #[error("Invalid domain name")]
    InvalidDomain,
    #[error("Domain name too short")]
    DomainTooShort,
    #[error("Domain name too long")]
    DomainTooLong,
    #[error("Wallet already has a domain")]
    WalletAlreadyHasDomain,
    #[error("URI too long")]
    UriTooLong,
    #[error("Overflow")]
    Overflow,
}

impl From<NamesError> for ProgramError {
    fn from(e: NamesError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ── State ──────────────────────────────────────────────────────────────────

/// Global registry configuration (singleton PDA)
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RegistryConfig {
    pub is_initialized: bool,       // 1
    pub admin: Pubkey,              // 32
    pub total_registered: u64,      // 8
    pub registration_fee: u64,      // 8  (lamports, 0 = free)
    pub fee_vault: Pubkey,          // 32
    pub paused: bool,               // 1
    pub bump: u8,                   // 1
}

impl RegistryConfig {
    pub const SIZE: usize = 83;
}

/// A registered .myth domain (PDA per domain name)
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct MythDomain {
    pub is_initialized: bool,       // 1
    pub owner: Pubkey,              // 32
    pub domain: [u8; 24],           // 24  (padded domain name, lowercase)
    pub domain_len: u8,             // 1   (actual length of domain string)
    pub metadata_uri: [u8; 128],    // 128 (IPFS URI for pfp / metadata JSON)
    pub uri_len: u8,                // 1
    pub privacy_shield: bool,       // 1
    pub created_slot: u64,          // 8
    pub updated_slot: u64,          // 8
    pub bump: u8,                   // 1
}

impl MythDomain {
    pub const SIZE: usize = 205;

    pub fn domain_str(&self) -> &str {
        core::str::from_utf8(&self.domain[..self.domain_len as usize]).unwrap_or("")
    }

    pub fn uri_str(&self) -> &str {
        core::str::from_utf8(&self.metadata_uri[..self.uri_len as usize]).unwrap_or("")
    }
}

// ── Instruction Args ───────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize)]
pub struct InitializeArgs {
    pub registration_fee: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RegisterDomainArgs {
    pub domain: String,             // the username (without .myth)
    pub metadata_uri: String,       // ipfs://... or https://...
    pub privacy_shield: bool,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdateDomainArgs {
    pub metadata_uri: Option<String>,
    pub privacy_shield: Option<bool>,
}

// ── Entrypoint ─────────────────────────────────────────────────────────────
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
        1 => process_register_domain(program_id, accounts, data),
        2 => process_update_domain(program_id, accounts, data),
        3 => process_transfer_domain(program_id, accounts),
        _ => Err(NamesError::InvalidInstruction.into()),
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(NamesError::NotSigner.into());
    }
    Ok(())
}

fn assert_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(NamesError::NotWritable.into());
    }
    Ok(())
}

fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        return Err(NamesError::InvalidOwner.into());
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

/// Validate domain name: lowercase alphanumeric + underscore/hyphen, 2-24 chars
fn validate_domain(name: &str) -> Result<(), NamesError> {
    if name.len() < MIN_DOMAIN_LEN {
        return Err(NamesError::DomainTooShort);
    }
    if name.len() > MAX_DOMAIN_LEN {
        return Err(NamesError::DomainTooLong);
    }
    for b in name.bytes() {
        match b {
            b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' => {}
            _ => return Err(NamesError::InvalidDomain),
        }
    }
    Ok(())
}

fn pack_domain(name: &str) -> ([u8; 24], u8) {
    let mut buf = [0u8; MAX_DOMAIN_LEN];
    let bytes = name.as_bytes();
    let len = bytes.len().min(MAX_DOMAIN_LEN);
    buf[..len].copy_from_slice(&bytes[..len]);
    (buf, len as u8)
}

fn pack_uri(uri: &str) -> ([u8; 128], u8) {
    let mut buf = [0u8; MAX_URI_LEN];
    let bytes = uri.as_bytes();
    let len = bytes.len().min(MAX_URI_LEN);
    buf[..len].copy_from_slice(&bytes[..len]);
    (buf, len as u8)
}

// ── 0: Initialize ──────────────────────────────────────────────────────────
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
    let system_program = next_account_info(account_iter)?;

    assert_signer(admin)?;
    assert_writable(config_account)?;

    let (config_pda, config_bump) = Pubkey::find_program_address(
        &[CONFIG_SEED],
        program_id,
    );
    if config_account.key != &config_pda {
        return Err(NamesError::InvalidPDA.into());
    }

    // Create config PDA
    create_pda_account(
        admin,
        RegistryConfig::SIZE,
        program_id,
        system_program,
        config_account,
        &[CONFIG_SEED, &[config_bump]],
    )?;

    let config = RegistryConfig {
        is_initialized: true,
        admin: *admin.key,
        total_registered: 0,
        registration_fee: args.registration_fee,
        fee_vault: *admin.key,
        paused: false,
        bump: config_bump,
    };

    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:RegistryInitialized:{{\"admin\":\"{}\",\"fee\":{}}}",
        admin.key,
        args.registration_fee,
    );

    Ok(())
}

// ── 1: Register Domain ─────────────────────────────────────────────────────
fn process_register_domain(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RegisterDomainArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Normalize domain
    let domain = args.domain.to_lowercase();
    let domain = domain.trim_end_matches(".myth");
    validate_domain(domain)?;

    if args.metadata_uri.len() > MAX_URI_LEN {
        return Err(NamesError::UriTooLong.into());
    }

    let account_iter = &mut accounts.iter();
    let owner = next_account_info(account_iter)?;
    let config_account = next_account_info(account_iter)?;
    let domain_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    assert_signer(owner)?;
    assert_writable(config_account)?;
    assert_writable(domain_account)?;
    assert_owned_by(config_account, program_id)?;

    // Validate config
    let mut config = RegistryConfig::try_from_slice(&config_account.data.borrow())?;
    if !config.is_initialized {
        return Err(NamesError::NotInitialized.into());
    }
    if config.paused {
        return Err(ProgramError::Custom(100)); // Paused
    }

    // Validate config PDA
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if config_account.key != &config_pda {
        return Err(NamesError::InvalidPDA.into());
    }

    // Validate domain PDA
    let (domain_pda, domain_bump) = Pubkey::find_program_address(
        &[DOMAIN_SEED, domain.as_bytes()],
        program_id,
    );
    if domain_account.key != &domain_pda {
        return Err(NamesError::InvalidPDA.into());
    }

    // Domain must not already exist
    if domain_account.data_len() > 0 && domain_account.owner == program_id {
        let existing = MythDomain::try_from_slice(&domain_account.data.borrow())?;
        if existing.is_initialized {
            return Err(NamesError::DomainTaken.into());
        }
    }

    // Pay registration fee if > 0
    if config.registration_fee > 0 {
        let fee_vault = next_account_info(account_iter)?;
        if fee_vault.key != &config.fee_vault {
            return Err(NamesError::InvalidPDA.into());
        }

        solana_program::program::invoke(
            &system_instruction::transfer(
                owner.key,
                fee_vault.key,
                config.registration_fee,
            ),
            &[owner.clone(), fee_vault.clone(), system_program.clone()],
        )?;
    }

    // Create domain PDA account
    create_pda_account(
        owner,
        MythDomain::SIZE,
        program_id,
        system_program,
        domain_account,
        &[DOMAIN_SEED, domain.as_bytes(), &[domain_bump]],
    )?;

    let clock = Clock::get()?;
    let (domain_packed, domain_len) = pack_domain(domain);
    let (uri_packed, uri_len) = pack_uri(&args.metadata_uri);

    let myth_domain = MythDomain {
        is_initialized: true,
        owner: *owner.key,
        domain: domain_packed,
        domain_len,
        metadata_uri: uri_packed,
        uri_len,
        privacy_shield: args.privacy_shield,
        created_slot: clock.slot,
        updated_slot: clock.slot,
        bump: domain_bump,
    };

    myth_domain.serialize(&mut &mut domain_account.data.borrow_mut()[..])?;

    // Update counter
    config.total_registered = config
        .total_registered
        .checked_add(1)
        .ok_or(NamesError::Overflow)?;
    config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:DomainRegistered:{{\"domain\":\"{}.myth\",\"owner\":\"{}\",\"slot\":{}}}",
        domain,
        owner.key,
        clock.slot,
    );

    Ok(())
}

// ── 2: Update Domain ────────────────────────────────────────────────────────
fn process_update_domain(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = UpdateDomainArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let account_iter = &mut accounts.iter();
    let owner = next_account_info(account_iter)?;
    let domain_account = next_account_info(account_iter)?;

    assert_signer(owner)?;
    assert_writable(domain_account)?;
    assert_owned_by(domain_account, program_id)?;

    let mut domain = MythDomain::try_from_slice(&domain_account.data.borrow())?;
    if !domain.is_initialized {
        return Err(NamesError::NotInitialized.into());
    }
    if domain.owner != *owner.key {
        return Err(NamesError::Unauthorized.into());
    }

    if let Some(uri) = &args.metadata_uri {
        if uri.len() > MAX_URI_LEN {
            return Err(NamesError::UriTooLong.into());
        }
        let (uri_packed, uri_len) = pack_uri(uri);
        domain.metadata_uri = uri_packed;
        domain.uri_len = uri_len;
    }

    if let Some(shield) = args.privacy_shield {
        domain.privacy_shield = shield;
    }

    let clock = Clock::get()?;
    domain.updated_slot = clock.slot;

    domain.serialize(&mut &mut domain_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:DomainUpdated:{{\"domain\":\"{}.myth\",\"owner\":\"{}\"}}",
        domain.domain_str(),
        owner.key,
    );

    Ok(())
}

// ── 3: Transfer Domain ──────────────────────────────────────────────────────
fn process_transfer_domain(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let current_owner = next_account_info(account_iter)?;
    let new_owner = next_account_info(account_iter)?;
    let domain_account = next_account_info(account_iter)?;

    assert_signer(current_owner)?;
    assert_writable(domain_account)?;
    assert_owned_by(domain_account, program_id)?;

    let mut domain = MythDomain::try_from_slice(&domain_account.data.borrow())?;
    if !domain.is_initialized {
        return Err(NamesError::NotInitialized.into());
    }
    if domain.owner != *current_owner.key {
        return Err(NamesError::Unauthorized.into());
    }

    let clock = Clock::get()?;
    domain.owner = *new_owner.key;
    domain.updated_slot = clock.slot;

    domain.serialize(&mut &mut domain_account.data.borrow_mut()[..])?;

    msg!(
        "EVENT:DomainTransferred:{{\"domain\":\"{}.myth\",\"from\":\"{}\",\"to\":\"{}\"}}",
        domain.domain_str(),
        current_owner.key,
        new_owner.key,
    );

    Ok(())
}
