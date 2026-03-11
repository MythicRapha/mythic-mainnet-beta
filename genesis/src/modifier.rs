// genesis-modifier: Inject programs and accounts into fddev genesis.bin
//
// Supports:
//   --bpf-program ADDRESS SO_PATH                        Non-upgradeable BPF program
//   --upgradeable-program ADDRESS SO_PATH AUTHORITY       Upgradeable BPF program (2 accounts)
//   --native-program NAME ADDRESS                         Native instruction processor
//   --account ADDRESS JSON_PATH                           Raw account from JSON
//   --dump                                                Dump existing accounts/programs
//
// Upgradeable programs create:
//   1. Program account (vanity address) -> 36 bytes, points to programdata PDA
//   2. ProgramData account (PDA) -> 45 byte header + ELF binary
//
// Native programs register builtins like stake, vote, system, etc.
// Common native programs:
//   solana_stake_program          Stake11111111111111111111111111111111111111
//   solana_vote_program           Vote111111111111111111111111111111111111111
//   solana_system_program         11111111111111111111111111111111
//   solana_config_program         Config1111111111111111111111111111111111111

use base64::Engine;
use solana_sdk::{
    account::{Account, AccountSharedData, WritableAccount},
    bpf_loader,
    bpf_loader_upgradeable,
    genesis_config::GenesisConfig,
    pubkey::Pubkey,
};
use serde::Deserialize;
use std::fs;
use std::str::FromStr;

#[derive(Deserialize)]
struct AccountJson {
    #[allow(dead_code)]
    pubkey: String,
    account: AccountData,
}

#[derive(Deserialize)]
struct AccountData {
    lamports: u64,
    data: (String, String),
    owner: String,
    executable: bool,
}

/// Serialize UpgradeableLoaderState::Program { programdata_address }
/// Layout: u32 variant (2) + 32 bytes programdata_address = 36 bytes
fn serialize_program_state(programdata_address: &Pubkey) -> Vec<u8> {
    let mut data = Vec::with_capacity(36);
    data.extend_from_slice(&2u32.to_le_bytes());
    data.extend_from_slice(programdata_address.as_ref());
    data
}

/// Serialize UpgradeableLoaderState::ProgramData { slot, upgrade_authority_address }
/// Layout: u32 variant (3) + u64 slot + u8 option (1=Some) + 32 bytes authority + ELF
fn serialize_programdata_state(slot: u64, authority: &Pubkey, elf: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(45 + elf.len());
    data.extend_from_slice(&3u32.to_le_bytes());
    data.extend_from_slice(&slot.to_le_bytes());
    data.push(1u8); // Some(authority)
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(elf);
    data
}

fn print_usage() {
    eprintln!("genesis-modifier: Inject programs and accounts into fddev genesis.bin");
    eprintln!();
    eprintln!("USAGE:");
    eprintln!("  genesis-modifier <genesis.bin> [OPTIONS]...");
    eprintln!();
    eprintln!("OPTIONS:");
    eprintln!("  --bpf-program ADDRESS SO_PATH");
    eprintln!("      Add non-upgradeable BPF program");
    eprintln!();
    eprintln!("  --upgradeable-program ADDRESS SO_PATH AUTHORITY");
    eprintln!("      Add upgradeable BPF program with upgrade authority");
    eprintln!("      Creates program account + programdata PDA");
    eprintln!();
    eprintln!("  --native-program NAME ADDRESS");
    eprintln!("      Register native instruction processor");
    eprintln!("      Example: --native-program solana_stake_program Stake11111111111111111111111111111111111111");
    eprintln!();
    eprintln!("  --account ADDRESS JSON_PATH");
    eprintln!("      Add raw account from solana account JSON dump");
    eprintln!();
    eprintln!("  --dump");
    eprintln!("      Dump existing genesis accounts and native programs");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let genesis_path = &args[1];
    let dump_mode = args.iter().any(|a| a == "--dump");

    println!("Reading genesis from: {}", genesis_path);
    let genesis_data = fs::read(genesis_path).expect("Failed to read genesis.bin");
    let mut genesis: GenesisConfig =
        bincode::deserialize(&genesis_data).expect("Failed to deserialize genesis");

    println!(
        "Genesis has {} accounts, {} native programs",
        genesis.accounts.len(),
        genesis.native_instruction_processors.len()
    );

    if dump_mode {
        println!("\n=== Native Instruction Processors ===");
        for (name, pubkey) in &genesis.native_instruction_processors {
            println!("  {} -> {}", name, pubkey);
        }
        println!("\n=== Executable Accounts ===");
        for (pubkey, account) in &genesis.accounts {
            if account.executable {
                println!(
                    "  {} owner={} data_len={}",
                    pubkey,
                    account.owner,
                    account.data.len()
                );
            }
        }
        println!("\n=== Large Data Accounts (>100 bytes) ===");
        for (pubkey, account) in &genesis.accounts {
            if !account.executable && account.data.len() > 100 {
                println!(
                    "  {} owner={} data_len={} lamports={}",
                    pubkey,
                    account.owner,
                    account.data.len(),
                    account.lamports
                );
            }
        }
        return;
    }

    let mut i = 2;
    let mut bpf_added = 0;
    let mut upgradeable_added = 0;
    let mut native_added = 0;
    let mut accounts_added = 0;
    let mut need_bpf_loader = false;
    let mut need_upgradeable_loader = false;

    while i < args.len() {
        match args[i].as_str() {
            "--bpf-program" if i + 2 < args.len() => {
                let address =
                    Pubkey::from_str(&args[i + 1]).unwrap_or_else(|_| panic!("Invalid pubkey: {}", args[i + 1]));
                let so_path = &args[i + 2];

                let program_data =
                    fs::read(so_path).unwrap_or_else(|_| panic!("Failed to read: {}", so_path));
                let data_len = program_data.len();
                let lamports = genesis.rent.minimum_balance(data_len);

                let mut account = AccountSharedData::new(lamports, data_len, &bpf_loader::id());
                account.set_data_from_slice(&program_data);
                account.set_executable(true);

                genesis
                    .accounts
                    .insert(address, Account::from(account));
                bpf_added += 1;
                need_bpf_loader = true;
                println!("Added BPF program: {} ({} bytes)", address, data_len);

                i += 3;
            }

            "--upgradeable-program" if i + 3 < args.len() => {
                let program_id =
                    Pubkey::from_str(&args[i + 1]).unwrap_or_else(|_| panic!("Invalid pubkey: {}", args[i + 1]));
                let so_path = &args[i + 2];
                let authority =
                    Pubkey::from_str(&args[i + 3]).unwrap_or_else(|_| panic!("Invalid authority: {}", args[i + 3]));

                let elf_data =
                    fs::read(so_path).unwrap_or_else(|_| panic!("Failed to read: {}", so_path));

                // Derive programdata PDA
                let (programdata_address, _bump) = Pubkey::find_program_address(
                    &[program_id.as_ref()],
                    &bpf_loader_upgradeable::id(),
                );

                // 1. Program account (36 bytes — pointer to programdata)
                let program_state = serialize_program_state(&programdata_address);
                let program_lamports = genesis.rent.minimum_balance(program_state.len());
                let mut program_account = AccountSharedData::new(
                    program_lamports,
                    program_state.len(),
                    &bpf_loader_upgradeable::id(),
                );
                program_account.set_data_from_slice(&program_state);
                program_account.set_executable(true);

                genesis
                    .accounts
                    .insert(program_id, Account::from(program_account));

                // 2. ProgramData account (45 byte header + ELF)
                let programdata_state = serialize_programdata_state(0, &authority, &elf_data);
                let programdata_lamports = genesis.rent.minimum_balance(programdata_state.len());
                let mut programdata_account = AccountSharedData::new(
                    programdata_lamports,
                    programdata_state.len(),
                    &bpf_loader_upgradeable::id(),
                );
                programdata_account.set_data_from_slice(&programdata_state);
                // programdata is NOT executable

                genesis
                    .accounts
                    .insert(programdata_address, Account::from(programdata_account));

                upgradeable_added += 1;
                need_upgradeable_loader = true;
                println!(
                    "Added upgradeable program: {} -> programdata: {} (authority: {}, {} bytes ELF)",
                    program_id,
                    programdata_address,
                    authority,
                    elf_data.len()
                );

                i += 4;
            }

            "--native-program" if i + 2 < args.len() => {
                let name = &args[i + 1];
                let address =
                    Pubkey::from_str(&args[i + 2]).unwrap_or_else(|_| panic!("Invalid pubkey: {}", args[i + 2]));

                let already = genesis
                    .native_instruction_processors
                    .iter()
                    .any(|(_, pk)| *pk == address);

                if already {
                    println!("Native program already registered: {} -> {}", name, address);
                } else {
                    genesis
                        .native_instruction_processors
                        .push((name.to_string(), address));
                    native_added += 1;
                    println!("Registered native program: {} -> {}", name, address);
                }

                i += 3;
            }

            "--account" if i + 2 < args.len() => {
                let address =
                    Pubkey::from_str(&args[i + 1]).unwrap_or_else(|_| panic!("Invalid pubkey: {}", args[i + 1]));
                let json_path = &args[i + 2];

                let json_str =
                    fs::read_to_string(json_path).unwrap_or_else(|_| panic!("Failed to read: {}", json_path));
                let acct_json: AccountJson = serde_json::from_str(&json_str)
                    .unwrap_or_else(|_| panic!("Failed to parse JSON: {}", json_path));

                let owner = Pubkey::from_str(&acct_json.account.owner)
                    .unwrap_or_else(|_| panic!("Invalid owner: {}", acct_json.account.owner));
                let data = base64::engine::general_purpose::STANDARD
                    .decode(&acct_json.account.data.0)
                    .unwrap_or_else(|_| panic!("Failed to decode base64 for: {}", address));

                let mut account =
                    AccountSharedData::new(acct_json.account.lamports, data.len(), &owner);
                account.set_data_from_slice(&data);
                if acct_json.account.executable {
                    account.set_executable(true);
                }

                genesis
                    .accounts
                    .insert(address, Account::from(account));
                accounts_added += 1;
                println!("Added account: {} ({} bytes)", address, data.len());

                i += 3;
            }

            "--dump" => {
                i += 1; // already handled above
            }

            other => {
                eprintln!("Unknown argument: {}", other);
                print_usage();
                std::process::exit(1);
            }
        }
    }

    if bpf_added == 0 && upgradeable_added == 0 && native_added == 0 && accounts_added == 0 {
        println!("No programs or accounts to add.");
        return;
    }

    // Auto-register BPF loader if we added non-upgradeable programs
    if need_bpf_loader {
        let bpf_id = bpf_loader::id();
        let already = genesis
            .native_instruction_processors
            .iter()
            .any(|(_, pk)| *pk == bpf_id);
        if !already {
            genesis
                .native_instruction_processors
                .push(("solana_bpf_loader_program".to_string(), bpf_id));
            println!(
                "Auto-registered native: solana_bpf_loader_program -> {}",
                bpf_id
            );
        }
    }

    // Auto-register upgradeable BPF loader if we added upgradeable programs
    if need_upgradeable_loader {
        let upgradeable_id = bpf_loader_upgradeable::id();
        let already = genesis
            .native_instruction_processors
            .iter()
            .any(|(_, pk)| *pk == upgradeable_id);
        if !already {
            genesis.native_instruction_processors.push((
                "solana_bpf_loader_upgradeable_program".to_string(),
                upgradeable_id,
            ));
            println!(
                "Auto-registered native: solana_bpf_loader_upgradeable_program -> {}",
                upgradeable_id
            );
        }
    }

    println!(
        "\nGenesis: {} accounts ({} bpf, {} upgradeable, {} native, {} raw)",
        genesis.accounts.len(),
        bpf_added,
        upgradeable_added,
        native_added,
        accounts_added
    );
    println!(
        "Native processors: {}",
        genesis.native_instruction_processors.len()
    );

    let output = bincode::serialize(&genesis).expect("Failed to serialize genesis");
    println!(
        "Size: {} -> {} bytes",
        genesis_data.len(),
        output.len()
    );
    fs::write(genesis_path, &output).expect("Failed to write genesis.bin");

    println!("Done! Genesis saved to {}", genesis_path);
}
