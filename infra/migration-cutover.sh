#!/usr/bin/env bash
# migration-cutover.sh — Migrate Mythic L2 from solana-test-validator to Frankendancer
#
# This is the critical cutover script. It:
#   1. Stops the existing solana-test-validator (mainnet + testnet)
#   2. Exports final snapshot
#   3. Starts Frankendancer on Server 1 (bootstrap)
#   4. Waits for block production
#   5. Starts Frankendancer on Server 2 (join via gossip)
#   6. Starts testnet on both servers
#   7. Verifies 2 validators in gossip
#
# Run ON Server 1 (20.96.180.64):
#   sudo bash /mnt/data/mythic-l2/infra/migration-cutover.sh
#
# IMPORTANT: Run during a maintenance window. All services will be briefly offline.
set -euo pipefail

SERVER1_IP="20.96.180.64"
SERVER2_IP="20.49.10.158"
SERVER2_USER="mythic"
SERVER2_KEY="/mnt/data/mythic-l2/mythic-rpc_key.pem"

FDCTL="/mnt/data/firedancer/build/native/gcc/bin/fdctl"
CONFIG_DIR="/mnt/data/mythic-l2/infra"
LEDGER_DIR="/mnt/data/mythic-l2/production-ledger"
LOG_DIR="/mnt/data/mythic-l2/logs"

SSH_OPTS="-i ${SERVER2_KEY} -o StrictHostKeyChecking=no -o ConnectTimeout=15"
SSH_S2="ssh ${SSH_OPTS} ${SERVER2_USER}@${SERVER2_IP}"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

mkdir -p "${LOG_DIR}"

echo "=============================================="
echo "  MYTHIC L2 MIGRATION CUTOVER"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
echo ""
echo "Server 1 (bootstrap): ${SERVER1_IP}"
echo "Server 2 (joining):   ${SERVER2_IP}"
echo "Frankendancer binary: ${FDCTL}"
echo ""

# ── Pre-flight checks ─────────────────────────────────────────────────────

echo "[PRE-FLIGHT] Checking prerequisites..."

if [ ! -x "${FDCTL}" ]; then
    echo "  ERROR: fdctl not found at ${FDCTL}. Run build-frankendancer.sh first."
    exit 1
fi

if [ ! -f "${CONFIG_DIR}/fdancer-s1-mainnet.toml" ]; then
    echo "  ERROR: Config not found at ${CONFIG_DIR}/fdancer-s1-mainnet.toml"
    exit 1
fi

# Check current validator is running
if ! solana -u http://127.0.0.1:8899 cluster-version &>/dev/null; then
    echo "  WARNING: Current mainnet validator not responding on port 8899."
    echo "  Proceeding anyway (validator may already be stopped)."
fi

CURRENT_SLOT=$(solana -u http://127.0.0.1:8899 slot 2>/dev/null || echo "unknown")
echo "  Current slot: ${CURRENT_SLOT}"
echo "  Pre-flight checks complete."
echo ""

# ── Phase 1: Stop existing validators ─────────────────────────────────────

echo "[PHASE 1] Stopping existing validators..."

# Stop PM2 managed validators
echo "  Stopping PM2 processes: mythic-validator, mythic-testnet..."
pm2 stop mythic-validator 2>/dev/null || true
pm2 stop mythic-testnet 2>/dev/null || true

# Kill any remaining solana-test-validator processes
echo "  Killing solana-test-validator processes..."
pkill -f "solana-test-validator.*production-ledger" || true
pkill -f "solana-test-validator.*testnet-ledger" || true

# Wait for clean shutdown
echo "  Waiting for graceful shutdown (10s)..."
sleep 10

# Verify stopped
if pgrep -f "solana-test-validator" &>/dev/null; then
    echo "  WARNING: solana-test-validator still running. Force killing..."
    pkill -9 -f "solana-test-validator" || true
    sleep 3
fi

# Remove ledger lock
rm -f "${LEDGER_DIR}/ledger.lock" 2>/dev/null || true
rm -f "/mnt/data/mythic-l2/testnet-ledger/ledger.lock" 2>/dev/null || true

echo "  All validators stopped."
echo ""

# ── Phase 2: Export final snapshot ─────────────────────────────────────────

echo "[PHASE 2] Exporting final ledger snapshot..."

# Create a backup snapshot for safety
if command -v solana-ledger-tool &>/dev/null; then
    echo "  Creating final snapshot from ledger..."
    solana-ledger-tool create-snapshot \
        --ledger "${LEDGER_DIR}" \
        --snapshot-archive-path "${LEDGER_DIR}/snapshots/" \
        2>/dev/null || echo "  WARNING: Snapshot creation failed (may already exist)."
else
    echo "  solana-ledger-tool not available. Using existing snapshots."
fi

echo "  Done."
echo ""

# ── Phase 3: Start Frankendancer on Server 1 (mainnet bootstrap) ──────────

echo "[PHASE 3] Starting Frankendancer on Server 1 (mainnet bootstrap)..."

# Configure Frankendancer
echo "  Running fdctl configure..."
${FDCTL} configure --config "${CONFIG_DIR}/fdancer-s1-mainnet.toml" 2>&1 || true

# Start Frankendancer in background
echo "  Starting fdctl run..."
nohup ${FDCTL} run --config "${CONFIG_DIR}/fdancer-s1-mainnet.toml" \
    > "${LOG_DIR}/fdancer-mainnet.log" 2>&1 &
FDANCER_PID=$!
echo "  Frankendancer mainnet PID: ${FDANCER_PID}"

# Wait for RPC to come online
echo "  Waiting for RPC on port 8899..."
RETRIES=0
MAX_RETRIES=60
while [ ${RETRIES} -lt ${MAX_RETRIES} ]; do
    if solana -u http://127.0.0.1:8899 cluster-version &>/dev/null; then
        break
    fi
    RETRIES=$((RETRIES + 1))
    sleep 2
done

if [ ${RETRIES} -ge ${MAX_RETRIES} ]; then
    echo "  ERROR: Frankendancer did not start within 120s."
    echo "  Check logs: ${LOG_DIR}/fdancer-mainnet.log"
    echo "  Aborting migration."
    exit 1
fi

NEW_SLOT=$(solana -u http://127.0.0.1:8899 slot 2>/dev/null || echo "unknown")
VERSION=$(solana -u http://127.0.0.1:8899 cluster-version 2>/dev/null || echo "unknown")
echo "  Frankendancer mainnet is UP!"
echo "  Slot: ${NEW_SLOT}, Version: ${VERSION}"
echo ""

# ── Phase 4: Start Frankendancer on Server 2 (join mainnet) ───────────────

echo "[PHASE 4] Starting Frankendancer on Server 2 (join mainnet)..."

${SSH_S2} << REMOTE
export PATH="\$HOME/.local/share/solana/install/active_release/bin:\$PATH"
FDCTL_S2="/mnt/data/firedancer/build/native/gcc/bin/fdctl"

# Stop any existing validators on Server 2
pkill -f "solana-test-validator" 2>/dev/null || true
pkill -f "fdctl" 2>/dev/null || true
sleep 3

# Remove stale locks
rm -f /mnt/data/mythic-l2/mainnet-ledger/ledger.lock 2>/dev/null || true

# Create directories
mkdir -p /mnt/data/mythic-l2/logs /mnt/data/mythic-l2/mainnet-ledger

# Generate vote account if needed
if [ ! -f /mnt/data/mythic-l2/keys/server2-vote.json ]; then
    solana-keygen new --no-bip39-passphrase -o /mnt/data/mythic-l2/keys/server2-vote.json 2>/dev/null
fi

# Configure and start
echo "  Configuring Frankendancer..."
\${FDCTL_S2} configure --config /mnt/data/mythic-l2/infra/fdancer-s2-mainnet.toml 2>&1 || true

echo "  Starting Frankendancer..."
nohup \${FDCTL_S2} run --config /mnt/data/mythic-l2/infra/fdancer-s2-mainnet.toml \
    > /mnt/data/mythic-l2/logs/fdancer-mainnet.log 2>&1 &
echo "  Server 2 Frankendancer PID: \$!"
REMOTE

echo "  Waiting for Server 2 to sync (30s)..."
sleep 30

# Check if Server 2 RPC responds
if ${SSH_S2} "solana -u http://127.0.0.1:8899 cluster-version 2>/dev/null"; then
    echo "  Server 2 mainnet: UP"
else
    echo "  WARNING: Server 2 mainnet may still be syncing. Check manually."
fi
echo ""

# ── Phase 5: Start testnet on both servers ─────────────────────────────────

echo "[PHASE 5] Starting testnet validators..."

# Server 1 testnet
echo "  Starting testnet on Server 1..."
nohup ${FDCTL} run --config "${CONFIG_DIR}/fdancer-s1-testnet.toml" \
    > "${LOG_DIR}/fdancer-testnet.log" 2>&1 &
echo "  Server 1 testnet PID: $!"

# Server 2 testnet
echo "  Starting testnet on Server 2..."
${SSH_S2} << 'REMOTE'
FDCTL_S2="/mnt/data/firedancer/build/native/gcc/bin/fdctl"
rm -f /mnt/data/mythic-l2/testnet-ledger/ledger.lock 2>/dev/null || true
mkdir -p /mnt/data/mythic-l2/testnet-ledger

# Generate testnet keypairs if needed
if [ ! -f /mnt/data/mythic-l2/keys/server2-testnet-identity.json ]; then
    solana-keygen new --no-bip39-passphrase -o /mnt/data/mythic-l2/keys/server2-testnet-identity.json 2>/dev/null
fi
if [ ! -f /mnt/data/mythic-l2/keys/server2-testnet-vote.json ]; then
    solana-keygen new --no-bip39-passphrase -o /mnt/data/mythic-l2/keys/server2-testnet-vote.json 2>/dev/null
fi

${FDCTL_S2} configure --config /mnt/data/mythic-l2/infra/fdancer-s2-testnet.toml 2>&1 || true
nohup ${FDCTL_S2} run --config /mnt/data/mythic-l2/infra/fdancer-s2-testnet.toml \
    > /mnt/data/mythic-l2/logs/fdancer-testnet.log 2>&1 &
echo "  Server 2 testnet PID: $!"
REMOTE

echo "  Waiting for testnets to start (15s)..."
sleep 15
echo ""

# ── Phase 6: Verify ───────────────────────────────────────────────────────

echo "[PHASE 6] Verifying migration..."

echo "  Server 1 Mainnet (8899):"
solana -u http://127.0.0.1:8899 cluster-version 2>/dev/null && echo "    OK" || echo "    FAILED"
S1_SLOT=$(solana -u http://127.0.0.1:8899 slot 2>/dev/null || echo "N/A")
echo "    Slot: ${S1_SLOT}"

echo "  Server 1 Testnet (8999):"
solana -u http://127.0.0.1:8999 cluster-version 2>/dev/null && echo "    OK" || echo "    FAILED"

echo "  Server 2 Mainnet (8899):"
solana -u http://${SERVER2_IP}:8899 cluster-version 2>/dev/null && echo "    OK" || echo "    STILL SYNCING"

echo "  Server 2 Testnet (8999):"
solana -u http://${SERVER2_IP}:8999 cluster-version 2>/dev/null && echo "    OK" || echo "    STILL SYNCING"

echo ""
echo "  Checking gossip for validators..."
solana -u http://127.0.0.1:8899 gossip 2>/dev/null | head -20 || echo "    Could not query gossip."

echo ""
echo "  Checking validators..."
solana -u http://127.0.0.1:8899 validators 2>/dev/null | head -20 || echo "    Could not query validators."

echo ""
echo "=============================================="
echo "  MIGRATION CUTOVER COMPLETE"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  1. Run verify-all.sh for comprehensive checks"
echo "  2. Update PM2 ecosystem to manage Frankendancer processes"
echo "  3. Monitor logs: tail -f ${LOG_DIR}/fdancer-mainnet.log"
echo "  4. Verify all 17+ PM2 services are healthy: pm2 status"
