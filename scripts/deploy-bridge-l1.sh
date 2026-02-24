#!/bin/bash
# Deploy L1 Bridge Program to Solana Mainnet
# Deployer: 4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s
# Program:  oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ
set -e

KEYPAIR="/mnt/data/mythic-l2/keys/deployer.json"
PROGRAM_KEYPAIR="/mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json"
SO_FILE="/mnt/data/mythic-l2/target/deploy/mythic_bridge.so"
RPC="${HELIUS_RPC_URL:?Set HELIUS_RPC_URL env var}"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== L1 Bridge Deployment ==="
echo "Deployer: $(solana address -k $KEYPAIR)"
echo "Program:  $(solana address -k $PROGRAM_KEYPAIR)"
echo "Binary:   $SO_FILE ($(wc -c < $SO_FILE) bytes)"
echo ""

# Check balance
BAL=$(solana balance -k $KEYPAIR -u $RPC | awk '{print $1}')
echo "Current balance: $BAL SOL"

if (( $(echo "$BAL < 2" | bc -l) )); then
    echo "ERROR: Need at least 2 SOL. Current: $BAL"
    exit 1
fi

echo ""
echo "Deploying program..."
solana program deploy \
    --keypair $KEYPAIR \
    --program-id $PROGRAM_KEYPAIR \
    --url $RPC \
    --with-compute-unit-price 1000 \
    --max-sign-attempts 20 \
    $SO_FILE

echo ""
echo "=== Deployment Complete ==="
echo "Program ID: $(solana address -k $PROGRAM_KEYPAIR)"
echo "Remaining balance: $(solana balance -k $KEYPAIR -u $RPC)"
