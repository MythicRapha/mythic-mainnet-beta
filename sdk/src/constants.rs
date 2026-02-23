//! Mythic L2 program IDs, PDA seeds, fee parameters, and default config values.

use solana_program::pubkey::Pubkey;

// ── Program IDs ─────────────────────────────────────────────────────────────

/// L1 Bridge program — handles deposits, withdrawals, and challenge periods on Solana mainnet.
pub const BRIDGE_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("MythBrdg11111111111111111111111111111111111");

/// L2 Bridge program — mints/burns wrapped assets on the Mythic L2 chain.
pub const BRIDGE_L2_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("MythBrdgL2111111111111111111111111111111111");

/// AI Precompiles program — native AI inference and verification.
pub const AI_PRECOMPILES_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ");

/// Compute Marketplace program — decentralized GPU/CPU/storage marketplace.
pub const COMPUTE_MARKET_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh");

/// Settlement program — posts state roots to Solana L1.
pub const SETTLEMENT_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("MythSett1ement11111111111111111111111111111");

/// MYTH Token program — fee distribution and burn logic.
pub const MYTH_TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("MythToken1111111111111111111111111111111111");

// ── PDA Seeds ───────────────────────────────────────────────────────────────

// Bridge (L1)
pub const BRIDGE_CONFIG_SEED: &[u8] = b"bridge_config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const WITHDRAWAL_SEED: &[u8] = b"withdrawal";

// Bridge (L2)
pub const L2_BRIDGE_CONFIG_SEED: &[u8] = b"bridge_config";
pub const WRAPPED_MINT_SEED: &[u8] = b"wrapped_mint";
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";
pub const BURN_RECORD_SEED: &[u8] = b"burn_record";

// AI Precompiles
pub const AI_REGISTRY_SEED: &[u8] = b"ai_registry";
pub const AI_JOB_SEED: &[u8] = b"ai_job";
pub const AI_RESULT_SEED: &[u8] = b"ai_result";

// Compute Market
pub const PROVIDER_SEED: &[u8] = b"provider";
pub const COMPUTE_JOB_SEED: &[u8] = b"compute_job";
pub const ESCROW_SEED: &[u8] = b"escrow";

// Settlement
pub const SETTLEMENT_CONFIG_SEED: &[u8] = b"settlement_config";
pub const STATE_ROOT_SEED: &[u8] = b"state_root";

// MYTH Token
pub const FEE_CONFIG_SEED: &[u8] = b"fee_config";
pub const FEE_VAULT_SEED: &[u8] = b"fee_vault";

// ── Fee Split Percentages ───────────────────────────────────────────────────
// Total transaction fee is split among these recipients. Values in basis points (1/100th of %).

/// Percentage of fees burned (deflationary). 50% = 5000 bps.
pub const FEE_BURN_BPS: u16 = 5000;

/// Percentage of fees to sequencer/validators. 30% = 3000 bps.
pub const FEE_SEQUENCER_BPS: u16 = 3000;

/// Percentage of fees to foundation treasury. 20% = 2000 bps.
pub const FEE_FOUNDATION_BPS: u16 = 2000;

/// Total basis points (sanity check: BURN + SEQUENCER + FOUNDATION = 10000).
pub const FEE_TOTAL_BPS: u16 = 10000;

// ── Default Config Values ───────────────────────────────────────────────────

/// Default challenge period for bridge withdrawals: 7 days in seconds.
pub const DEFAULT_CHALLENGE_PERIOD: i64 = 604_800;

/// MYTH token decimals (same as SOL: 9 decimals).
pub const MYTH_DECIMALS: u8 = 9;

/// Lamports per MYTH token (10^9).
pub const LAMPORTS_PER_MYTH: u64 = 1_000_000_000;

/// Total supply: 1 billion MYTH.
pub const TOTAL_SUPPLY_MYTH: u64 = 1_000_000_000;

/// Default target lamports per signature.
pub const DEFAULT_TARGET_LAMPORTS_PER_SIG: u64 = 5_000;

/// Default slots per epoch.
pub const DEFAULT_SLOTS_PER_EPOCH: u64 = 432_000;
