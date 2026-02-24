//! Mythic L2 program IDs, PDA seeds, fee parameters, and default config values.

use solana_program::pubkey::Pubkey;

// ── Program IDs ─────────────────────────────────────────────────────────────

/// L1 Bridge program — handles deposits, withdrawals, and challenge periods on Solana mainnet.
pub const BRIDGE_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("BE2pz9kxPJLHd65B9tVBuZUwp3y5mKYczb6JLMsyPymA");

/// L2 Bridge program — native transfer bridge on Mythic L2.
pub const BRIDGE_L2_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("5t8JwXzGQ3c7PCY6p6oJqZgFt8gff2d6uTLrqa1jFrKP");

/// AI Precompiles program — native AI inference and verification.
pub const AI_PRECOMPILES_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ");

/// Compute Marketplace program — decentralized GPU/CPU/storage marketplace.
pub const COMPUTE_MARKET_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh");

/// Settlement program — posts state roots to Solana L1.
pub const SETTLEMENT_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav");

/// MYTH Token program — fee distribution and burn logic.
pub const MYTH_TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf");

/// Launchpad program — token launches on Mythic L2.
pub const LAUNCHPAD_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("62dVNKTPhChmGVzQu7YzK19vVtTk371Zg7iHfNzk635c");

// ── PDA Seeds: Bridge (L1) ──────────────────────────────────────────────────

pub const BRIDGE_CONFIG_SEED: &[u8] = b"bridge_config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const WITHDRAWAL_SEED: &[u8] = b"withdrawal";

// ── PDA Seeds: Bridge (L2) ──────────────────────────────────────────────────

pub const L2_BRIDGE_CONFIG_SEED: &[u8] = b"l2_bridge_config";
pub const BRIDGE_RESERVE_SEED: &[u8] = b"bridge_reserve";
pub const PROCESSED_DEPOSIT_SEED: &[u8] = b"processed";

// ── MYTH Token Mints ────────────────────────────────────────────────────────

/// MYTH L1 SPL token mint on Solana mainnet (6 decimals).
pub const MYTH_L1_MINT: Pubkey =
    solana_program::pubkey!("5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump");

// ── PDA Seeds: AI Precompiles ───────────────────────────────────────────────

pub const AI_CONFIG_SEED: &[u8] = b"ai_config";
pub const MODEL_SEED: &[u8] = b"model";
pub const AI_VALIDATOR_SEED: &[u8] = b"ai_validator";
pub const INFERENCE_SEED: &[u8] = b"inference";
pub const RESULT_SEED: &[u8] = b"result";
pub const VERIFICATION_SEED: &[u8] = b"verification";

// ── PDA Seeds: Compute Market ───────────────────────────────────────────────

pub const MARKET_CONFIG_SEED: &[u8] = b"market_config";
pub const PROVIDER_SEED: &[u8] = b"provider";
pub const STAKE_VAULT_SEED: &[u8] = b"stake_vault";
pub const REQUEST_SEED: &[u8] = b"request";
pub const LEASE_SEED: &[u8] = b"lease";
pub const DISPUTE_SEED: &[u8] = b"dispute";

// ── PDA Seeds: Settlement ───────────────────────────────────────────────────

pub const SETTLEMENT_CONFIG_SEED: &[u8] = b"settlement_config";
pub const STATE_ROOT_SEED: &[u8] = b"state_root";
pub const CHALLENGE_SEED: &[u8] = b"challenge";

// ── PDA Seeds: MYTH Token ───────────────────────────────────────────────────

pub const FEE_CONFIG_SEED: &[u8] = b"fee_config";
pub const VALIDATOR_SEED: &[u8] = b"validator";
pub const FEE_POOL_SEED: &[u8] = b"fee_pool";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";

// ── Default Config Values ───────────────────────────────────────────────────

/// Default challenge period for bridge withdrawals: 7 days in seconds.
pub const DEFAULT_CHALLENGE_PERIOD: i64 = 604_800;

/// Default challenge period for settlement state roots: ~7 days at 400ms slots.
pub const DEFAULT_CHALLENGE_PERIOD_SLOTS: u64 = 151_200;

/// MYTH L1 SPL token decimals (on Solana mainnet).
pub const L1_MYTH_DECIMALS: u8 = 6;

/// MYTH L2 native token decimals (same as SOL: 9 decimals).
pub const L2_MYTH_DECIMALS: u8 = 9;

/// Backward-compatible alias for L2 MYTH decimals.
pub const MYTH_DECIMALS: u8 = 9;

/// Lamports per MYTH token on L2 (10^9).
pub const LAMPORTS_PER_MYTH: u64 = 1_000_000_000;

/// Decimal scaling factor: L1 (6 dec) → L2 (9 dec) = 10^3.
pub const DECIMAL_SCALING_FACTOR: u64 = 1_000;

/// Total supply: 1 billion MYTH.
pub const TOTAL_SUPPLY_MYTH: u64 = 1_000_000_000;

/// BPS denominator used by fee splits.
pub const BPS_DENOMINATOR: u16 = 10_000;

/// Total supply in base units (1B MYTH * 10^9 lamports).
pub const TOTAL_SUPPLY_LAMPORTS: u64 = 1_000_000_000_000_000_000;

/// FeeConfig account size after burn-tracking expansion (v2).
pub const FEE_CONFIG_SIZE: usize = 235;
