#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

LEDGER_DIR="/mnt/data/mythic-l2/testnet-ledger"
DEPLOY_DIR="/mnt/data/mythic-l2/target/deploy"
FOUNDATION="AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e"

echo "$(date -u +%Y-%m-%d\ %H:%M:%S): === Mythic L2 Testnet Validator ==="
echo "$(date -u +%Y-%m-%d\ %H:%M:%S): Ledger: $LEDGER_DIR"
echo "$(date -u +%Y-%m-%d\ %H:%M:%S): Faucet: ENABLED (testnet only)"

if [ ! -d "$LEDGER_DIR" ]; then
    echo "$(date -u +%Y-%m-%d\ %H:%M:%S): First run: creating testnet genesis with 500M MYTH..."
fi

echo "$(date -u +%Y-%m-%d\ %H:%M:%S): Starting testnet validator on port 8999..."

exec solana-test-validator \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8999 \
    --gossip-port 9100 \
    --dynamic-port-range 9200-9400 \
    --faucet-port 9901 \
    --faucet-sol 1000000 \
    --mint "$FOUNDATION" \
    --ticks-per-slot 8 \
    --slots-per-epoch 432000 \
    --bpf-program MythBrdg11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_bridge.so" \
    --bpf-program MythBrdgL2111111111111111111111111111111111 "$DEPLOY_DIR/mythic_bridge_l2.so" \
    --bpf-program CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ "$DEPLOY_DIR/mythic_ai_precompiles.so" \
    --bpf-program AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh "$DEPLOY_DIR/mythic_compute_market.so" \
    --bpf-program MythSett1ement11111111111111111111111111111 "$DEPLOY_DIR/mythic_settlement.so" \
    --bpf-program MythToken1111111111111111111111111111111111 "$DEPLOY_DIR/mythic_token.so" \
    --bpf-program MythPad111111111111111111111111111111111111 "$DEPLOY_DIR/mythic_launchpad.so" \
    --bpf-program MythSwap11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_swap.so" \
    --bpf-program MythStak11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_staking.so" \
    --bpf-program MythGov111111111111111111111111111111111111 "$DEPLOY_DIR/mythic_governance.so" \
    --bpf-program MythDrop11111111111111111111111111111111111 "$DEPLOY_DIR/mythic_airdrop.so" \
    --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
    --url https://api.mainnet-beta.solana.com \
    2>&1
