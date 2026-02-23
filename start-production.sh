#!/bin/bash
# Mythic L2 Production Validator
# Persistent ledger, proper genesis, all BPF programs loaded at genesis
# -----------------------------------------------------------------
set -euo pipefail

source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

LEDGER_DIR="/mnt/data/mythic-l2/production-ledger"
DEPLOY_DIR="/mnt/data/mythic-l2/target/deploy"
SWAP_SO="/mnt/data/mythic-swap/target/deploy/mythic_swap.so"
TOKEN_2022_SO="$HOME/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/solana-program-test-2.0.25/src/programs/spl_token_2022-5.0.2.so"
KEYS_DIR="/mnt/data/mythic-l2/keys"

# Key addresses
FOUNDATION_KEY="AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e"
SEQUENCER_KEY="DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg"

# Program IDs
BRIDGE_ID="MythBrdg11111111111111111111111111111111111"
BRIDGE_L2_ID="MythBrdgL2111111111111111111111111111111111"
AI_PRECOMPILES_ID="CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ"
COMPUTE_MARKET_ID="AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh"
SETTLEMENT_ID="MythSett1ement11111111111111111111111111111"
MYTH_TOKEN_ID="MythToken1111111111111111111111111111111111"
LAUNCHPAD_ID="MythPad111111111111111111111111111111111111"
SWAP_ID="MythSwap11111111111111111111111111111111111"

echo "=== Mythic L2 Production Validator ==="
echo "Ledger: $LEDGER_DIR"
echo "Foundation: $FOUNDATION_KEY"
echo "Sequencer: $SEQUENCER_KEY"

# Build command args array
ARGS=(
    --ledger "$LEDGER_DIR"
    --rpc-port 8899
    --faucet-port 9900
    --limit-ledger-size 50000000
    --log

    # Mint authority = foundation key (receives initial SOL/MYTH supply)
    --mint "$FOUNDATION_KEY"

    # Epoch and tick configuration matching mythic_config.toml
    --slots-per-epoch 432000
    --ticks-per-slot 64

    # Faucet allocation (for development/testing)
    --faucet-sol 1000000

    # Override Token-2022 with working SO that supports metadata realloc
    --upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb "$TOKEN_2022_SO" none

    # Load all BPF programs at genesis (only applies on first run)
    --bpf-program "$BRIDGE_ID" "$DEPLOY_DIR/mythic_bridge.so"
    --bpf-program "$BRIDGE_L2_ID" "$DEPLOY_DIR/mythic_bridge_l2.so"
    --bpf-program "$AI_PRECOMPILES_ID" "$DEPLOY_DIR/mythic_ai_precompiles.so"
    --bpf-program "$COMPUTE_MARKET_ID" "$DEPLOY_DIR/mythic_compute_market.so"
    --bpf-program "$SETTLEMENT_ID" "$DEPLOY_DIR/mythic_settlement.so"
    --bpf-program "$MYTH_TOKEN_ID" "$DEPLOY_DIR/mythic_token.so"
    --bpf-program "$LAUNCHPAD_ID" "$DEPLOY_DIR/mythic_launchpad.so"
)

# Load swap program if it exists
if [ -f "$SWAP_SO" ]; then
    ARGS+=(--bpf-program "$SWAP_ID" "$SWAP_SO")
    echo "Swap program loaded: $SWAP_ID"
fi

echo ""
echo "Programs loaded at genesis (first run only):"
echo "  Bridge L1:       $BRIDGE_ID"
echo "  Bridge L2:       $BRIDGE_L2_ID"
echo "  AI Precompiles:  $AI_PRECOMPILES_ID"
echo "  Compute Market:  $COMPUTE_MARKET_ID"
echo "  Settlement:      $SETTLEMENT_ID"
echo "  MYTH Token:      $MYTH_TOKEN_ID"
echo "  Launchpad:       $LAUNCHPAD_ID"
echo "  Swap:            $SWAP_ID"
echo ""

if [ -d "$LEDGER_DIR" ]; then
    echo "Resuming existing ledger (NO reset)..."
else
    echo "First run: creating genesis with foundation mint..."
    mkdir -p "$LEDGER_DIR"
fi

echo "Starting validator on port 8899..."
exec solana-test-validator "${ARGS[@]}"
