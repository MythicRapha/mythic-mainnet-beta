#!/bin/bash
# Mythic L2 Mainnet Validator — Clean Genesis
# No faucet, no airdrop. Foundation gets exactly 500M MYTH.
set -euo pipefail

source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

LEDGER_DIR="/mnt/data/mythic-l2/production-ledger"
DEPLOY_DIR="/mnt/data/mythic-l2/target/deploy"
TOKEN_2022_SO="$HOME/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/solana-program-test-2.0.25/src/programs/spl_token_2022-5.0.2.so"

FOUNDATION_KEY="AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e"

echo "=== Mythic L2 Mainnet Validator ==="
echo "Ledger: $LEDGER_DIR"
echo "Foundation: $FOUNDATION_KEY"
echo "Faucet: DISABLED"

ARGS=(
    --ledger "$LEDGER_DIR"
    --rpc-port 8899
    --limit-ledger-size 50000000
    --log
    --mint "$FOUNDATION_KEY"
    --slots-per-epoch 432000
    --ticks-per-slot 64
    --upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb "$TOKEN_2022_SO" none
    --bpf-program MythBrdg11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_bridge.so"
    --bpf-program MythBrdgL2111111111111111111111111111111111 "$DEPLOY_DIR/mythic_bridge_l2.so"
    --bpf-program CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ "$DEPLOY_DIR/mythic_ai_precompiles.so"
    --bpf-program AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh "$DEPLOY_DIR/mythic_compute_market.so"
    --bpf-program MythSett1ement11111111111111111111111111111 "$DEPLOY_DIR/mythic_settlement.so"
    --bpf-program MythToken1111111111111111111111111111111111 "$DEPLOY_DIR/mythic_token.so"
    --bpf-program MythPad111111111111111111111111111111111111 "$DEPLOY_DIR/mythic_launchpad.so"
    --bpf-program MythSwap11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_swap.so"
    --bpf-program MythStak11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_staking.so"
    --bpf-program MythGov111111111111111111111111111111111111 "$DEPLOY_DIR/mythic_governance.so"
    --bpf-program MythDrop11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_airdrop.so"
)

if [ -d "$LEDGER_DIR" ]; then
    echo "Resuming existing ledger (NO reset)..."
else
    echo "First run: creating genesis with 500M MYTH to Foundation..."
    mkdir -p "$LEDGER_DIR"
fi

echo "Starting mainnet validator on port 8899..."
exec solana-test-validator "${ARGS[@]}"
