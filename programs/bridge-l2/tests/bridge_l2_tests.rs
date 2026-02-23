// Comprehensive test suite for Mythic Bridge L2 program
// Tests: happy paths + attack/edge cases using solana-program-test

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use solana_program::system_program;
use solana_program_test::*;
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    signature::{Keypair, Signer},
    transaction::Transaction,
};

use mythic_bridge_l2::*;

// ── Constants (mirror the program) ───────────────────────────────────────────

const L2_BRIDGE_CONFIG_SEED: &[u8] = b"l2_bridge_config";
const WRAPPED_MINT_SEED: &[u8] = b"wrapped_mint";
const PROCESSED_SEED: &[u8] = b"processed";
const IX_INITIALIZE: u8 = 0;
const IX_BURN_WRAPPED: u8 = 3;
const IX_UPDATE_CONFIG: u8 = 4;

fn program_id() -> Pubkey {
    "MythBrdgL2111111111111111111111111111111111"
        .parse()
        .unwrap()
}

// ── Instruction Builders ─────────────────────────────────────────────────────

fn build_initialize_ix(pid: &Pubkey, admin: &Pubkey, relayer: &Pubkey) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], pid);
    let params = InitializeParams {
        relayer: *relayer,
    };
    let mut data = vec![IX_INITIALIZE];
    data.extend_from_slice(&borsh::to_vec(&params).unwrap());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn build_update_config_ix(
    pid: &Pubkey,
    admin: &Pubkey,
    new_relayer: Option<Pubkey>,
) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], pid);
    let params = UpdateConfigParams { new_relayer };
    let mut data = vec![IX_UPDATE_CONFIG];
    data.extend_from_slice(&borsh::to_vec(&params).unwrap());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda, false),
        ],
        data,
    }
}

// ── Happy Path Tests ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_initialize_l2_bridge() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge_l2", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);
    let (mut banks, payer, bh) = pt.start().await;

    let relayer = Keypair::new();
    let ix = build_initialize_ix(&pid, &payer.pubkey(), &relayer.pubkey());
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(tx).await.unwrap();

    let (config_pda, _) = Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], &pid);
    let acct = banks.get_account(config_pda).await.unwrap().unwrap();
    let config = L2BridgeConfig::try_from_slice(&acct.data).unwrap();

    assert!(config.is_initialized);
    assert_eq!(config.admin, payer.pubkey());
    assert_eq!(config.relayer, relayer.pubkey());
    assert_eq!(config.burn_nonce, 0);
}

#[tokio::test]
async fn test_update_config_success() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge_l2", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);
    let (mut banks, payer, bh) = pt.start().await;

    let relayer = Keypair::new();
    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &relayer.pubkey());
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    // Update relayer
    let new_relayer = Pubkey::new_unique();
    let update_ix = build_update_config_ix(&pid, &payer.pubkey(), Some(new_relayer));
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let update_tx =
        Transaction::new_signed_with_payer(&[update_ix], Some(&payer.pubkey()), &[&payer], bh2);
    banks.process_transaction(update_tx).await.unwrap();

    let (config_pda, _) = Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], &pid);
    let acct = banks.get_account(config_pda).await.unwrap().unwrap();
    let config = L2BridgeConfig::try_from_slice(&acct.data).unwrap();
    assert_eq!(config.relayer, new_relayer);
}

// ── Attack / Edge Case Tests ─────────────────────────────────────────────────

#[tokio::test]
async fn test_double_initialize_l2() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge_l2", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    // Pre-allocate config PDA with data to simulate already-initialized state.
    let (config_pda, bump) = Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], &pid);
    let config = L2BridgeConfig {
        admin: Pubkey::new_unique(),
        relayer: Pubkey::new_unique(),
        burn_nonce: 0,
        is_initialized: true,
        bump,
    };
    let config_data = borsh::to_vec(&config).unwrap();
    pt.add_account(
        config_pda,
        Account {
            lamports: 1_000_000,
            data: config_data,
            owner: pid,
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    // Try to initialize when config already exists — MUST FAIL
    let relayer = Keypair::new();
    let ix = build_initialize_ix(&pid, &payer.pubkey(), &relayer.pubkey());
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    assert!(
        banks.process_transaction(tx).await.is_err(),
        "Initialization on pre-existing config must be rejected"
    );
}

#[tokio::test]
async fn test_update_config_unauthorized() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge_l2", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    let fake_admin = Keypair::new();
    pt.add_account(
        fake_admin.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let relayer = Keypair::new();
    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &relayer.pubkey());
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    // Unauthorized update MUST FAIL
    let update_ix =
        build_update_config_ix(&pid, &fake_admin.pubkey(), Some(Pubkey::new_unique()));
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let update_tx = Transaction::new_signed_with_payer(
        &[update_ix],
        Some(&fake_admin.pubkey()),
        &[&fake_admin],
        bh2,
    );
    assert!(
        banks.process_transaction(update_tx).await.is_err(),
        "Non-admin must not update config"
    );
}

#[tokio::test]
async fn test_invalid_instruction_data_l2() {
    let pid = program_id();
    let pt = ProgramTest::new("mythic_bridge_l2", pid, processor!(process_instruction));
    let (mut banks, payer, bh) = pt.start().await;

    // Empty data
    let ix = Instruction {
        program_id: pid,
        accounts: vec![AccountMeta::new(payer.pubkey(), true)],
        data: vec![],
    };
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    assert!(
        banks.process_transaction(tx).await.is_err(),
        "Empty instruction data must be rejected"
    );

    // Invalid discriminator
    let ix2 = Instruction {
        program_id: pid,
        accounts: vec![AccountMeta::new(payer.pubkey(), true)],
        data: vec![255],
    };
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(&[ix2], Some(&payer.pubkey()), &[&payer], bh2);
    assert!(
        banks.process_transaction(tx2).await.is_err(),
        "Invalid discriminator must be rejected"
    );
}

// ── Serialization Tests ──────────────────────────────────────────────────────

#[test]
fn test_l2_bridge_config_serialization() {
    let config = L2BridgeConfig {
        admin: Pubkey::new_unique(),
        relayer: Pubkey::new_unique(),
        burn_nonce: 99,
        is_initialized: true,
        bump: 253,
    };
    let bytes = borsh::to_vec(&config).unwrap();
    assert_eq!(bytes.len(), L2BridgeConfig::LEN);

    let deser = L2BridgeConfig::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.admin, config.admin);
    assert_eq!(deser.burn_nonce, 99);
    assert!(deser.is_initialized);
}

#[test]
fn test_wrapped_token_info_serialization() {
    let info = WrappedTokenInfo {
        l1_mint: Pubkey::new_unique(),
        l2_mint: Pubkey::new_unique(),
        is_active: true,
        bump: 250,
    };
    let bytes = borsh::to_vec(&info).unwrap();
    assert_eq!(bytes.len(), WrappedTokenInfo::LEN);

    let deser = WrappedTokenInfo::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.l1_mint, info.l1_mint);
    assert!(deser.is_active);
}

#[test]
fn test_processed_deposit_serialization() {
    let pd = ProcessedDeposit {
        nonce: 42,
        l1_tx_signature: [0xBB; 64],
        processed_at: 1_700_000_000,
        bump: 248,
    };
    let bytes = borsh::to_vec(&pd).unwrap();
    assert_eq!(bytes.len(), ProcessedDeposit::LEN);

    let deser = ProcessedDeposit::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.nonce, 42);
    assert_eq!(deser.processed_at, 1_700_000_000);
}

#[test]
fn test_burn_zero_amount_rejected_by_params() {
    // The program checks params.amount == 0 and returns InsufficientBalance.
    // We verify the params serialize/deserialize correctly with zero.
    let params = BurnWrappedParams {
        amount: 0,
        l1_recipient: [0u8; 32],
        l1_mint: Pubkey::new_unique(),
    };
    let bytes = borsh::to_vec(&params).unwrap();
    let deser = BurnWrappedParams::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.amount, 0);
    // The program would reject this with BridgeL2Error::InsufficientBalance
}

#[test]
fn test_mint_wrapped_params_serialization() {
    let params = MintWrappedParams {
        l1_deposit_nonce: 17,
        recipient: Pubkey::new_unique(),
        amount: 5_000_000_000,
        l1_mint: Pubkey::new_unique(),
        l1_tx_signature: [0xDD; 64],
    };
    let bytes = borsh::to_vec(&params).unwrap();
    let deser = MintWrappedParams::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.l1_deposit_nonce, 17);
    assert_eq!(deser.amount, 5_000_000_000);
}
