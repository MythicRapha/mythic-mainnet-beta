// mythic-relayer: Bridge relayer service for Mythic L2
// Watches L1 deposits and L2 burns, relays between chains.

use borsh::BorshSerialize;
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signer},
    transaction::Transaction,
};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// ── Program Constants ───────────────────────────────────────────────────────

const BRIDGE_CONFIG_SEED: &[u8] = b"bridge_config";
const WITHDRAWAL_SEED: &[u8] = b"withdrawal";
const L2_BRIDGE_CONFIG_SEED: &[u8] = b"l2_bridge_config";
const WRAPPED_MINT_SEED: &[u8] = b"wrapped_mint";
const PROCESSED_SEED: &[u8] = b"processed";

// Instruction discriminators
const IX_INITIATE_WITHDRAWAL: u8 = 3;
const IX_MINT_WRAPPED: u8 = 2;

// ── State Persistence ───────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Default)]
struct RelayerState {
    last_deposit_nonce: u64,
    last_burn_nonce: u64,
    last_deposit_signature: Option<String>,
    last_burn_signature: Option<String>,
}

impl RelayerState {
    fn load(path: &PathBuf) -> Self {
        match fs::read_to_string(path) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    fn save(&self, path: &PathBuf) {
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, json);
        }
    }
}

// ── Event Types ─────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct DepositEvent {
    depositor: String,
    l2_recipient: String,
    amount: u64,
    token_mint: String,
    nonce: u64,
}

#[derive(Deserialize, Debug)]
struct BurnEvent {
    burner: String,
    l1_recipient: String,
    amount: u64,
    l1_mint: String,
    burn_nonce: u64,
}

// ── Config ──────────────────────────────────────────────────────────────────

struct RelayerConfig {
    l1_rpc_url: String,
    l2_rpc_url: String,
    relayer_keypair: Keypair,
    bridge_l1_program: Pubkey,
    bridge_l2_program: Pubkey,
    health_port: u16,
    poll_interval_ms: u64,
    state_file: PathBuf,
}

impl RelayerConfig {
    fn from_env() -> Result<Self, String> {
        let l1_rpc_url =
            std::env::var("L1_RPC_URL").unwrap_or_else(|_| "http://localhost:8899".to_string());
        let l2_rpc_url =
            std::env::var("L2_RPC_URL").unwrap_or_else(|_| "http://localhost:8999".to_string());

        let keypair_path = std::env::var("RELAYER_KEYPAIR_PATH")
            .unwrap_or_else(|_| "relayer-keypair.json".to_string());
        let relayer_keypair = read_keypair_file(&keypair_path)
            .map_err(|e| format!("Failed to read keypair from {}: {}", keypair_path, e))?;

        let bridge_l1_program = Pubkey::from_str(
            &std::env::var("BRIDGE_L1_PROGRAM")
                .unwrap_or_else(|_| "MythBrdg11111111111111111111111111111111111".to_string()),
        )
        .map_err(|e| format!("Invalid BRIDGE_L1_PROGRAM: {}", e))?;

        let bridge_l2_program = Pubkey::from_str(
            &std::env::var("BRIDGE_L2_PROGRAM")
                .unwrap_or_else(|_| "MythBrdgL2111111111111111111111111111111111".to_string()),
        )
        .map_err(|e| format!("Invalid BRIDGE_L2_PROGRAM: {}", e))?;

        let health_port: u16 = std::env::var("HEALTH_PORT")
            .unwrap_or_else(|_| "9090".to_string())
            .parse()
            .map_err(|e| format!("Invalid HEALTH_PORT: {}", e))?;

        let poll_interval_ms: u64 = std::env::var("POLL_INTERVAL_MS")
            .unwrap_or_else(|_| "2000".to_string())
            .parse()
            .map_err(|e| format!("Invalid POLL_INTERVAL_MS: {}", e))?;

        let state_file = PathBuf::from(
            std::env::var("STATE_FILE").unwrap_or_else(|_| "relayer_state.json".to_string()),
        );

        Ok(Self {
            l1_rpc_url,
            l2_rpc_url,
            relayer_keypair,
            bridge_l1_program,
            bridge_l2_program,
            health_port,
            poll_interval_ms,
            state_file,
        })
    }
}

// ── Instruction Builders ────────────────────────────────────────────────────

#[derive(BorshSerialize)]
struct MintWrappedParams {
    l1_deposit_nonce: u64,
    recipient: Pubkey,
    amount: u64,
    l1_mint: Pubkey,
    l1_tx_signature: [u8; 64],
}

#[derive(BorshSerialize)]
struct InitiateWithdrawalParams {
    recipient: Pubkey,
    amount: u64,
    token_mint: Pubkey,
    merkle_proof: [u8; 32],
    nonce: u64,
}

fn build_mint_wrapped_ix(
    bridge_l2_program: &Pubkey,
    relayer: &Pubkey,
    l2_recipient: &Pubkey,
    amount: u64,
    l1_token_mint: &Pubkey,
    deposit_nonce: u64,
    l1_tx_signature: &[u8; 64],
) -> Instruction {
    let (config_pda, _) =
        Pubkey::find_program_address(&[L2_BRIDGE_CONFIG_SEED], bridge_l2_program);
    let (wrapped_info_pda, _) = Pubkey::find_program_address(
        &[WRAPPED_MINT_SEED, l1_token_mint.as_ref()],
        bridge_l2_program,
    );
    let mint_seed: &[u8] = b"mint";
    let (l2_mint_pda, _) = Pubkey::find_program_address(
        &[mint_seed, l1_token_mint.as_ref()],
        bridge_l2_program,
    );
    let nonce_bytes = deposit_nonce.to_le_bytes();
    let (processed_pda, _) = Pubkey::find_program_address(
        &[PROCESSED_SEED, &nonce_bytes],
        bridge_l2_program,
    );

    // Derive the recipient's associated token account for the wrapped mint
    let recipient_token =
        spl_associated_token_account::get_associated_token_address(l2_recipient, &l2_mint_pda);

    let mut data = vec![IX_MINT_WRAPPED];
    let params = MintWrappedParams {
        l1_deposit_nonce: deposit_nonce,
        recipient: *l2_recipient,
        amount,
        l1_mint: *l1_token_mint,
        l1_tx_signature: *l1_tx_signature,
    };
    params.serialize(&mut data).unwrap();

    // Account order must match process_mint_wrapped in bridge-l2:
    //   0. [signer]          relayer
    //   1. [signer, writable] payer
    //   2. []                 l2_bridge_config PDA
    //   3. []                 wrapped_token_info PDA
    //   4. [writable]         l2_mint account
    //   5. [writable]         recipient token account (ATA)
    //   6. [writable]         processed_deposit PDA
    //   7. []                 token_program
    //   8. []                 system_program
    Instruction {
        program_id: *bridge_l2_program,
        accounts: vec![
            AccountMeta::new_readonly(*relayer, true),           // 0. relayer (signer)
            AccountMeta::new(*relayer, true),                    // 1. payer (signer, writable)
            AccountMeta::new_readonly(config_pda, false),        // 2. l2_bridge_config PDA
            AccountMeta::new_readonly(wrapped_info_pda, false),  // 3. wrapped_token_info PDA
            AccountMeta::new(l2_mint_pda, false),                // 4. l2_mint (writable)
            AccountMeta::new(recipient_token, false),            // 5. recipient token account (writable)
            AccountMeta::new(processed_pda, false),              // 6. processed_deposit PDA (writable)
            AccountMeta::new_readonly(spl_token::id(), false),   // 7. token_program
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false), // 8. system_program
        ],
        data,
    }
}

fn build_initiate_withdrawal_ix(
    bridge_l1_program: &Pubkey,
    relayer: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
    token_mint: &Pubkey,
    nonce: u64,
) -> Instruction {
    let (config_pda, _) =
        Pubkey::find_program_address(&[BRIDGE_CONFIG_SEED], bridge_l1_program);
    let nonce_bytes = nonce.to_le_bytes();
    let (withdrawal_pda, _) =
        Pubkey::find_program_address(&[WITHDRAWAL_SEED, &nonce_bytes], bridge_l1_program);

    let mut data = vec![IX_INITIATE_WITHDRAWAL];
    let params = InitiateWithdrawalParams {
        recipient: *recipient,
        amount,
        token_mint: *token_mint,
        merkle_proof: [0u8; 32], // Placeholder — real proof computed off-chain
        nonce,
    };
    params.serialize(&mut data).unwrap();

    // Account order must match process_initiate_withdrawal in bridge (L1):
    //   0. [signer]           sequencer
    //   1. [signer, writable] payer
    //   2. [writable]         withdrawal_request PDA
    //   3. []                 bridge_config PDA
    //   4. []                 system_program
    Instruction {
        program_id: *bridge_l1_program,
        accounts: vec![
            AccountMeta::new_readonly(*relayer, true),  // 0. sequencer (signer)
            AccountMeta::new(*relayer, true),            // 1. payer (signer, writable)
            AccountMeta::new(withdrawal_pda, false),     // 2. withdrawal PDA (writable)
            AccountMeta::new_readonly(config_pda, false),// 3. bridge config
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false), // 4. system_program
        ],
        data,
    }
}

// ── Log Parser ──────────────────────────────────────────────────────────────

fn parse_deposit_events(logs: &[String]) -> Vec<DepositEvent> {
    let mut events = Vec::new();
    for log in logs {
        // Match both SPL token deposits and SOL deposits
        if let Some(json_str) = log
            .strip_prefix("Program log: EVENT:Deposit:")
            .or_else(|| log.strip_prefix("Program log: EVENT:DepositSOL:"))
        {
            if let Ok(event) = serde_json::from_str::<DepositEvent>(json_str) {
                events.push(event);
            }
        }
    }
    events
}

fn parse_burn_events(logs: &[String]) -> Vec<BurnEvent> {
    let mut events = Vec::new();
    for log in logs {
        if let Some(json_str) = log.strip_prefix("Program log: EVENT:BurnWrapped:") {
            if let Ok(event) = serde_json::from_str::<BurnEvent>(json_str) {
                events.push(event);
            }
        }
    }
    events
}

// ── Retry Logic ─────────────────────────────────────────────────────────────

fn retry_with_backoff<F, T>(mut f: F, max_retries: u32) -> Result<T, String>
where
    F: FnMut() -> Result<T, String>,
{
    let mut delay_ms = 1000u64;
    for attempt in 0..max_retries {
        match f() {
            Ok(val) => return Ok(val),
            Err(e) => {
                if attempt == max_retries - 1 {
                    return Err(format!("Failed after {} retries: {}", max_retries, e));
                }
                eprintln!(
                    "[RETRY] Attempt {}/{} failed: {}. Retrying in {}ms...",
                    attempt + 1,
                    max_retries,
                    e,
                    delay_ms
                );
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                delay_ms = (delay_ms * 2).min(60_000);
            }
        }
    }
    Err("Retry exhausted".to_string())
}

// ── Health Check Server ─────────────────────────────────────────────────────

fn start_health_server(port: u16, running: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let addr = format!("0.0.0.0:{}", port);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[HEALTH] Failed to bind {}: {}", addr, e);
                return;
            }
        };
        listener
            .set_nonblocking(true)
            .expect("Cannot set non-blocking");
        println!("[HEALTH] Listening on {}", addr);

        while running.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK";
                    let _ = stream.write_all(response.as_bytes());
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(e) => {
                    eprintln!("[HEALTH] Accept error: {}", e);
                }
            }
        }
    });
}

// ── Main Loop ───────────────────────────────────────────────────────────────

fn run_relayer(config: RelayerConfig) {
    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();

    // Install signal handler for graceful shutdown
    ctrlc_handler(r);

    let l1_client = RpcClient::new_with_commitment(
        config.l1_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let l2_client = RpcClient::new_with_commitment(
        config.l2_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );

    let mut state = RelayerState::load(&config.state_file);

    println!("=== Mythic L2 Bridge Relayer ===");
    println!("L1 RPC:          {}", config.l1_rpc_url);
    println!("L2 RPC:          {}", config.l2_rpc_url);
    println!("Bridge L1:       {}", config.bridge_l1_program);
    println!("Bridge L2:       {}", config.bridge_l2_program);
    println!("Relayer:         {}", config.relayer_keypair.pubkey());
    println!("Health Port:     {}", config.health_port);
    println!("Poll Interval:   {}ms", config.poll_interval_ms);
    println!(
        "Last Deposit:    nonce={}",
        state.last_deposit_nonce
    );
    println!(
        "Last Burn:       nonce={}",
        state.last_burn_nonce
    );
    println!();

    start_health_server(config.health_port, running.clone());

    while running.load(Ordering::Relaxed) {
        // ── Watch L1 Deposits ───────────────────────────────────────────
        match poll_l1_deposits(
            &l1_client,
            &l2_client,
            &config,
            &mut state,
        ) {
            Ok(count) => {
                if count > 0 {
                    println!("[DEPOSIT] Relayed {} deposits", count);
                    state.save(&config.state_file);
                }
            }
            Err(e) => {
                eprintln!("[DEPOSIT] Error polling L1: {}", e);
            }
        }

        // ── Watch L2 Burns ──────────────────────────────────────────────
        match poll_l2_burns(
            &l1_client,
            &l2_client,
            &config,
            &mut state,
        ) {
            Ok(count) => {
                if count > 0 {
                    println!("[BURN] Relayed {} burns", count);
                    state.save(&config.state_file);
                }
            }
            Err(e) => {
                eprintln!("[BURN] Error polling L2: {}", e);
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(config.poll_interval_ms));
    }

    println!("[SHUTDOWN] Saving state...");
    state.save(&config.state_file);
    println!("[SHUTDOWN] Relayer stopped.");
}

fn poll_l1_deposits(
    l1_client: &RpcClient,
    l2_client: &RpcClient,
    config: &RelayerConfig,
    state: &mut RelayerState,
) -> Result<u64, String> {
    // Get recent transaction signatures for the bridge program
    let sigs = l1_client
        .get_signatures_for_address(&config.bridge_l1_program)
        .map_err(|e| format!("Failed to get L1 signatures: {}", e))?;

    let mut relayed = 0u64;

    for sig_info in &sigs {
        if sig_info.err.is_some() {
            continue;
        }

        let sig = sig_info
            .signature
            .parse()
            .map_err(|e| format!("Invalid signature: {}", e))?;

        // Skip already-processed signatures
        if let Some(ref last_sig) = state.last_deposit_signature {
            if &sig_info.signature == last_sig {
                break;
            }
        }

        let tx = match l1_client.get_transaction_with_config(
            &sig,
            solana_client::rpc_config::RpcTransactionConfig {
                encoding: Some(solana_transaction_status::UiTransactionEncoding::Json),
                commitment: Some(CommitmentConfig::confirmed()),
                max_supported_transaction_version: Some(0),
            },
        ) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let logs = match &tx.transaction.meta {
            Some(meta) => match &meta.log_messages {
                solana_transaction_status::option_serializer::OptionSerializer::Some(logs) => {
                    logs.clone()
                }
                _ => continue,
            },
            None => continue,
        };

        let events = parse_deposit_events(&logs);
        for event in events {
            if event.nonce <= state.last_deposit_nonce {
                continue;
            }

            // Parse the L2 recipient from hex
            let l2_recipient = match hex_to_pubkey(&event.l2_recipient) {
                Some(pk) => pk,
                None => {
                    eprintln!(
                        "[DEPOSIT] Invalid l2_recipient hex: {}",
                        event.l2_recipient
                    );
                    continue;
                }
            };

            let l1_token_mint = Pubkey::from_str(&event.token_mint)
                .unwrap_or(solana_sdk::system_program::id());

            // Convert the L1 transaction signature to a 64-byte array
            let l1_tx_sig_bytes: [u8; 64] = sig.as_ref().try_into().unwrap_or([0u8; 64]);

            let ix = build_mint_wrapped_ix(
                &config.bridge_l2_program,
                &config.relayer_keypair.pubkey(),
                &l2_recipient,
                event.amount,
                &l1_token_mint,
                event.nonce,
                &l1_tx_sig_bytes,
            );

            let result = retry_with_backoff(
                || {
                    let recent_hash = l2_client
                        .get_latest_blockhash()
                        .map_err(|e| format!("L2 blockhash: {}", e))?;
                    let tx = Transaction::new_signed_with_payer(
                        &[ix.clone()],
                        Some(&config.relayer_keypair.pubkey()),
                        &[&config.relayer_keypair],
                        recent_hash,
                    );
                    l2_client
                        .send_and_confirm_transaction(&tx)
                        .map_err(|e| format!("L2 tx: {}", e))
                },
                5,
            );

            match result {
                Ok(tx_sig) => {
                    println!(
                        "RELAYED DEPOSIT: nonce={} amount={} recipient={} tx={}",
                        event.nonce, event.amount, l2_recipient, tx_sig
                    );
                    state.last_deposit_nonce = event.nonce;
                    relayed += 1;
                }
                Err(e) => {
                    eprintln!(
                        "[DEPOSIT] Failed to relay nonce={}: {}",
                        event.nonce, e
                    );
                }
            }
        }

        // Track the latest signature we've seen
        state.last_deposit_signature = Some(sig_info.signature.clone());
    }

    Ok(relayed)
}

fn poll_l2_burns(
    l1_client: &RpcClient,
    l2_client: &RpcClient,
    config: &RelayerConfig,
    state: &mut RelayerState,
) -> Result<u64, String> {
    let sigs = l2_client
        .get_signatures_for_address(&config.bridge_l2_program)
        .map_err(|e| format!("Failed to get L2 signatures: {}", e))?;

    let mut relayed = 0u64;

    for sig_info in &sigs {
        if sig_info.err.is_some() {
            continue;
        }

        let sig = sig_info
            .signature
            .parse()
            .map_err(|e| format!("Invalid signature: {}", e))?;

        if let Some(ref last_sig) = state.last_burn_signature {
            if &sig_info.signature == last_sig {
                break;
            }
        }

        let tx = match l2_client.get_transaction_with_config(
            &sig,
            solana_client::rpc_config::RpcTransactionConfig {
                encoding: Some(solana_transaction_status::UiTransactionEncoding::Json),
                commitment: Some(CommitmentConfig::confirmed()),
                max_supported_transaction_version: Some(0),
            },
        ) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let logs = match &tx.transaction.meta {
            Some(meta) => match &meta.log_messages {
                solana_transaction_status::option_serializer::OptionSerializer::Some(logs) => {
                    logs.clone()
                }
                _ => continue,
            },
            None => continue,
        };

        let events = parse_burn_events(&logs);
        for event in events {
            if event.burn_nonce <= state.last_burn_nonce {
                continue;
            }

            // l1_recipient is emitted as hex-encoded bytes by the L2 bridge
            let l1_recipient = match hex_to_pubkey(&event.l1_recipient) {
                Some(pk) => pk,
                None => {
                    eprintln!(
                        "[BURN] Invalid l1_recipient hex: {}",
                        event.l1_recipient
                    );
                    continue;
                }
            };

            let l1_token_mint = Pubkey::from_str(&event.l1_mint)
                .unwrap_or(solana_sdk::system_program::id());

            let ix = build_initiate_withdrawal_ix(
                &config.bridge_l1_program,
                &config.relayer_keypair.pubkey(),
                &l1_recipient,
                event.amount,
                &l1_token_mint,
                event.burn_nonce,
            );

            let result = retry_with_backoff(
                || {
                    let recent_hash = l1_client
                        .get_latest_blockhash()
                        .map_err(|e| format!("L1 blockhash: {}", e))?;
                    let tx = Transaction::new_signed_with_payer(
                        &[ix.clone()],
                        Some(&config.relayer_keypair.pubkey()),
                        &[&config.relayer_keypair],
                        recent_hash,
                    );
                    l1_client
                        .send_and_confirm_transaction(&tx)
                        .map_err(|e| format!("L1 tx: {}", e))
                },
                5,
            );

            match result {
                Ok(tx_sig) => {
                    println!(
                        "RELAYED BURN: nonce={} amount={} l1_recipient={} tx={}",
                        event.burn_nonce, event.amount, l1_recipient, tx_sig
                    );
                    state.last_burn_nonce = event.burn_nonce;
                    relayed += 1;
                }
                Err(e) => {
                    eprintln!(
                        "[BURN] Failed to relay nonce={}: {}",
                        event.burn_nonce, e
                    );
                }
            }
        }

        state.last_burn_signature = Some(sig_info.signature.clone());
    }

    Ok(relayed)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn hex_to_pubkey(hex_str: &str) -> Option<Pubkey> {
    if hex_str.len() != 64 {
        return None;
    }
    let mut bytes = [0u8; 32];
    for i in 0..32 {
        bytes[i] = u8::from_str_radix(&hex_str[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(Pubkey::new_from_array(bytes))
}

fn ctrlc_handler(running: Arc<AtomicBool>) {
    // Simple signal handling via polling — no external crate needed
    // The running flag is checked in the main loop
    std::thread::spawn(move || {
        // Block on reading a line from stdin as a rudimentary "press enter to stop"
        // In production, use the tokio signal handler. For now, rely on the OS
        // sending SIGTERM which will terminate the process. The AtomicBool is
        // primarily for the health server thread coordination.
        let _buf = [0u8; 1];
        // This thread just keeps running; SIGTERM/SIGINT will kill the process
        // and the main loop periodically saves state anyway.
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            if !running.load(Ordering::Relaxed) {
                break;
            }
        }
    });
}

// ── Main ────────────────────────────────────────────────────────────────────

fn main() {
    println!("Mythic L2 Bridge Relayer v0.1.0");

    let config = match RelayerConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Configuration error: {}", e);
            eprintln!();
            eprintln!("Required environment variables:");
            eprintln!("  RELAYER_KEYPAIR_PATH  Path to relayer keypair JSON file");
            eprintln!();
            eprintln!("Optional environment variables:");
            eprintln!("  L1_RPC_URL            Solana L1 RPC URL (default: http://localhost:8899)");
            eprintln!("  L2_RPC_URL            Mythic L2 RPC URL (default: http://localhost:8999)");
            eprintln!("  BRIDGE_L1_PROGRAM     L1 bridge program ID");
            eprintln!("  BRIDGE_L2_PROGRAM     L2 bridge program ID");
            eprintln!("  HEALTH_PORT           Health check port (default: 9090)");
            eprintln!("  POLL_INTERVAL_MS      Polling interval in ms (default: 2000)");
            eprintln!("  STATE_FILE            State file path (default: relayer_state.json)");
            std::process::exit(1);
        }
    };

    run_relayer(config);
}
