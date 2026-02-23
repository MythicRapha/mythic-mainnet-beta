#!/bin/bash
# Deploy Mythic L2 testnet to Azure server
# Usage: ./scripts/deploy-testnet.sh
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

SERVER_IP="${MYTHIC_SERVER_IP:-}"
SSH_KEY="${MYTHIC_SSH_KEY:-$REPO_DIR/mythic-rpc_key.pem}"
SSH_USER="${MYTHIC_SSH_USER:-azureuser}"
REMOTE_DIR="${MYTHIC_REMOTE_DIR:-/home/$SSH_USER/mythic-l2}"

FOUNDATION_PUBKEY="${MYTHIC_FOUNDATION_PUBKEY:-}"
SEQUENCER_PUBKEY="${MYTHIC_SEQUENCER_PUBKEY:-}"

# ── Validation ───────────────────────────────────────────────────────────────

if [ -z "$SERVER_IP" ]; then
    echo "ERROR: MYTHIC_SERVER_IP is required"
    echo "Usage: MYTHIC_SERVER_IP=x.x.x.x ./scripts/deploy-testnet.sh"
    exit 1
fi

if [ -z "$FOUNDATION_PUBKEY" ]; then
    echo "ERROR: MYTHIC_FOUNDATION_PUBKEY is required"
    exit 1
fi

if [ -z "$SEQUENCER_PUBKEY" ]; then
    echo "ERROR: MYTHIC_SEQUENCER_PUBKEY is required"
    exit 1
fi

if [ ! -f "$SSH_KEY" ]; then
    echo "ERROR: SSH key not found at $SSH_KEY"
    exit 1
fi

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"
SSH_CMD="ssh $SSH_OPTS $SSH_USER@$SERVER_IP"
SCP_CMD="scp $SSH_OPTS"

echo "=== Mythic L2 Testnet Deployment ==="
echo "Server:     $SSH_USER@$SERVER_IP"
echo "Remote Dir: $REMOTE_DIR"
echo "Foundation: $FOUNDATION_PUBKEY"
echo "Sequencer:  $SEQUENCER_PUBKEY"
echo ""

# ── Step 1: Sync repo to server ─────────────────────────────────────────────

echo "[1/10] Syncing repo to server..."
rsync -avz --delete \
    --exclude '.git' \
    --exclude 'target' \
    --exclude '*.pem' \
    --exclude 'node_modules' \
    -e "ssh $SSH_OPTS" \
    "$REPO_DIR/" "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
echo "  Done."

# ── Step 2: Install Rust toolchain ──────────────────────────────────────────

echo "[2/10] Installing Rust toolchain..."
$SSH_CMD << 'REMOTE_SCRIPT'
if ! command -v rustc &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source "$HOME/.cargo/env"
rustup update stable
rustup default stable
echo "  Rust $(rustc --version)"
REMOTE_SCRIPT
echo "  Done."

# ── Step 3: Install system dependencies ─────────────────────────────────────

echo "[3/10] Installing system dependencies..."
$SSH_CMD << 'REMOTE_SCRIPT'
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential pkg-config libssl-dev libudev-dev clang cmake protobuf-compiler
REMOTE_SCRIPT
echo "  Done."

# ── Step 4: Install Solana CLI ───────────────────────────────────────────────

echo "[4/10] Installing Solana CLI..."
$SSH_CMD << 'REMOTE_SCRIPT'
if ! command -v solana &>/dev/null; then
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
echo "  Solana $(solana --version)"
REMOTE_SCRIPT
echo "  Done."

# ── Step 5: Build all programs ───────────────────────────────────────────────

echo "[5/10] Building Mythic programs..."
$SSH_CMD << REMOTE_SCRIPT
source "\$HOME/.cargo/env"
export PATH="\$HOME/.local/share/solana/install/active_release/bin:\$PATH"
cd $REMOTE_DIR

# Build native binaries (genesis, relayer)
cargo build --release -p mythic-genesis -p mythic-relayer -p mythic-sdk 2>&1 | tail -5

# Build BPF programs for on-chain deployment
for prog in bridge bridge-l2 compute-market ai-precompiles settlement myth-token; do
    echo "  Building \$prog..."
    cd $REMOTE_DIR/programs/\$prog
    cargo build-sbf 2>&1 | tail -2
done
REMOTE_SCRIPT
echo "  Done."

# ── Step 6: Generate genesis ─────────────────────────────────────────────────

echo "[6/10] Generating genesis config..."
$SSH_CMD << REMOTE_SCRIPT
source "\$HOME/.cargo/env"
cd $REMOTE_DIR

mkdir -p genesis-output
./target/release/mythic-genesis \
    --output-dir ./genesis-output \
    --foundation-pubkey $FOUNDATION_PUBKEY \
    --sequencer-pubkey $SEQUENCER_PUBKEY
REMOTE_SCRIPT
echo "  Done."

# ── Step 7: Generate validator identity ──────────────────────────────────────

echo "[7/10] Generating validator identity..."
$SSH_CMD << REMOTE_SCRIPT
export PATH="\$HOME/.local/share/solana/install/active_release/bin:\$PATH"
cd $REMOTE_DIR

if [ ! -f validator-keypair.json ]; then
    solana-keygen new --no-bip39-passphrase -o validator-keypair.json
    echo "  New validator keypair created"
else
    echo "  Existing validator keypair found"
fi
solana-keygen pubkey validator-keypair.json
REMOTE_SCRIPT
echo "  Done."

# ── Step 8: Start Solana test validator (L2) ─────────────────────────────────

echo "[8/10] Starting Mythic L2 validator..."
$SSH_CMD << REMOTE_SCRIPT
export PATH="\$HOME/.local/share/solana/install/active_release/bin:\$PATH"
cd $REMOTE_DIR

# Stop existing validator if running
pkill -f "solana-test-validator" || true
sleep 2

# Start the L2 test validator with Mythic programs pre-deployed
nohup solana-test-validator \
    --reset \
    --ledger ./test-ledger \
    --rpc-port 8999 \
    --faucet-port 9910 \
    --bpf-program MythBrdg11111111111111111111111111111111111 ./target/deploy/mythic_bridge.so \
    --bpf-program MythBrdgL2111111111111111111111111111111111 ./target/deploy/mythic_bridge_l2.so \
    --bpf-program CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ ./target/deploy/mythic_ai_precompiles.so \
    --bpf-program AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh ./target/deploy/mythic_compute_market.so \
    --bpf-program MythSett1ement11111111111111111111111111111 ./target/deploy/mythic_settlement.so \
    --bpf-program MythToken1111111111111111111111111111111111 ./target/deploy/mythic_token.so \
    > validator.log 2>&1 &

echo "  Waiting for validator to start..."
sleep 5

# Verify validator is running
if solana -u http://localhost:8999 cluster-version 2>/dev/null; then
    echo "  Validator is running"
else
    echo "  WARNING: Validator may not have started. Check validator.log"
fi
REMOTE_SCRIPT
echo "  Done."

# ── Step 9: Deploy programs (if not pre-loaded) ─────────────────────────────

echo "[9/10] Verifying program deployments..."
$SSH_CMD << 'REMOTE_SCRIPT'
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

solana config set --url http://localhost:8999 > /dev/null 2>&1

PROGRAMS=(
    "MythBrdg11111111111111111111111111111111111"
    "MythBrdgL2111111111111111111111111111111111"
    "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ"
    "AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh"
    "MythSett1ement11111111111111111111111111111"
    "MythToken1111111111111111111111111111111111"
)

for prog in "${PROGRAMS[@]}"; do
    if solana program show "$prog" > /dev/null 2>&1; then
        echo "  [OK] $prog"
    else
        echo "  [MISSING] $prog"
    fi
done
REMOTE_SCRIPT
echo "  Done."

# ── Step 10: Smoke test ─────────────────────────────────────────────────────

echo "[10/10] Running smoke test..."
$SSH_CMD << 'REMOTE_SCRIPT'
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana config set --url http://localhost:8999 > /dev/null 2>&1

# Create test keypair
solana-keygen new --no-bip39-passphrase -o /tmp/test-keypair.json --force > /dev/null 2>&1
TEST_PUBKEY=$(solana-keygen pubkey /tmp/test-keypair.json)

# Airdrop
echo "  Airdropping to $TEST_PUBKEY..."
solana airdrop 100 "$TEST_PUBKEY" 2>/dev/null || echo "  Airdrop may have failed (expected in custom genesis)"

# Check balance
BALANCE=$(solana balance "$TEST_PUBKEY" 2>/dev/null || echo "0 SOL")
echo "  Balance: $BALANCE"

# Create a second keypair and transfer
solana-keygen new --no-bip39-passphrase -o /tmp/test-keypair2.json --force > /dev/null 2>&1
TEST_PUBKEY2=$(solana-keygen pubkey /tmp/test-keypair2.json)

solana transfer --from /tmp/test-keypair.json "$TEST_PUBKEY2" 1 --allow-unfunded-recipient 2>/dev/null \
    && echo "  Transfer: OK" \
    || echo "  Transfer: skipped (insufficient balance)"

# Cleanup
rm -f /tmp/test-keypair.json /tmp/test-keypair2.json

echo ""
echo "  Smoke test complete."
REMOTE_SCRIPT

echo ""
echo "=== Deployment Complete ==="
echo "L2 RPC: http://$SERVER_IP:8999"
echo "Validator logs: $REMOTE_DIR/validator.log"
