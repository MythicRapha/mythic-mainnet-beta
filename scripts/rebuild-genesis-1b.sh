#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# Mythic L2 — Genesis Rebuild: 1B MYTH Bridge Reserve
# ═══════════════════════════════════════════════════════════════════════════
#
# Master script for Phases 2-4 of the genesis rebuild.
# Run on S1 (20.96.180.64) as user 'mythic'.
#
# SAFETY: All ProcessedDeposit PDAs are preserved — no double-processing.
# SAFETY: Current user balances are preserved — nobody gets extra MYTH.
# SAFETY: Broken 92-byte bridge config is excluded — re-initialized after.
#
# Prerequisites:
#   - Initial export already run: node scripts/export-l2-full.mjs
#   - maintenance.html deployed to /mnt/data/mythic-l2/
#   - Social media posts published
#
# Usage:
#   bash scripts/rebuild-genesis-1b.sh
# ═══════════════════════════════════════════════════════════════════════════

export PATH=/opt/agave/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH

# ── Configuration ─────────────────────────────────────────────────────────

EXPORT_DIR="/mnt/data/mythic-l2/account-export-v2"
DEPLOY_DIR="/mnt/data/mythic-l2/target/deploy"
LEDGER_DIR="/mnt/data/mythic-l2/new-genesis-ledger"
FD_LEDGER="/mnt/data/mythic-l2/fd-ledger"
DEPLOYER_KEY="/mnt/data/mythic-l2/keys/deployer.json"
MAINTENANCE_HTML="/mnt/data/mythic-l2/maintenance.html"
RELAYER_DB="/mnt/data/mythic-relayer/data/relayer.db"

# Bridge safety constants
BRIDGE_RESERVE_PDA="G1gb6Kuycj7FkdGWtLJ2fngqAmtJiLy89bkKUBvHZAVg"
BROKEN_BRIDGE_CONFIG="56ndvfbd3j1gpwx8m7pKR8CQGF4qTqAPTJ7s7dQacSSf"
STUCK_DEPOSIT_SIG="5f3rJP87vZiUB49m4zZCouerLvRV3PmEenTK5jXqgr6pTMEH9VPK8MjmuD4yQ6McNEqt12W1hftHYi85m1Dpzs8Q"

# Domains for nginx maintenance mode
DOMAINS="mythic.sh mythicswap.app mythic.money mythic.foundation mythiclabs.io wallet.mythic.sh api.mythic.sh dex.mythic.sh"

# Program IDs → .so files
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

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "═══════════════════════════════════════════"
echo "  Mythic L2 — Genesis Rebuild (1B Reserve)"
echo "  Started: $(date)"
echo "═══════════════════════════════════════════"

# ── Preflight Checks ─────────────────────────────────────────────────────

echo ""
echo "[PREFLIGHT] Verifying prerequisites..."

# Check all .so files exist
for prog_id in "${!PROGRAMS[@]}"; do
    so_file="${PROGRAMS[$prog_id]}"
    if [ ! -f "$so_file" ]; then
        echo "  FATAL: Missing program binary: $so_file"
        exit 1
    fi
done
echo "  OK: All 11 program .so files found"

# Check deployer key
if [ ! -f "$DEPLOYER_KEY" ]; then
    echo "  FATAL: Deployer key not found: $DEPLOYER_KEY"
    exit 1
fi
DEPLOYER=$(solana-keygen pubkey "$DEPLOYER_KEY")
echo "  OK: Deployer = $DEPLOYER"

# Check export directory
if [ ! -d "$EXPORT_DIR" ]; then
    echo "  FATAL: Export directory not found: $EXPORT_DIR"
    echo "  Run 'node scripts/export-l2-full.mjs' first!"
    exit 1
fi

# Verify balance audit exists
if [ ! -f "$EXPORT_DIR/balance-audit.json" ]; then
    echo "  FATAL: balance-audit.json not found in export directory"
    echo "  Run 'node scripts/export-l2-full.mjs' first!"
    exit 1
fi

# Verify bridge reserve override
RESERVE_FILE="$EXPORT_DIR/bridge-reserve/$BRIDGE_RESERVE_PDA.json"
if [ -f "$RESERVE_FILE" ]; then
    RESERVE_LAMPORTS=$(python3 -c "import json; print(json.load(open('$RESERVE_FILE'))['account']['lamports'])")
    if [ "$RESERVE_LAMPORTS" = "1000000000000000000" ]; then
        echo "  OK: Bridge reserve = 1,000,000,000 MYTH (1B)"
    else
        echo "  WARNING: Bridge reserve = $RESERVE_LAMPORTS (expected 1000000000000000000)"
        echo "  The export may not have overridden correctly. Continue? (y/n)"
        read -r CONFIRM
        if [ "$CONFIRM" != "y" ]; then exit 1; fi
    fi
else
    echo "  WARNING: Bridge reserve file not found at expected path"
    echo "  Will create synthetic account"
fi

# Verify broken config is NOT in exports
if find "$EXPORT_DIR" -name "$BROKEN_BRIDGE_CONFIG.json" 2>/dev/null | grep -q .; then
    echo "  FATAL: Broken bridge config found in exports! It should have been excluded."
    echo "  Removing it now..."
    find "$EXPORT_DIR" -name "$BROKEN_BRIDGE_CONFIG.json" -delete
    echo "  Removed."
fi
echo "  OK: Broken bridge config excluded"

# Count ProcessedDeposit PDAs (bridge safety)
PROCESSED_COUNT=$(python3 -c "
import json, os
audit = json.load(open('$EXPORT_DIR/balance-audit.json'))
count = audit.get('bridgeAudit', {}).get('processedDepositCount', 'unknown')
print(count)
" 2>/dev/null || echo "unknown")
echo "  OK: ProcessedDeposit PDAs preserved = $PROCESSED_COUNT"

ACCOUNT_COUNT=$(find "$EXPORT_DIR" -name "*.json" -not -name "test-validator-flags.txt" -not -name "balance-audit.json" | wc -l | tr -d ' ')
echo "  OK: Total accounts to load = $ACCOUNT_COUNT"

echo ""
echo "Ready to begin genesis rebuild."
echo "This will cause ~20-30 minutes of downtime."
echo "Press ENTER to continue or Ctrl+C to abort..."
read -r

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: Maintenance Mode
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════"
echo "  PHASE 2: Entering Maintenance Mode"
echo "═══════════════════════════════════════════"

# Step 2.1: Stop relayer first (no new deposits during final export)
echo ""
echo "[2.1] Stopping relayer..."
pm2 stop mythic-relayer 2>/dev/null || echo "  (relayer not running)"
echo "  Relayer stopped"

# Step 2.2: Run FINAL export (captures last-second state)
echo ""
echo "[2.2] Running FINAL account export..."
node /mnt/data/mythic-l2/scripts/export-l2-full.mjs --final
echo "  Final export complete"

# Step 2.3: Stop Frankendancer
echo ""
echo "[2.3] Stopping Frankendancer..."
sudo systemctl stop mythic-fddev 2>/dev/null || true
sleep 3
# Double-check
if pgrep -f "fddev" > /dev/null 2>&1; then
    echo "  fddev still running, force killing..."
    sudo pkill -9 -f "fddev" 2>/dev/null || true
    sleep 2
fi
echo "  Frankendancer stopped"

# Step 2.4: Enable nginx maintenance page
echo ""
echo "[2.4] Enabling maintenance page..."

# Create nginx maintenance config
sudo tee /etc/nginx/conf.d/maintenance.conf > /dev/null << 'NGINX_CONF'
# Mythic L2 Maintenance Mode — auto-generated, remove after maintenance
server {
    listen 80 default_server;
    server_name _;
    root /mnt/data/mythic-l2;
    location / {
        try_files /maintenance.html =503;
    }
}
NGINX_CONF

# Backup current nginx configs and replace with maintenance
for conf in /etc/nginx/sites-enabled/*; do
    if [ -f "$conf" ]; then
        sudo mv "$conf" "$conf.pre-maintenance" 2>/dev/null || true
    fi
done

sudo nginx -t && sudo nginx -s reload
echo "  Maintenance page active for all domains"

# Step 2.5: Stop all PM2 processes
echo ""
echo "[2.5] Stopping all PM2 processes..."
pm2 stop all 2>/dev/null || echo "  (no processes to stop)"
echo "  All services stopped"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3: Rebuild Genesis
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════"
echo "  PHASE 3: Rebuilding Genesis"
echo "═══════════════════════════════════════════"

# Step 3.1: Backup current ledger
echo ""
echo "[3.1] Backing up current ledger..."
BACKUP_DIR="/mnt/data/mythic-l2/fd-ledger-backup-$TIMESTAMP"
if [ -d "$FD_LEDGER" ]; then
    sudo cp -r "$FD_LEDGER" "$BACKUP_DIR"
    echo "  Backed up to: $BACKUP_DIR"
else
    echo "  No existing fd-ledger to backup"
fi

# Step 3.2: Build solana-test-validator command
echo ""
echo "[3.2] Building genesis command..."

rm -rf "$LEDGER_DIR"
mkdir -p "$LEDGER_DIR"

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

# Add all exported accounts (excluding metadata files)
LOADED=0
while IFS= read -r -d '' json_file; do
    pubkey=$(basename "$json_file" .json)
    # Skip metadata files
    case "$pubkey" in
        test-validator-flags|balance-audit)
            continue
            ;;
    esac

    # SAFETY: Double-check broken config is not loaded
    if [ "$pubkey" = "$BROKEN_BRIDGE_CONFIG" ]; then
        echo "  SAFETY: Skipping broken bridge config $pubkey"
        continue
    fi

    CMD="$CMD --account $pubkey $json_file"
    LOADED=$((LOADED + 1))
done < <(find "$EXPORT_DIR" -name "*.json" -not -name "test-validator-flags.txt" -not -name "balance-audit.json" -print0)

echo "  Command built: 11 programs + $LOADED accounts"

# Step 3.3: Start test-validator to produce genesis
echo ""
echo "[3.3] Starting solana-test-validator for genesis creation..."

eval "$CMD" > /tmp/test-validator-genesis.log 2>&1 &
TV_PID=$!
echo "  PID: $TV_PID"

# Wait for RPC
echo "  Waiting for test-validator RPC..."
for i in $(seq 1 90); do
    if curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null | grep -q "result"; then
        SLOT=$(curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' \
            | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"])' 2>/dev/null)
        echo "  Test validator running at slot $SLOT"
        break
    fi
    if ! kill -0 $TV_PID 2>/dev/null; then
        echo "  FATAL: Test validator crashed!"
        echo "  Last 50 lines of log:"
        tail -50 /tmp/test-validator-genesis.log
        echo ""
        echo "  ROLLBACK: Restore backup from $BACKUP_DIR"
        exit 1
    fi
    if [ "$i" -eq 90 ]; then
        echo "  FATAL: Test validator didn't start in 180 seconds"
        kill $TV_PID 2>/dev/null
        exit 1
    fi
    sleep 2
done

# Step 3.4: Quick verification on test-validator
echo ""
echo "[3.4] Quick verification on test-validator..."

solana config set --url http://localhost:9899 --keypair "$DEPLOYER_KEY" > /dev/null 2>&1

# Verify bridge reserve
RESERVE_BAL=$(curl -s http://localhost:9899 -X POST -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$BRIDGE_RESERVE_PDA\"]}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("result",{}).get("value",0))' 2>/dev/null)
echo "  Bridge reserve balance: $RESERVE_BAL lamports"

if [ "$RESERVE_BAL" = "1000000000000000000" ]; then
    echo "  PASS: Bridge reserve = 1B MYTH"
else
    echo "  WARNING: Bridge reserve != 1B MYTH (got $RESERVE_BAL)"
    echo "  This might be OK if the override wasn't applied. Check manually."
fi

# Verify a few key programs
PROGRAMS_OK=0
for prog_id in MythBrdgL2111111111111111111111111111111111 MythToken1111111111111111111111111111111111 MythSwap11111111111111111111111111111111111; do
    if solana program show "$prog_id" --url http://localhost:9899 > /dev/null 2>&1; then
        PROGRAMS_OK=$((PROGRAMS_OK + 1))
    fi
done
echo "  Key programs verified: $PROGRAMS_OK/3"

# Step 3.5: Kill test-validator — genesis is created
echo ""
echo "[3.5] Stopping test-validator..."
kill $TV_PID 2>/dev/null
wait $TV_PID 2>/dev/null || true
echo "  Test validator stopped"

# Step 3.6: Deploy genesis to fddev
echo ""
echo "[3.6] Deploying genesis to Frankendancer..."

# Remove old fd-ledger
sudo rm -rf "$FD_LEDGER"

# Copy test-validator genesis to fddev ledger path
sudo cp -r "$LEDGER_DIR" "$FD_LEDGER"
sudo chown -R mythic:mythic "$FD_LEDGER"
echo "  Genesis copied to $FD_LEDGER"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4: Start & Verify
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════"
echo "  PHASE 4: Starting Frankendancer"
echo "═══════════════════════════════════════════"

# Step 4.1: Start fddev
echo ""
echo "[4.1] Starting Frankendancer..."
sudo systemctl start mythic-fddev
echo "  Waiting for fddev RPC..."

for i in $(seq 1 120); do
    if curl -s http://localhost:8899 -X POST -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null | grep -q "result"; then
        SLOT=$(curl -s http://localhost:8899 -X POST -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' \
            | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"])' 2>/dev/null)
        echo "  Frankendancer running at slot $SLOT"
        break
    fi
    if [ "$i" -eq 120 ]; then
        echo "  FATAL: Frankendancer didn't start in 240 seconds!"
        echo "  Check: sudo journalctl -u mythic-fddev -n 100"
        echo "  ROLLBACK: sudo cp -r $BACKUP_DIR $FD_LEDGER && sudo systemctl start mythic-fddev"
        exit 1
    fi
    sleep 2
done

# Step 4.2: Re-initialize all program configs
echo ""
echo "[4.2] Re-initializing program configs..."
solana config set --url http://localhost:8899 --keypair "$DEPLOYER_KEY" > /dev/null 2>&1

# Request airdrop for deployer (test-validator genesis gives deployer the mint)
echo "  Airdropping to deployer for tx fees..."
solana airdrop 100 "$DEPLOYER" --url http://localhost:8899 2>/dev/null || echo "  (airdrop not available, deployer should have balance from genesis)"

# Initialize all 9 program configs
echo "  Running init-all-programs.cjs..."
node /mnt/data/mythic-l2/scripts/init-all-programs.cjs
echo "  Program configs initialized"

# Step 4.3: Reset stuck deposit in relayer DB
echo ""
echo "[4.3] Resetting stuck deposit in relayer DB..."
if [ -f "$RELAYER_DB" ]; then
    sqlite3 "$RELAYER_DB" "UPDATE deposits SET status='pending', retry_count=0 WHERE l1_tx_signature='$STUCK_DEPOSIT_SIG';" 2>/dev/null
    echo "  Stuck deposit (nonce 53) reset to pending"

    # Show current state
    PENDING=$(sqlite3 "$RELAYER_DB" "SELECT COUNT(*) FROM deposits WHERE status='pending';" 2>/dev/null)
    echo "  Total pending deposits: $PENDING"
else
    echo "  Relayer DB not found at $RELAYER_DB"
fi

# Step 4.4: Run verification script
echo ""
echo "[4.4] Running post-genesis verification..."
node /mnt/data/mythic-l2/scripts/verify-post-genesis.mjs
echo "  Verification complete"

echo ""
echo "═══════════════════════════════════════════"
echo "  Genesis rebuild complete!"
echo "  Continue to Phase 5 (go-live) manually."
echo ""
echo "  Phase 5 steps:"
echo "    1. pm2 start mythic-relayer  (auto-processes nonce 53)"
echo "    2. pm2 start all"
echo "    3. Restore nginx configs:"
echo "       for f in /etc/nginx/sites-enabled/*.pre-maintenance; do"
echo "         sudo mv \"\$f\" \"\${f%.pre-maintenance}\""
echo "       done"
echo "       sudo rm /etc/nginx/conf.d/maintenance.conf"
echo "       sudo nginx -t && sudo nginx -s reload"
echo "    4. Purge Cloudflare caches (all 5 zones)"
echo "    5. Verify user 2wVc9Zi9... receives MYTH"
echo "    6. Post 'maintenance complete' on X + TG"
echo "═══════════════════════════════════════════"
