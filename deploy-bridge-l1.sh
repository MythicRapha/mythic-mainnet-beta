#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Deploy Mythic Bridge to Solana L1 Mainnet
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage:
#   ./deploy-bridge-l1.sh [RPC_URL]
#
# Prerequisites:
#   1. Fund deployer 4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s with ~5 SOL on mainnet
#   2. Rebuild the bridge .so if source has changed (this script does it automatically)
#   3. Provide a mainnet RPC URL that supports sendTransaction
#
# The program will deploy with ID from: target/deploy/mythic_bridge-keypair.json
# (NOT the vanity ID MythBrdg111... which was only used at L2 genesis)

RPC_URL="${1:-http://20.81.176.84:8899}"
DEPLOYER_KEY="/mnt/data/mythic-l2/keys/deployer.json"
BRIDGE_SO="/mnt/data/mythic-l2/target/deploy/mythic_bridge.so"
BRIDGE_KEYPAIR="/mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json"
SEQUENCER_KEY="/mnt/data/mythic-l2/keys/sequencer-identity.json"
PROJECT_DIR="/mnt/data/mythic-l2"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
source "$HOME/.cargo/env" 2>/dev/null || true

echo "========================================="
echo "  Mythic Bridge L1 Mainnet Deployment"
echo "========================================="
echo ""

# ── Step 0: Validate prerequisites ──────────────────────────────────────────

echo "[0/7] Validating prerequisites..."

if [ ! -f "$DEPLOYER_KEY" ]; then
    echo "ERROR: Deployer keypair not found at $DEPLOYER_KEY"
    exit 1
fi
if [ ! -f "$BRIDGE_KEYPAIR" ]; then
    echo "ERROR: Bridge program keypair not found at $BRIDGE_KEYPAIR"
    exit 1
fi
if [ ! -f "$SEQUENCER_KEY" ]; then
    echo "ERROR: Sequencer keypair not found at $SEQUENCER_KEY"
    exit 1
fi

DEPLOYER_PUBKEY=$(solana-keygen pubkey "$DEPLOYER_KEY")
BRIDGE_PROGRAM_ID=$(solana-keygen pubkey "$BRIDGE_KEYPAIR")
SEQUENCER_PUBKEY=$(solana-keygen pubkey "$SEQUENCER_KEY")

echo "  Deployer:    $DEPLOYER_PUBKEY"
echo "  Program ID:  $BRIDGE_PROGRAM_ID"
echo "  Sequencer:   $SEQUENCER_PUBKEY"
echo "  RPC URL:     $RPC_URL"
echo ""

# ── Step 1: Configure Solana CLI ─────────────────────────────────────────────

echo "[1/7] Configuring Solana CLI..."
solana config set --url "$RPC_URL" --keypair "$DEPLOYER_KEY" 2>&1 | grep -E "(RPC URL|Keypair Path)"
echo ""

# ── Step 2: Check deployer balance ──────────────────────────────────────────

echo "[2/7] Checking deployer balance..."
BALANCE=$(solana balance "$DEPLOYER_PUBKEY" 2>&1)
echo "  Balance: $BALANCE"

# Extract numeric balance
BAL_NUM=$(echo "$BALANCE" | grep -oP '[\d.]+' | head -1)
if (( $(echo "$BAL_NUM < 3.0" | bc -l 2>/dev/null || echo 1) )); then
    echo ""
    echo "WARNING: Deployer balance may be insufficient."
    echo "  Estimated cost: ~2.5 SOL (1.98 rent + 0.5 buffer for tx fees)"
    echo "  Send at least 5 SOL to: $DEPLOYER_PUBKEY"
    echo ""
    read -p "Continue anyway? (y/N): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        echo "Aborted."
        exit 1
    fi
fi
echo ""

# ── Step 3: Rebuild the bridge .so ──────────────────────────────────────────

echo "[3/7] Checking if bridge program needs rebuild..."
SO_TIME=0
SRC_TIME=0

if [ -f "$BRIDGE_SO" ]; then
    SO_TIME=$(stat -c '%Y' "$BRIDGE_SO" 2>/dev/null || stat -f '%m' "$BRIDGE_SO" 2>/dev/null)
fi
SRC_TIME=$(stat -c '%Y' "$PROJECT_DIR/programs/bridge/src/lib.rs" 2>/dev/null || stat -f '%m' "$PROJECT_DIR/programs/bridge/src/lib.rs" 2>/dev/null)

if [ "$SRC_TIME" -gt "$SO_TIME" ] || [ ! -f "$BRIDGE_SO" ]; then
    echo "  Source is newer than .so — rebuilding..."
    cd "$PROJECT_DIR"
    source "$HOME/.cargo/env" 2>/dev/null || true
    cargo build-sbf --manifest-path programs/bridge/Cargo.toml 2>&1 | tail -10
    echo "  Build complete."
else
    echo "  Bridge .so is up to date."
fi

echo "  Program size: $(wc -c < "$BRIDGE_SO") bytes"
echo ""

# ── Step 4: Estimate deployment cost ────────────────────────────────────────

echo "[4/7] Estimating deployment cost..."
PROGRAM_SIZE=$(wc -c < "$BRIDGE_SO")
# Program account stores 2x the .so size (for buffer during upgrades)
PROGRAM_DATA_SIZE=$((PROGRAM_SIZE * 2))
# Rent: 6.96 lamports per byte-epoch, 2 years = 1 epoch (simplified)
# Formula: (19.055441478439427 * data_size + 6960) / LAMPORTS_PER_SOL
# Simpler: solana rent $PROGRAM_DATA_SIZE
RENT_ESTIMATE=$(solana rent "$PROGRAM_DATA_SIZE" 2>&1 || echo "Could not estimate rent")
echo "  .so size:           $PROGRAM_SIZE bytes"
echo "  Buffer size (2x):   $PROGRAM_DATA_SIZE bytes"
echo "  Rent estimate:      $RENT_ESTIMATE"
echo "  + tx fees:          ~0.01 SOL"
echo "  Total estimated:    ~2.5 SOL"
echo ""

# ── Step 5: Deploy the program ──────────────────────────────────────────────

echo "[5/7] Deploying bridge program to mainnet..."
echo "  Program ID: $BRIDGE_PROGRAM_ID"
echo ""
read -p "  Confirm deployment to MAINNET? (type 'DEPLOY' to confirm): " CONFIRM
if [ "$CONFIRM" != "DEPLOY" ]; then
    echo "  Aborted."
    exit 1
fi

solana program deploy \
    --program-id "$BRIDGE_KEYPAIR" \
    --with-compute-unit-price 1000 \
    --max-sign-attempts 5 \
    "$BRIDGE_SO"

echo ""
echo "  Deployment submitted."
echo ""

# ── Step 6: Verify deployment ───────────────────────────────────────────────

echo "[6/7] Verifying deployment..."
solana program show "$BRIDGE_PROGRAM_ID"
echo ""

# ── Step 7: Initialize bridge config ────────────────────────────────────────

echo "[7/7] Initialize bridge config..."
echo ""
echo "  The bridge config PDA must be initialized with:"
echo "    Admin:            $DEPLOYER_PUBKEY"
echo "    Sequencer:        $SEQUENCER_PUBKEY"
echo "    Challenge period: 604800 (7 days)"
echo ""
echo "  Run the initialize instruction using the TypeScript client or CLI."
echo "  Example using @solana/web3.js:"
echo ""
echo "  const configPDA = PublicKey.findProgramAddressSync("
echo "    [Buffer.from('bridge_config')],"
echo "    new PublicKey('$BRIDGE_PROGRAM_ID')"
echo "  )[0];"
echo ""
echo "  // Instruction data: [0] ++ borsh(InitializeParams { sequencer, challenge_period })"
echo "  // Accounts: admin (signer), config_pda (writable), system_program"
echo ""

echo "========================================="
echo "  Deployment Summary"
echo "========================================="
echo "  Program ID:    $BRIDGE_PROGRAM_ID"
echo "  Deployer:      $DEPLOYER_PUBKEY"
echo "  Sequencer:     $SEQUENCER_PUBKEY"
echo "  RPC:           $RPC_URL"
echo ""
echo "  NEXT STEPS:"
echo "  1. Initialize the bridge config PDA"
echo "  2. Update relayer config to use this L1 program ID"
echo "  3. Update website bridge UI to use this L1 program ID"
echo "  4. Fund the SOL vault PDA for withdrawals"
echo "  5. Transfer admin authority to Ledger before going live"
echo "========================================="
