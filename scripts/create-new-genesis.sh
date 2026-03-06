#!/bin/bash
set -euo pipefail

# ===================================================================
# Mythic L2 — Create New Genesis with 2-Node Consensus
# ===================================================================
# Run this on S1 (20.96.180.64) as user 'mythic'
# Prerequisites: export-l2-accounts.py already ran successfully
# ===================================================================

export PATH=/opt/agave/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH

# Key paths
EXPORT_DIR="/mnt/data/mythic-l2/account-export"
DEPLOY_DIR="/mnt/data/mythic-l2/target/deploy"
KEYS_DIR="/mnt/data/mythic-l2/keypair-backup"
S2_KEYS_DIR="/mnt/data/mythic-l2/keys/s2"
LEDGER_DIR="/mnt/data/mythic-l2/new-genesis-ledger"
MINT_KEYS_DIR="/mnt/data/mythic-l2/keys/mints"

# S1 identity
S1_IDENTITY_KEY="$KEYS_DIR/validator-keypair.json"
S1_VOTE_KEY="$KEYS_DIR/vote-account-keypair.json"
S1_STAKE_KEY="$KEYS_DIR/stake-account-keypair.json"
S1_FAUCET_KEY="$KEYS_DIR/faucet-keypair.json"

# S2 identity
S2_IDENTITY_KEY="$S2_KEYS_DIR/l2-s2-identity-v2.json"
S2_VOTE_KEY="$S2_KEYS_DIR/l2-s2-vote-v2.json"

# Deployer / Foundation / Sequencer keys
DEPLOYER_KEY="/mnt/data/mythic-l2/keys/deployer.json"
FOUNDATION_KEY="/mnt/data/mythic-l2/keys/foundation.json"
SEQUENCER_KEY="/mnt/data/mythic-l2/keys/sequencer-identity.json"

# Program IDs → .so files mapping
declare -A PROGRAMS=(
    ["MythBrdg11111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_bridge.so"
    ["MythBrdgL2111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_bridge_l2.so"
    ["CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ"]="$DEPLOY_DIR/mythic_ai_precompiles.so"
    ["AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh"]="$DEPLOY_DIR/mythic_compute_market.so"
    ["MythSett1ement11111111111111111111111111111"]="$DEPLOY_DIR/mythic_settlement.so"
    ["MythToken1111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_token.so"
    ["MythPad111111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_launchpad.so"
    ["MythSwap11111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_swap.so"
    ["MythStak11111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_staking.so"
    ["MythGov111111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_governance.so"
    ["MythDrop11111111111111111111111111111111111"]="$DEPLOY_DIR/mythic_airdrop.so"
)

echo "=========================================="
echo "Mythic L2 — New Genesis Creation"
echo "=========================================="

# Verify all prerequisites
echo ""
echo "[1/8] Verifying prerequisites..."

for prog_id in "${!PROGRAMS[@]}"; do
    so_file="${PROGRAMS[$prog_id]}"
    if [ ! -f "$so_file" ]; then
        echo "ERROR: Missing .so file: $so_file"
        exit 1
    fi
done
echo "  ✓ All 11 program .so files found"

for key in "$S1_IDENTITY_KEY" "$S1_VOTE_KEY" "$S2_IDENTITY_KEY" "$S2_VOTE_KEY" "$DEPLOYER_KEY" "$FOUNDATION_KEY" "$SEQUENCER_KEY"; do
    if [ ! -f "$key" ]; then
        echo "ERROR: Missing key: $key"
        exit 1
    fi
done
echo "  ✓ All keypairs found"

if [ ! -d "$EXPORT_DIR" ]; then
    echo "ERROR: Export directory not found: $EXPORT_DIR"
    exit 1
fi
ACCOUNT_COUNT=$(find "$EXPORT_DIR" -name "*.json" -not -name "test-validator-flags.txt" | wc -l)
echo "  ✓ Export directory: $ACCOUNT_COUNT accounts"

# Get pubkeys
S1_IDENTITY=$(solana-keygen pubkey "$S1_IDENTITY_KEY")
S1_VOTE=$(solana-keygen pubkey "$S1_VOTE_KEY")
S2_IDENTITY=$(solana-keygen pubkey "$S2_IDENTITY_KEY")
S2_VOTE=$(solana-keygen pubkey "$S2_VOTE_KEY")
DEPLOYER=$(solana-keygen pubkey "$DEPLOYER_KEY")
FOUNDATION=$(solana-keygen pubkey "$FOUNDATION_KEY")
SEQUENCER=$(solana-keygen pubkey "$SEQUENCER_KEY")

echo ""
echo "  S1 Identity: $S1_IDENTITY"
echo "  S1 Vote:     $S1_VOTE"
echo "  S2 Identity: $S2_IDENTITY"
echo "  S2 Vote:     $S2_VOTE"
echo "  Deployer:    $DEPLOYER"
echo "  Foundation:  $FOUNDATION"
echo "  Sequencer:   $SEQUENCER"

# Step 2: Stop current FD
echo ""
echo "[2/8] Stopping current Frankendancer..."
# Use sudo to stop fdctl
sudo pkill -f "fdctl run" 2>/dev/null || true
sleep 3
if pgrep -f "fdctl run" > /dev/null 2>&1; then
    echo "  WARNING: FD still running, force killing..."
    sudo pkill -9 -f "fdctl run" 2>/dev/null || true
    sleep 2
fi
echo "  ✓ Frankendancer stopped"

# Step 3: Backup current ledger
echo ""
echo "[3/8] Backing up current ledger..."
BACKUP_NAME="ledger-backup-$(date +%Y%m%d-%H%M%S)"
if [ -d "/mnt/data/mythic-l2/fd-ledger" ]; then
    mv /mnt/data/mythic-l2/fd-ledger "/mnt/data/mythic-l2/$BACKUP_NAME"
    echo "  ✓ Backed up to /mnt/data/mythic-l2/$BACKUP_NAME"
else
    echo "  (no fd-ledger to backup)"
fi

# Step 4: Build test-validator command
echo ""
echo "[4/8] Building solana-test-validator command..."

# Clean up old genesis ledger if exists
rm -rf "$LEDGER_DIR"
mkdir -p "$LEDGER_DIR"

# Build the command
CMD="solana-test-validator"
CMD="$CMD --ledger $LEDGER_DIR"
CMD="$CMD --mint $DEPLOYER"
CMD="$CMD --rpc-port 9899"
CMD="$CMD --gossip-port 9800"
CMD="$CMD --faucet-port 9801"
CMD="$CMD --ticks-per-slot 8"
CMD="$CMD --slots-per-epoch 432000"
CMD="$CMD --reset"

# Add all 11 programs
for prog_id in "${!PROGRAMS[@]}"; do
    CMD="$CMD --bpf-program $prog_id ${PROGRAMS[$prog_id]}"
done

# Add all exported accounts
while IFS= read -r -d '' json_file; do
    pubkey=$(basename "$json_file" .json)
    # Skip non-pubkey files
    if [ "$pubkey" = "test-validator-flags" ]; then
        continue
    fi
    CMD="$CMD --account $pubkey $json_file"
done < <(find "$EXPORT_DIR" -name "*.json" -not -name "test-validator-flags.txt" -print0)

echo "  ✓ Command built with 11 programs and $ACCOUNT_COUNT accounts"
echo "  Starting test-validator..."

# Step 5: Run test-validator in background
echo ""
echo "[5/8] Starting solana-test-validator..."

# Run it
eval "$CMD" > /tmp/test-validator.log 2>&1 &
TV_PID=$!
echo "  PID: $TV_PID"

# Wait for it to start
echo "  Waiting for RPC to become available..."
for i in $(seq 1 60); do
    if curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null | grep -q "result"; then
        echo "  ✓ Test validator running at slot $(curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"])')"
        break
    fi
    if ! kill -0 $TV_PID 2>/dev/null; then
        echo "  ERROR: Test validator crashed. Last log:"
        tail -30 /tmp/test-validator.log
        exit 1
    fi
    sleep 2
done

# Configure CLI to use test-validator
solana config set --url http://localhost:9899 --keypair "$DEPLOYER_KEY" > /dev/null

# Step 6: Set up S2 vote account + stake
echo ""
echo "[6/8] Setting up S2 vote account and stake..."

# Create S2 vote account
echo "  Creating S2 vote account..."
solana create-vote-account "$S2_VOTE_KEY" "$S2_IDENTITY_KEY" "$S2_IDENTITY" \
    --commission 0 \
    --keypair "$DEPLOYER_KEY" \
    --fee-payer "$DEPLOYER_KEY" 2>&1 || echo "  (vote account may already exist)"

# Create and delegate stake for S2
echo "  Creating stake account for S2..."
S2_STAKE_KEY="/tmp/s2-stake.json"
solana-keygen new -o "$S2_STAKE_KEY" --no-bip39-passphrase --force > /dev/null 2>&1
solana create-stake-account "$S2_STAKE_KEY" 100000 \
    --keypair "$DEPLOYER_KEY" \
    --fee-payer "$DEPLOYER_KEY" 2>&1

echo "  Delegating stake to S2..."
solana delegate-stake "$S2_STAKE_KEY" "$S2_VOTE_KEY" \
    --keypair "$DEPLOYER_KEY" \
    --fee-payer "$DEPLOYER_KEY" 2>&1

# Fund S2 identity with operational gas
echo "  Funding S2 identity..."
solana transfer "$S2_IDENTITY" 10000 \
    --keypair "$DEPLOYER_KEY" \
    --fee-payer "$DEPLOYER_KEY" \
    --allow-unfunded-recipient 2>&1

# Step 7: Fund operational wallets (minimal amounts only)
echo ""
echo "[7/8] Funding operational wallets..."

# Fund Sequencer with minimal operational MYTH (relay txs only)
echo "  Funding Sequencer ($SEQUENCER)..."
solana transfer "$SEQUENCER" 1000 \
    --keypair "$DEPLOYER_KEY" \
    --fee-payer "$DEPLOYER_KEY" \
    --allow-unfunded-recipient 2>&1

# Fund Foundation with minimal operational MYTH
echo "  Funding Foundation ($FOUNDATION)..."
solana transfer "$FOUNDATION" 1000 \
    --keypair "$DEPLOYER_KEY" \
    --fee-payer "$DEPLOYER_KEY" \
    --allow-unfunded-recipient 2>&1

echo "  ✓ Operational wallets funded"

# Check balances
echo ""
echo "  === Balance Summary ==="
echo "  Deployer: $(solana balance "$DEPLOYER" 2>/dev/null)"
echo "  Sequencer: $(solana balance "$SEQUENCER" 2>/dev/null)"
echo "  Foundation: $(solana balance "$FOUNDATION" 2>/dev/null)"
echo "  S2 Identity: $(solana balance "$S2_IDENTITY" 2>/dev/null)"

# Wait for stake warmup
echo ""
echo "[8/8] Waiting for stake warmup (~200 slots)..."
START_SLOT=$(solana slot 2>/dev/null)
TARGET_SLOT=$((START_SLOT + 250))
echo "  Current slot: $START_SLOT, waiting until slot $TARGET_SLOT..."

while true; do
    CURRENT=$(solana slot 2>/dev/null)
    if [ "$CURRENT" -ge "$TARGET_SLOT" ] 2>/dev/null; then
        echo "  ✓ Reached slot $CURRENT"
        break
    fi
    sleep 2
done

# Verify everything
echo ""
echo "=========================================="
echo "Verification"
echo "=========================================="

echo "  Slot: $(solana slot)"
echo "  Vote accounts:"
solana vote-account "$S2_VOTE_KEY" 2>&1 | head -5 || echo "  (S2 vote account check)"

echo ""
echo "  Programs:"
for prog_id in "${!PROGRAMS[@]}"; do
    if solana program show "$prog_id" > /dev/null 2>&1; then
        echo "    ✓ $prog_id"
    else
        echo "    ✗ $prog_id MISSING"
    fi
done

echo ""
echo "  SPL Token accounts:"
TOKEN_COUNT=$(curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",{"encoding":"base64"}]}' \
    | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("result",[])))' 2>/dev/null)
echo "    Count: $TOKEN_COUNT"

echo ""
echo "  Bridge L2 accounts:"
BRIDGE_COUNT=$(curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["MythBrdgL2111111111111111111111111111111111",{"encoding":"base64"}]}' \
    | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("result",[])))' 2>/dev/null)
echo "    Count: $BRIDGE_COUNT"

# Keep test-validator running
echo ""
echo "=========================================="
echo "Genesis created successfully!"
echo "Ledger: $LEDGER_DIR"
echo "Test validator PID: $TV_PID (still running on port 9899)"
echo ""
echo "Next steps:"
echo "  1. Stop test-validator: kill $TV_PID"
echo "  2. Copy $LEDGER_DIR to both S1 and S2"
echo "  3. Configure FD on both servers"
echo "  4. Start S1 FD, then S2 FD"
echo "=========================================="
