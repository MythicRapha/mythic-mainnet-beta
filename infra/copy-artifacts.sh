#!/usr/bin/env bash
# copy-artifacts.sh — SCP genesis + BPF programs from Server 1 to Server 2
#
# Run FROM Server 1 (20.96.180.64):
#   bash /mnt/data/mythic-l2/infra/copy-artifacts.sh
#
# Or run FROM local machine (adjust PEM path):
#   SERVER1_SSH="ssh -i mythic-l2-rpc_key.pem mythic@20.96.180.64"
set -euo pipefail

SERVER2_IP="20.49.10.158"
SERVER2_USER="mythic"
SERVER2_KEY="/mnt/data/mythic-l2/mythic-rpc_key.pem"

DEPLOY_DIR="/mnt/data/mythic-l2/target/deploy"
LEDGER_DIR="/mnt/data/mythic-l2/production-ledger"
REMOTE_BASE="/mnt/data/mythic-l2"

SSH_OPTS="-i ${SERVER2_KEY} -o StrictHostKeyChecking=no -o ConnectTimeout=15"
SCP_CMD="scp ${SSH_OPTS}"
SSH_CMD="ssh ${SSH_OPTS} ${SERVER2_USER}@${SERVER2_IP}"

echo "=== Copy Artifacts: Server 1 -> Server 2 ==="
echo "Target: ${SERVER2_USER}@${SERVER2_IP}"
echo ""

# ── Step 1: Create remote directories ──────────────────────────────────────

echo "[1/4] Creating remote directories..."
${SSH_CMD} "mkdir -p ${REMOTE_BASE}/target/deploy ${REMOTE_BASE}/production-ledger ${REMOTE_BASE}/keys"
echo "  Done."

# ── Step 2: Copy genesis artifacts ─────────────────────────────────────────

echo "[2/4] Copying genesis artifacts..."

GENESIS_FILES=(
    "${LEDGER_DIR}/genesis.bin"
    "${LEDGER_DIR}/genesis.tar.bz2"
)

for f in "${GENESIS_FILES[@]}"; do
    if [ -f "$f" ]; then
        echo "  $(basename "$f") ($(du -h "$f" | cut -f1))..."
        ${SCP_CMD} "$f" "${SERVER2_USER}@${SERVER2_IP}:${REMOTE_BASE}/production-ledger/"
    else
        echo "  WARNING: $f not found, skipping."
    fi
done
echo "  Genesis artifacts copied."

# ── Step 3: Copy all 11 BPF program .so files ─────────────────────────────

echo "[3/4] Copying BPF program binaries..."

PROGRAMS=(
    "mythic_bridge.so"
    "mythic_bridge_l2.so"
    "mythic_ai_precompiles.so"
    "mythic_compute_market.so"
    "mythic_settlement.so"
    "mythic_token.so"
    "mythic_launchpad.so"
    "mythic_swap.so"
    "mythic_staking.so"
    "mythic_governance.so"
    "mythic_airdrop.so"
)

COPIED=0
MISSING=0
for prog in "${PROGRAMS[@]}"; do
    src="${DEPLOY_DIR}/${prog}"
    if [ -f "${src}" ]; then
        echo "  ${prog} ($(du -h "${src}" | cut -f1))..."
        ${SCP_CMD} "${src}" "${SERVER2_USER}@${SERVER2_IP}:${REMOTE_BASE}/target/deploy/"
        COPIED=$((COPIED + 1))
    else
        echo "  WARNING: ${prog} not found at ${src}"
        MISSING=$((MISSING + 1))
    fi
done
echo "  Copied ${COPIED}/11 programs. Missing: ${MISSING}."

# ── Step 4: Copy validator identity keypair ────────────────────────────────

echo "[4/4] Copying validator keypairs (for reference)..."

# Copy the production validator identity so Server 2 can verify genesis
if [ -f "${LEDGER_DIR}/validator-keypair.json" ]; then
    ${SCP_CMD} "${LEDGER_DIR}/validator-keypair.json" \
        "${SERVER2_USER}@${SERVER2_IP}:${REMOTE_BASE}/production-ledger/"
    echo "  Copied validator-keypair.json"
fi

# Server 2 needs its own identity — generate if not present
${SSH_CMD} << 'REMOTE'
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
if [ ! -f /mnt/data/mythic-l2/keys/server2-identity.json ]; then
    solana-keygen new --no-bip39-passphrase -o /mnt/data/mythic-l2/keys/server2-identity.json 2>/dev/null
    echo "  Generated new Server 2 validator identity:"
    solana-keygen pubkey /mnt/data/mythic-l2/keys/server2-identity.json
else
    echo "  Server 2 identity already exists:"
    solana-keygen pubkey /mnt/data/mythic-l2/keys/server2-identity.json
fi
REMOTE

echo ""
echo "=== Artifact copy complete ==="
echo "Verify on Server 2:"
echo "  ssh ${SSH_OPTS} ${SERVER2_USER}@${SERVER2_IP} 'ls -lh ${REMOTE_BASE}/target/deploy/ ${REMOTE_BASE}/production-ledger/genesis.*'"
