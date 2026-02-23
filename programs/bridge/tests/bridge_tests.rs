// Comprehensive test suite for Mythic Bridge L1 program
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

// Re-export the crate types (the lib is built as "mythic_bridge")
use mythic_bridge::*;

// ── Constants (mirror the program) ───────────────────────────────────────────

const BRIDGE_CONFIG_SEED: &[u8] = b"bridge_config";
const SOL_VAULT_SEED: &[u8] = b"sol_vault";
const WITHDRAWAL_SEED: &[u8] = b"withdrawal";
const IX_INITIALIZE: u8 = 0;
const IX_DEPOSIT_SOL: u8 = 2;
const IX_INITIATE_WITHDRAWAL: u8 = 3;
const IX_UPDATE_CONFIG: u8 = 6;

fn program_id() -> Pubkey {
    "MythBrdg11111111111111111111111111111111111"
        .parse()
        .unwrap()
}

// ── Instruction Builders ─────────────────────────────────────────────────────

fn build_initialize_ix(
    pid: &Pubkey,
    admin: &Pubkey,
    sequencer: &Pubkey,
    challenge_period: i64,
) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], pid);
    let params = InitializeParams {
        sequencer: *sequencer,
        challenge_period,
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

fn build_deposit_sol_ix(
    pid: &Pubkey,
    depositor: &Pubkey,
    amount: u64,
    l2_recipient: [u8; 32],
) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], pid);
    let (sol_vault, _) = Pubkey::find_program_address(&[SOL_VAULT_SEED], pid);
    let params = DepositSOLParams {
        amount,
        l2_recipient,
    };
    let mut data = vec![IX_DEPOSIT_SOL];
    data.extend_from_slice(&borsh::to_vec(&params).unwrap());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new(*depositor, true),
            AccountMeta::new(sol_vault, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn build_initiate_withdrawal_ix(
    pid: &Pubkey,
    sequencer: &Pubkey,
    payer: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
    token_mint: &Pubkey,
    merkle_proof: [u8; 32],
    nonce: u64,
) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], pid);
    let nonce_bytes = nonce.to_le_bytes();
    let (withdrawal_pda, _) =
        Pubkey::find_program_address(&[WITHDRAWAL_SEED, &nonce_bytes], pid);

    let params = InitiateWithdrawalParams {
        recipient: *recipient,
        amount,
        token_mint: *token_mint,
        merkle_proof,
        nonce,
    };
    let mut data = vec![IX_INITIATE_WITHDRAWAL];
    data.extend_from_slice(&borsh::to_vec(&params).unwrap());

    Instruction {
        program_id: *pid,
        accounts: vec![
            AccountMeta::new_readonly(*sequencer, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn build_update_config_ix(
    pid: &Pubkey,
    admin: &Pubkey,
    new_sequencer: Option<Pubkey>,
    new_challenge_period: Option<i64>,
) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], pid);
    let params = UpdateConfigParams {
        new_sequencer,
        new_challenge_period,
    };
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
async fn test_initialize_bridge() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);
    let (mut banks, payer, bh) = pt.start().await;

    let sequencer = Keypair::new();
    let ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(tx).await.unwrap();

    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], &pid);
    let acct = banks.get_account(config_pda).await.unwrap().unwrap();
    let config = BridgeConfig::try_from_slice(&acct.data).unwrap();

    assert!(config.is_initialized);
    assert_eq!(config.admin, payer.pubkey());
    assert_eq!(config.sequencer, sequencer.pubkey());
    assert_eq!(config.challenge_period, 604_800);
    assert_eq!(config.deposit_nonce, 0);
}

#[tokio::test]
async fn test_lock_sol_success() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    let (sol_vault, _) = Pubkey::find_program_address(&[SOL_VAULT_SEED], &pid);
    pt.add_account(
        sol_vault,
        Account {
            lamports: 1_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let sequencer = Keypair::new();
    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    let deposit_ix = build_deposit_sol_ix(&pid, &payer.pubkey(), 1_000_000_000, [0xAB; 32]);
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let dep_tx =
        Transaction::new_signed_with_payer(&[deposit_ix], Some(&payer.pubkey()), &[&payer], bh2);
    banks.process_transaction(dep_tx).await.unwrap();

    let (config_pda, _) = Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], &pid);
    let acct = banks.get_account(config_pda).await.unwrap().unwrap();
    let config = BridgeConfig::try_from_slice(&acct.data).unwrap();
    assert_eq!(config.deposit_nonce, 1);
}

#[tokio::test]
async fn test_initiate_withdrawal_success() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    let sequencer = Keypair::new();
    pt.add_account(
        sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    let recipient = Pubkey::new_unique();
    let token_mint = Pubkey::new_unique();
    let ix = build_initiate_withdrawal_ix(
        &pid,
        &sequencer.pubkey(),
        &sequencer.pubkey(),
        &recipient,
        5_000_000,
        &token_mint,
        [0xCC; 32],
        0,
    );
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&sequencer.pubkey()),
        &[&sequencer],
        bh2,
    );
    banks.process_transaction(tx).await.unwrap();

    let nonce_bytes = 0u64.to_le_bytes();
    let (withdrawal_pda, _) =
        Pubkey::find_program_address(&[WITHDRAWAL_SEED, &nonce_bytes], &pid);
    let acct = banks.get_account(withdrawal_pda).await.unwrap().unwrap();
    let w = WithdrawalRequest::try_from_slice(&acct.data).unwrap();
    assert_eq!(w.recipient, recipient);
    assert_eq!(w.amount, 5_000_000);
    assert_eq!(w.status, WithdrawalStatus::Pending);
    assert_eq!(w.nonce, 0);
}

// ── Attack / Edge Case Tests ─────────────────────────────────────────────────

#[tokio::test]
async fn test_lock_zero_amount() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    let (sol_vault, _) = Pubkey::find_program_address(&[SOL_VAULT_SEED], &pid);
    pt.add_account(
        sol_vault,
        Account {
            lamports: 1_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let sequencer = Keypair::new();
    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    // Zero deposit MUST FAIL
    let dep_ix = build_deposit_sol_ix(&pid, &payer.pubkey(), 0, [0u8; 32]);
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let dep_tx =
        Transaction::new_signed_with_payer(&[dep_ix], Some(&payer.pubkey()), &[&payer], bh2);
    assert!(
        banks.process_transaction(dep_tx).await.is_err(),
        "Zero deposit must be rejected"
    );
}

#[tokio::test]
async fn test_double_initialize() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    // Pre-allocate the config PDA with data to simulate already-initialized state.
    // The program checks `data_is_empty()` which returns false if the account has data.
    let (config_pda, bump) = Pubkey::find_program_address(&[b"bridge_config"], &pid);
    let config = BridgeConfig {
        admin: Pubkey::new_unique(),
        sequencer: Pubkey::new_unique(),
        challenge_period: 604_800,
        deposit_nonce: 0,
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

    // Try to initialize when config already exists — MUST FAIL (AlreadyInitialized)
    let sequencer = Keypair::new();
    let ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    assert!(
        banks.process_transaction(tx).await.is_err(),
        "Initialization on pre-existing config must be rejected"
    );
}

#[tokio::test]
async fn test_withdrawal_wrong_sequencer() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    let sequencer = Keypair::new();
    let fake_sequencer = Keypair::new();
    pt.add_account(
        fake_sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    // Wrong sequencer MUST FAIL
    let ix = build_initiate_withdrawal_ix(
        &pid,
        &fake_sequencer.pubkey(),
        &fake_sequencer.pubkey(),
        &Pubkey::new_unique(),
        1_000_000,
        &Pubkey::new_unique(),
        [0xCC; 32],
        0,
    );
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&fake_sequencer.pubkey()),
        &[&fake_sequencer],
        bh2,
    );
    assert!(
        banks.process_transaction(tx).await.is_err(),
        "Unauthorized sequencer must not initiate withdrawals"
    );
}

#[tokio::test]
async fn test_replay_withdrawal_nonce() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
    pt.set_compute_max_units(200_000);

    let sequencer = Keypair::new();
    pt.add_account(
        sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let (mut banks, payer, bh) = pt.start().await;

    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    // First withdrawal nonce 0 succeeds
    let ix1 = build_initiate_withdrawal_ix(
        &pid,
        &sequencer.pubkey(),
        &sequencer.pubkey(),
        &Pubkey::new_unique(),
        1_000_000,
        &Pubkey::new_unique(),
        [0xCC; 32],
        0,
    );
    let bh2 = banks.get_latest_blockhash().await.unwrap();
    let tx1 = Transaction::new_signed_with_payer(
        &[ix1],
        Some(&sequencer.pubkey()),
        &[&sequencer],
        bh2,
    );
    banks.process_transaction(tx1).await.unwrap();

    // Replay same nonce MUST FAIL
    let ix2 = build_initiate_withdrawal_ix(
        &pid,
        &sequencer.pubkey(),
        &sequencer.pubkey(),
        &Pubkey::new_unique(),
        1_000_000,
        &Pubkey::new_unique(),
        [0xCC; 32],
        0,
    );
    let bh3 = banks.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix2],
        Some(&sequencer.pubkey()),
        &[&sequencer],
        bh3,
    );
    assert!(
        banks.process_transaction(tx2).await.is_err(),
        "Replay with same nonce must be rejected"
    );
}

#[tokio::test]
async fn test_update_config_wrong_admin() {
    let pid = program_id();
    let mut pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
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

    let sequencer = Keypair::new();
    let init_ix = build_initialize_ix(&pid, &payer.pubkey(), &sequencer.pubkey(), 604_800);
    let init_tx =
        Transaction::new_signed_with_payer(&[init_ix], Some(&payer.pubkey()), &[&payer], bh);
    banks.process_transaction(init_tx).await.unwrap();

    // Wrong admin MUST FAIL
    let update_ix =
        build_update_config_ix(&pid, &fake_admin.pubkey(), Some(Pubkey::new_unique()), None);
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
async fn test_invalid_instruction_data() {
    let pid = program_id();
    let pt = ProgramTest::new("mythic_bridge", pid, processor!(process_instruction));
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
fn test_bridge_config_serialization() {
    let config = BridgeConfig {
        admin: Pubkey::new_unique(),
        sequencer: Pubkey::new_unique(),
        challenge_period: 604_800,
        deposit_nonce: 42,
        is_initialized: true,
        bump: 255,
    };
    let bytes = borsh::to_vec(&config).unwrap();
    assert_eq!(bytes.len(), BridgeConfig::LEN);

    let deser = BridgeConfig::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.admin, config.admin);
    assert_eq!(deser.deposit_nonce, 42);
    assert!(deser.is_initialized);
}

#[test]
fn test_withdrawal_request_serialization() {
    let w = WithdrawalRequest {
        recipient: Pubkey::new_unique(),
        amount: 1_000_000,
        token_mint: Pubkey::new_unique(),
        merkle_proof: [0xAB; 32],
        challenge_deadline: 1_700_000_000,
        status: WithdrawalStatus::Pending,
        nonce: 7,
        bump: 254,
    };
    let bytes = borsh::to_vec(&w).unwrap();
    assert_eq!(bytes.len(), WithdrawalRequest::LEN);

    let deser = WithdrawalRequest::try_from_slice(&bytes).unwrap();
    assert_eq!(deser.amount, 1_000_000);
    assert_eq!(deser.status, WithdrawalStatus::Pending);
}

#[test]
fn test_withdrawal_status_variants() {
    assert_ne!(WithdrawalStatus::Pending, WithdrawalStatus::Challenged);
    assert_ne!(WithdrawalStatus::Challenged, WithdrawalStatus::Finalized);
    assert_ne!(WithdrawalStatus::Finalized, WithdrawalStatus::Cancelled);
}
