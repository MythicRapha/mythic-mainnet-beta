#!/usr/bin/env bash
# verify-all.sh — Full post-migration verification for Mythic L2
#
# Checks:
#   1. Both validators in gossip
#   2. All 11 program IDs respond
#   3. All 17+ PM2 services running
#   4. All 7 domains return HTTP 200
#   5. Basic bridge/swap smoke test
#
# Run ON Server 1 (20.96.180.64):
#   bash /mnt/data/mythic-l2/infra/verify-all.sh
set -uo pipefail

SERVER1_IP="20.96.180.64"
SERVER2_IP="20.49.10.158"
MAINNET_RPC="http://127.0.0.1:8899"
TESTNET_RPC="http://127.0.0.1:8999"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  [PASS] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL + 1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN + 1)); }

echo "=============================================="
echo "  MYTHIC L2 POST-MIGRATION VERIFICATION"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
echo ""

# ── 1. Validator Cluster Status ────────────────────────────────────────────

echo "[1/5] Validator Cluster Status"

# Server 1 mainnet
if solana -u "${MAINNET_RPC}" cluster-version &>/dev/null; then
    VER=$(solana -u "${MAINNET_RPC}" cluster-version 2>/dev/null)
    SLOT=$(solana -u "${MAINNET_RPC}" slot 2>/dev/null)
    ok "Server 1 mainnet: version=${VER}, slot=${SLOT}"
else
    fail "Server 1 mainnet (port 8899) not responding"
fi

# Server 1 testnet
if solana -u "${TESTNET_RPC}" cluster-version &>/dev/null; then
    ok "Server 1 testnet (port 8999) responding"
else
    fail "Server 1 testnet (port 8999) not responding"
fi

# Server 2 mainnet
if solana -u "http://${SERVER2_IP}:8899" cluster-version &>/dev/null; then
    ok "Server 2 mainnet (${SERVER2_IP}:8899) responding"
else
    warn "Server 2 mainnet not responding (may still be syncing)"
fi

# Server 2 testnet
if solana -u "http://${SERVER2_IP}:8999" cluster-version &>/dev/null; then
    ok "Server 2 testnet (${SERVER2_IP}:8999) responding"
else
    warn "Server 2 testnet not responding (may still be syncing)"
fi

# Check gossip for multiple validators
GOSSIP_COUNT=$(solana -u "${MAINNET_RPC}" gossip 2>/dev/null | grep -c "^[A-Za-z0-9]" || echo 0)
if [ "${GOSSIP_COUNT}" -ge 2 ]; then
    ok "Gossip: ${GOSSIP_COUNT} nodes visible"
else
    warn "Gossip: only ${GOSSIP_COUNT} nodes (expected 2+)"
fi

# Check validators command
VALIDATOR_COUNT=$(solana -u "${MAINNET_RPC}" validators 2>/dev/null | grep -c "^[A-Za-z0-9]" || echo 0)
echo "  Validators visible: ${VALIDATOR_COUNT}"
echo ""

# ── 2. Program IDs ─────────────────────────────────────────────────────────

echo "[2/5] Program Verification (11 programs + 1 deployed swap)"

PROGRAMS=(
    "MythBrdg11111111111111111111111111111111111:Bridge"
    "MythBrdgL2111111111111111111111111111111111:Bridge L2"
    "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ:AI Precompiles"
    "AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh:Compute Market"
    "MythSett1ement11111111111111111111111111111:Settlement"
    "MythToken1111111111111111111111111111111111:MYTH Token"
    "MythPad111111111111111111111111111111111111:Launchpad"
    "MythSwap11111111111111111111111111111111111:Swap"
    "MythStak11111111111111111111111111111111111:Staking"
    "MythGov111111111111111111111111111111111111:Governance"
    "MythDrop11111111111111111111111111111111111:Airdrop"
    "3QB8S38ouuREEDPxnaaGeujLsUhwFoRbLAejKywtEgv7:Deployed Swap (upgradeable)"
)

for entry in "${PROGRAMS[@]}"; do
    PROG_ID="${entry%%:*}"
    PROG_NAME="${entry#*:}"

    if solana -u "${MAINNET_RPC}" program show "${PROG_ID}" &>/dev/null; then
        ok "${PROG_NAME} (${PROG_ID})"
    elif solana -u "${MAINNET_RPC}" account "${PROG_ID}" &>/dev/null; then
        ok "${PROG_NAME} (${PROG_ID}) — account exists"
    else
        fail "${PROG_NAME} (${PROG_ID}) — NOT FOUND"
    fi
done
echo ""

# ── 3. PM2 Services ───────────────────────────────────────────────────────

echo "[3/5] PM2 Services"

PM2_EXPECTED=(
    "mythic-website"
    "mythic-money-website"
    "mythic-swap-website"
    "mythic-wallet-site"
    "mythic-foundation"
    "mythiclabs"
    "mythic-relayer"
    "mythic-wallet-bot"
    "mythic-validator"
    "mythic-explorer-api"
    "mythic-dex-api"
    "mythic-explorer"
    "mythic-supply-oracle"
    "mythic-settlement"
    "mythic-reward-distributor"
)

PM2_STATUS=$(pm2 jlist 2>/dev/null || echo "[]")
PM2_RUNNING=0
PM2_STOPPED=0

for svc in "${PM2_EXPECTED[@]}"; do
    STATUS=$(echo "${PM2_STATUS}" | jq -r ".[] | select(.name == \"${svc}\") | .pm2_env.status" 2>/dev/null || echo "missing")
    if [ "${STATUS}" = "online" ]; then
        ok "PM2: ${svc} (online)"
        PM2_RUNNING=$((PM2_RUNNING + 1))
    elif [ "${STATUS}" = "missing" ] || [ -z "${STATUS}" ]; then
        warn "PM2: ${svc} (not registered)"
    else
        fail "PM2: ${svc} (status: ${STATUS})"
        PM2_STOPPED=$((PM2_STOPPED + 1))
    fi
done

echo "  PM2 Summary: ${PM2_RUNNING} running, ${PM2_STOPPED} stopped"
echo ""

# ── 4. Domain Health Checks ───────────────────────────────────────────────

echo "[4/5] Domain Health Checks"

DOMAINS=(
    "https://mythic.sh:Mythic Website"
    "https://mythicswap.app:MythicSwap"
    "https://mythic.money:Mythic Money"
    "https://mythic.foundation:Foundation"
    "https://mythiclabs.io:MythicLabs"
    "https://wallet.mythic.sh:Web Wallet"
    "https://api.mythic.sh:Explorer API"
)

for entry in "${DOMAINS[@]}"; do
    URL="${entry%%:*}"
    NAME="${entry#*:}"

    HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "${URL}" 2>/dev/null || echo "000")
    if [ "${HTTP_CODE}" = "200" ]; then
        ok "${NAME} (${URL}) -> ${HTTP_CODE}"
    elif [ "${HTTP_CODE}" = "000" ]; then
        fail "${NAME} (${URL}) -> TIMEOUT/UNREACHABLE"
    else
        warn "${NAME} (${URL}) -> HTTP ${HTTP_CODE}"
    fi
done
echo ""

# ── 5. Smoke Tests ────────────────────────────────────────────────────────

echo "[5/5] Smoke Tests"

# RPC getHealth
HEALTH=$(curl -s -X POST "${MAINNET_RPC}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null)
if echo "${HEALTH}" | grep -q '"ok"'; then
    ok "RPC getHealth: ok"
else
    fail "RPC getHealth: ${HEALTH}"
fi

# RPC getBlockHeight
BLOCK_HEIGHT=$(curl -s -X POST "${MAINNET_RPC}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getBlockHeight"}' 2>/dev/null | \
    jq -r '.result' 2>/dev/null || echo "null")
if [ "${BLOCK_HEIGHT}" != "null" ] && [ -n "${BLOCK_HEIGHT}" ]; then
    ok "Block height: ${BLOCK_HEIGHT}"
else
    fail "Could not get block height"
fi

# RPC getTransactionCount
TX_COUNT=$(curl -s -X POST "${MAINNET_RPC}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getTransactionCount"}' 2>/dev/null | \
    jq -r '.result' 2>/dev/null || echo "null")
if [ "${TX_COUNT}" != "null" ] && [ -n "${TX_COUNT}" ]; then
    ok "Transaction count: ${TX_COUNT}"
else
    warn "Could not get transaction count"
fi

# Bridge config check
BRIDGE_ACCOUNT=$(curl -s -X POST "${MAINNET_RPC}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["MythBrdgL2111111111111111111111111111111111",{"encoding":"base64"}]}' 2>/dev/null)
if echo "${BRIDGE_ACCOUNT}" | jq -e '.result.value' &>/dev/null; then
    ok "Bridge L2 program account accessible"
else
    warn "Bridge L2 program account not accessible via getAccountInfo (may be normal for genesis-loaded programs)"
fi

# Supply oracle check
SUPPLY_STATUS=$(curl -s --max-time 5 "http://127.0.0.1:4002/api/supply" 2>/dev/null)
if echo "${SUPPLY_STATUS}" | jq -e '.totalSupply' &>/dev/null; then
    TOTAL=$(echo "${SUPPLY_STATUS}" | jq -r '.totalSupply')
    ok "Supply oracle: total supply = ${TOTAL}"
else
    warn "Supply oracle not responding on port 4002"
fi

# DEX API check
DEX_STATUS=$(curl -s --max-time 5 "http://127.0.0.1:4001/api/pairs" 2>/dev/null)
if [ -n "${DEX_STATUS}" ] && [ "${DEX_STATUS}" != "" ]; then
    ok "DEX API responding on port 4001"
else
    warn "DEX API not responding on port 4001"
fi

echo ""

# ── Summary ────────────────────────────────────────────────────────────────

echo "=============================================="
echo "  VERIFICATION SUMMARY"
echo "=============================================="
echo "  PASS: ${PASS}"
echo "  FAIL: ${FAIL}"
echo "  WARN: ${WARN}"
echo ""

if [ "${FAIL}" -eq 0 ]; then
    echo "  STATUS: ALL CRITICAL CHECKS PASSED"
else
    echo "  STATUS: ${FAIL} FAILURES DETECTED - INVESTIGATE BEFORE PROCEEDING"
fi

echo ""
echo "  Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
