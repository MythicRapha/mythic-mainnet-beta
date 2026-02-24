// mythic-genesis: Generate genesis configuration for Mythic L2
// Usage: mythic-genesis --output-dir ./genesis-output --foundation-pubkey <PUBKEY> --sequencer-pubkey <PUBKEY>

use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

// ── Mythic Program Addresses ────────────────────────────────────────────────

const BRIDGE_PROGRAM: &str = "BE2pz9kxPJLHd65B9tVBuZUwp3y5mKYczb6JLMsyPymA";
const BRIDGE_L2_PROGRAM: &str = "5t8JwXzGQ3c7PCY6p6oJqZgFt8gff2d6uTLrqa1jFrKP";
const AI_PRECOMPILES_PROGRAM: &str = "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ";
const COMPUTE_MARKET_PROGRAM: &str = "AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh";
const SETTLEMENT_PROGRAM: &str = "4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav";
const MYTH_TOKEN_PROGRAM: &str = "7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf";
const LAUNCHPAD_PROGRAM: &str = "62dVNKTPhChmGVzQu7YzK19vVtTk371Zg7iHfNzk635c";

// ── Constants ───────────────────────────────────────────────────────────────

const LAMPORTS_PER_MYTH: u64 = 1_000_000_000; // Same as lamports per SOL
const TOTAL_SUPPLY_MYTH: u64 = 1_000_000_000; // 1 billion MYTH
const DEFAULT_FOUNDATION_BALANCE: u64 = 70_000_000; // 70M MYTH (7%)
const DEFAULT_TARGET_FEE: u64 = 5_000; // lamports per signature
const DEFAULT_EPOCH_LENGTH: u64 = 432_000; // slots per epoch

// ── Config Types ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
struct GenesisConfig {
    cluster_type: String,
    creation_time: u64,
    native_token: NativeTokenConfig,
    inflation: InflationConfig,
    fee_rate_governor: FeeRateGovernor,
    rent: RentConfig,
    epoch_schedule: EpochSchedule,
    poh_config: PohConfig,
    accounts: HashMap<String, GenesisAccount>,
    programs: Vec<GenesisProgram>,
    summary: GenesisSummary,
}

#[derive(Serialize, Deserialize, Debug)]
struct NativeTokenConfig {
    symbol: String,
    name: String,
    total_supply_lamports: u128,
    total_supply_tokens: u64,
    lamports_per_token: u64,
    decimals: u8,
}

#[derive(Serialize, Deserialize, Debug)]
struct InflationConfig {
    initial: f64,
    terminal: f64,
    taper: f64,
    foundation: f64,
    foundation_term: f64,
}

#[derive(Serialize, Deserialize, Debug)]
struct FeeRateGovernor {
    target_lamports_per_signature: u64,
    target_signatures_per_slot: u64,
    min_lamports_per_signature: u64,
    max_lamports_per_signature: u64,
    burn_percent: u8,
}

#[derive(Serialize, Deserialize, Debug)]
struct RentConfig {
    lamports_per_byte_year: u64,
    exemption_threshold: f64,
    burn_percent: u8,
}

#[derive(Serialize, Deserialize, Debug)]
struct EpochSchedule {
    slots_per_epoch: u64,
    leader_schedule_slot_offset: u64,
    warmup: bool,
    first_normal_epoch: u64,
    first_normal_slot: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct PohConfig {
    target_tick_duration_us: u64,
    target_tick_count: Option<u64>,
    hashes_per_tick: Option<u64>,
    ticks_per_slot: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct GenesisAccount {
    balance_lamports: u128,
    balance_tokens: u64,
    owner: String,
    executable: bool,
    data_len: u64,
    role: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct GenesisProgram {
    name: String,
    program_id: String,
    executable: bool,
    description: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct GenesisSummary {
    total_supply: String,
    foundation_allocation: String,
    sequencer_allocation: String,
    reserve_allocation: String,
    inflation: String,
    cluster: String,
    epoch_length: u64,
    programs_registered: usize,
}

// ── CLI Parsing ─────────────────────────────────────────────────────────────

struct CliArgs {
    output_dir: PathBuf,
    foundation_pubkey: Pubkey,
    sequencer_pubkey: Pubkey,
    foundation_balance: u64,
    target_fee: u64,
    epoch_length: u64,
}

fn parse_args() -> Result<CliArgs, String> {
    let args: Vec<String> = std::env::args().collect();

    let mut output_dir: Option<PathBuf> = None;
    let mut foundation_pubkey: Option<Pubkey> = None;
    let mut sequencer_pubkey: Option<Pubkey> = None;
    let mut foundation_balance = DEFAULT_FOUNDATION_BALANCE;
    let mut target_fee = DEFAULT_TARGET_FEE;
    let mut epoch_length = DEFAULT_EPOCH_LENGTH;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--output-dir" => {
                i += 1;
                output_dir = Some(PathBuf::from(
                    args.get(i).ok_or("Missing value for --output-dir")?,
                ));
            }
            "--foundation-pubkey" => {
                i += 1;
                let key_str = args.get(i).ok_or("Missing value for --foundation-pubkey")?;
                foundation_pubkey = Some(
                    Pubkey::from_str(key_str)
                        .map_err(|e| format!("Invalid foundation pubkey: {}", e))?,
                );
            }
            "--sequencer-pubkey" => {
                i += 1;
                let key_str = args.get(i).ok_or("Missing value for --sequencer-pubkey")?;
                sequencer_pubkey = Some(
                    Pubkey::from_str(key_str)
                        .map_err(|e| format!("Invalid sequencer pubkey: {}", e))?,
                );
            }
            "--foundation-balance" => {
                i += 1;
                let val_str = args
                    .get(i)
                    .ok_or("Missing value for --foundation-balance")?;
                foundation_balance = val_str
                    .parse()
                    .map_err(|e| format!("Invalid foundation balance: {}", e))?;
            }
            "--target-fee" => {
                i += 1;
                let val_str = args.get(i).ok_or("Missing value for --target-fee")?;
                target_fee = val_str
                    .parse()
                    .map_err(|e| format!("Invalid target fee: {}", e))?;
            }
            "--epoch-length" => {
                i += 1;
                let val_str = args.get(i).ok_or("Missing value for --epoch-length")?;
                epoch_length = val_str
                    .parse()
                    .map_err(|e| format!("Invalid epoch length: {}", e))?;
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => {
                return Err(format!("Unknown argument: {}", other));
            }
        }
        i += 1;
    }

    Ok(CliArgs {
        output_dir: output_dir.ok_or("--output-dir is required")?,
        foundation_pubkey: foundation_pubkey.ok_or("--foundation-pubkey is required")?,
        sequencer_pubkey: sequencer_pubkey.ok_or("--sequencer-pubkey is required")?,
        foundation_balance,
        target_fee,
        epoch_length,
    })
}

fn print_usage() {
    eprintln!(
        r#"mythic-genesis: Generate genesis configuration for Mythic L2

USAGE:
    mythic-genesis --output-dir <PATH> --foundation-pubkey <BASE58> --sequencer-pubkey <BASE58>

REQUIRED:
    --output-dir <PATH>             Directory to write genesis config files
    --foundation-pubkey <BASE58>    Foundation account public key
    --sequencer-pubkey <BASE58>     Sequencer identity public key

OPTIONAL:
    --foundation-balance <u64>      Foundation balance in MYTH tokens (default: 70000000)
    --target-fee <u64>              Target lamports per signature (default: 5000)
    --epoch-length <u64>            Slots per epoch (default: 432000)
    --help, -h                      Print this help message"#
    );
}

// ── Genesis Builder ─────────────────────────────────────────────────────────

fn build_genesis(args: &CliArgs) -> GenesisConfig {
    let total_supply_lamports = TOTAL_SUPPLY_MYTH as u128 * LAMPORTS_PER_MYTH as u128;
    let foundation_lamports = args.foundation_balance as u128 * LAMPORTS_PER_MYTH as u128;

    // Sequencer gets a small operational balance (1000 MYTH)
    let sequencer_balance_myth: u64 = 1_000;
    let sequencer_lamports = sequencer_balance_myth as u128 * LAMPORTS_PER_MYTH as u128;

    // Remaining goes to the reserve (unallocated in genesis, held by the chain)
    let reserve_lamports = total_supply_lamports - foundation_lamports - sequencer_lamports;
    let reserve_myth = (reserve_lamports / LAMPORTS_PER_MYTH as u128) as u64;

    let mut accounts = HashMap::new();

    // Foundation account
    accounts.insert(
        args.foundation_pubkey.to_string(),
        GenesisAccount {
            balance_lamports: foundation_lamports,
            balance_tokens: args.foundation_balance,
            owner: "11111111111111111111111111111111".to_string(),
            executable: false,
            data_len: 0,
            role: "foundation".to_string(),
        },
    );

    // Sequencer identity account
    accounts.insert(
        args.sequencer_pubkey.to_string(),
        GenesisAccount {
            balance_lamports: sequencer_lamports,
            balance_tokens: sequencer_balance_myth,
            owner: "11111111111111111111111111111111".to_string(),
            executable: false,
            data_len: 0,
            role: "sequencer".to_string(),
        },
    );

    // Reserve account (system-owned, stores unallocated supply)
    // Use a deterministic "reserve" address
    let reserve_key = "MythRsrv11111111111111111111111111111111111";
    accounts.insert(
        reserve_key.to_string(),
        GenesisAccount {
            balance_lamports: reserve_lamports,
            balance_tokens: reserve_myth,
            owner: "11111111111111111111111111111111".to_string(),
            executable: false,
            data_len: 0,
            role: "reserve".to_string(),
        },
    );

    // Register Mythic programs
    let programs = vec![
        GenesisProgram {
            name: "mythic-bridge".to_string(),
            program_id: BRIDGE_PROGRAM.to_string(),
            executable: true,
            description: "L1 bridge: deposits, withdrawals, challenge period".to_string(),
        },
        GenesisProgram {
            name: "mythic-bridge-l2".to_string(),
            program_id: BRIDGE_L2_PROGRAM.to_string(),
            executable: true,
            description: "L2 bridge: mint/burn wrapped assets".to_string(),
        },
        GenesisProgram {
            name: "mythic-ai-precompiles".to_string(),
            program_id: AI_PRECOMPILES_PROGRAM.to_string(),
            executable: true,
            description: "Native AI inference and verification precompiles".to_string(),
        },
        GenesisProgram {
            name: "mythic-compute-market".to_string(),
            program_id: COMPUTE_MARKET_PROGRAM.to_string(),
            executable: true,
            description: "Decentralized compute marketplace (GPU/CPU/storage)".to_string(),
        },
        GenesisProgram {
            name: "mythic-settlement".to_string(),
            program_id: SETTLEMENT_PROGRAM.to_string(),
            executable: true,
            description: "State root settlement to Solana L1".to_string(),
        },
        GenesisProgram {
            name: "mythic-token".to_string(),
            program_id: MYTH_TOKEN_PROGRAM.to_string(),
            executable: true,
            description: "$MYTH token fee distribution and burn logic".to_string(),
        },
    ];

    // Register program accounts as executable in genesis
    for prog in &programs {
        accounts.insert(
            prog.program_id.clone(),
            GenesisAccount {
                balance_lamports: 1,
                balance_tokens: 0,
                owner: "BPFLoaderUpgradeab1e11111111111111111111111".to_string(),
                executable: true,
                data_len: 0, // Program data deployed separately
                role: format!("program:{}", prog.name),
            },
        );
    }

    GenesisConfig {
        cluster_type: "Custom".to_string(),
        creation_time: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        native_token: NativeTokenConfig {
            symbol: "MYTH".to_string(),
            name: "Mythic".to_string(),
            total_supply_lamports,
            total_supply_tokens: TOTAL_SUPPLY_MYTH,
            lamports_per_token: LAMPORTS_PER_MYTH,
            decimals: 9,
        },
        inflation: InflationConfig {
            initial: 0.0,
            terminal: 0.0,
            taper: 0.0,
            foundation: 0.0,
            foundation_term: 0.0,
        },
        fee_rate_governor: FeeRateGovernor {
            target_lamports_per_signature: args.target_fee,
            target_signatures_per_slot: 20_000,
            min_lamports_per_signature: 0,
            max_lamports_per_signature: 0,
            burn_percent: 50,
        },
        rent: RentConfig {
            lamports_per_byte_year: 3_480,
            exemption_threshold: 2.0,
            burn_percent: 50,
        },
        epoch_schedule: EpochSchedule {
            slots_per_epoch: args.epoch_length,
            leader_schedule_slot_offset: args.epoch_length,
            warmup: false,
            first_normal_epoch: 0,
            first_normal_slot: 0,
        },
        poh_config: PohConfig {
            target_tick_duration_us: 6_250, // 160 ticks/sec -> ~400ms slot time
            target_tick_count: None,
            hashes_per_tick: None,
            ticks_per_slot: 64, // Minimal PoH for L2 sequencer
        },
        summary: GenesisSummary {
            total_supply: format!("{} MYTH ({} lamports)", TOTAL_SUPPLY_MYTH, total_supply_lamports),
            foundation_allocation: format!(
                "{} MYTH ({}%)",
                args.foundation_balance,
                (args.foundation_balance as f64 / TOTAL_SUPPLY_MYTH as f64) * 100.0
            ),
            sequencer_allocation: format!("{} MYTH", sequencer_balance_myth),
            reserve_allocation: format!("{} MYTH", reserve_myth),
            inflation: "ZERO (0% initial, 0% terminal)".to_string(),
            cluster: "Custom (Mythic L2)".to_string(),
            epoch_length: args.epoch_length,
            programs_registered: programs.len(),
        },
        programs,
        accounts,
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Error: {}", e);
            eprintln!();
            print_usage();
            std::process::exit(1);
        }
    };

    // Create output directory
    if let Err(e) = fs::create_dir_all(&args.output_dir) {
        eprintln!("Failed to create output directory: {}", e);
        std::process::exit(1);
    }

    let genesis = build_genesis(&args);

    // Write genesis config JSON
    let config_path = args.output_dir.join("genesis-config.json");
    let json = match serde_json::to_string_pretty(&genesis) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("Failed to serialize genesis config: {}", e);
            std::process::exit(1);
        }
    };

    if let Err(e) = fs::write(&config_path, &json) {
        eprintln!("Failed to write genesis config: {}", e);
        std::process::exit(1);
    }

    // Print summary
    println!("=== Mythic L2 Genesis Configuration ===");
    println!();
    println!("Output:              {}", config_path.display());
    println!("Cluster:             {}", genesis.summary.cluster);
    println!("Total Supply:        {}", genesis.summary.total_supply);
    println!(
        "Foundation:          {} ({})",
        args.foundation_pubkey, genesis.summary.foundation_allocation
    );
    println!(
        "Sequencer:           {} ({})",
        args.sequencer_pubkey, genesis.summary.sequencer_allocation
    );
    println!("Reserve:             {}", genesis.summary.reserve_allocation);
    println!("Inflation:           {}", genesis.summary.inflation);
    println!("Epoch Length:        {} slots", genesis.summary.epoch_length);
    println!("Fee Target:          {} lamports/sig", args.target_fee);
    println!(
        "Programs Registered: {}",
        genesis.summary.programs_registered
    );
    println!();

    for prog in &genesis.programs {
        println!("  [{}] {}", prog.program_id, prog.name);
    }

    println!();
    println!("Genesis config written to {}", config_path.display());
}
