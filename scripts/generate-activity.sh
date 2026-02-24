#\!/bin/bash
# Generate diverse testnet transactions for explorer
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

URL="http://localhost:8899"
FP="/mnt/data/mythic-l2/keys/foundation.json"
DEPLOYER="/mnt/data/mythic-l2/keys/deployer.json"
SEQUENCER="/mnt/data/mythic-l2/keys/sequencer-identity.json"
WDIR="/mnt/data/mythic-l2/keys/test-wallets"

WALLETS=()
for i in $(seq 1 10); do
  WALLETS+=("$WDIR/wallet-${i}.json")
done

# Mint addresses
MYTH="7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq"
wSOL="FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3"
USDC="6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN"
USDT="FL4ZHaWPSZzyiqXHm8Md5bPTfKoHWEmSBD7djSN5CiX5"
wETH="4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT"
wBTC="8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw"
BONK="ACgXqCfq6Nu8qpWKEsXGreCRjnBxSq7WLhKJTdv8J8Dt"
PYTH="8A7LWttCewVMm3eaNyra8n8ofXFnSq5eePNEZTbxLHdJ"
JUP="4S9ZjZyaZrmchfXfmZHWKdLkPHsrPRmddtvN79t8LjsM"

MINTS=($MYTH $wSOL $USDC $USDT $wETH $wBTC $BONK $PYTH $JUP)
MINT_NAMES=(MYTH wSOL USDC USDT wETH wBTC BONK PYTH JUP)
# Token amounts appropriate for each decimal: 9,9,6,6,8,8,5,6,6
AMOUNTS=(100000 1000 50000 50000 10 0.1 10000000000 100000 100000)

TX_COUNT=0

echo "=== Phase 1: Fund 10 test wallets with SOL ==="
for w in "${WALLETS[@]}"; do
  addr=$(solana-keygen pubkey "$w")
  solana transfer "$addr" 1000 --from "$FP" --url "$URL" --allow-unfunded-recipient --fee-payer "$FP" 2>&1 | grep -o "Signature:.*" || true
  TX_COUNT=$((TX_COUNT + 1))
done
echo "Phase 1 done: $TX_COUNT txs"

echo ""
echo "=== Phase 2: SOL transfers between wallets ==="
for i in $(seq 0 9); do
  next=$(( (i + 1) % 10 ))
  from_w="${WALLETS[$i]}"
  to_addr=$(solana-keygen pubkey "${WALLETS[$next]}")
  # Random-ish amounts
  amt=$((RANDOM % 50 + 1))
  solana transfer "$to_addr" "$amt" --from "$from_w" --url "$URL" --fee-payer "$from_w" 2>&1 | grep -o "Signature:.*" || true
  TX_COUNT=$((TX_COUNT + 1))
done
echo "Phase 2 done: $TX_COUNT txs"

echo ""
echo "=== Phase 3: Create token accounts and mint tokens to test wallets ==="
for mi in $(seq 0 8); do
  mint="${MINTS[$mi]}"
  name="${MINT_NAMES[$mi]}"
  amt="${AMOUNTS[$mi]}"
  # Mint to first 5 wallets
  for wi in $(seq 0 4); do
    w="${WALLETS[$wi]}"
    waddr=$(solana-keygen pubkey "$w")
    # Create ATA
    spl-token create-account "$mint" --url "$URL" --fee-payer "$FP" --owner "$waddr" 2>&1 | grep -o "Creating account.*\|account already exists" || true
    TX_COUNT=$((TX_COUNT + 1))
    # Mint tokens
    spl-token mint "$mint" "$amt" --url "$URL" --fee-payer "$FP" --mint-authority "$FP" --recipient-owner "$waddr" 2>&1 | grep -o "Minting.*tokens" || true
    TX_COUNT=$((TX_COUNT + 1))
  done
  echo "  $name: minted to 5 wallets"
done
echo "Phase 3 done: $TX_COUNT txs"

echo ""
echo "=== Phase 4: Token transfers between wallets ==="
# Transfer MYTH and USDC between wallets
for wi in $(seq 0 3); do
  next=$(( wi + 1 ))
  from_w="${WALLETS[$wi]}"
  to_addr=$(solana-keygen pubkey "${WALLETS[$next]}")
  
  # MYTH transfer
  spl-token transfer "$MYTH" 1000 "$to_addr" --url "$URL" --fee-payer "$from_w" --owner "$from_w" --fund-recipient --allow-unfunded-recipient 2>&1 | grep -o "Transfer.*\|Signature:.*" || true
  TX_COUNT=$((TX_COUNT + 1))
  
  # USDC transfer
  spl-token transfer "$USDC" 500 "$to_addr" --url "$URL" --fee-payer "$from_w" --owner "$from_w" --fund-recipient --allow-unfunded-recipient 2>&1 | grep -o "Transfer.*\|Signature:.*" || true
  TX_COUNT=$((TX_COUNT + 1))
  
  # wSOL transfer
  spl-token transfer "$wSOL" 10 "$to_addr" --url "$URL" --fee-payer "$from_w" --owner "$from_w" --fund-recipient --allow-unfunded-recipient 2>&1 | grep -o "Transfer.*\|Signature:.*" || true
  TX_COUNT=$((TX_COUNT + 1))
done
echo "Phase 4 done: $TX_COUNT txs"

echo ""
echo "=== Phase 5: More SOL transfers (round-robin) ==="
for round in $(seq 1 5); do
  for i in $(seq 0 9); do
    target=$(( (i + round) % 10 ))
    from_w="${WALLETS[$i]}"
    to_addr=$(solana-keygen pubkey "${WALLETS[$target]}")
    amt=$((RANDOM % 10 + 1))
    solana transfer "$to_addr" "$amt" --from "$from_w" --url "$URL" --fee-payer "$from_w" 2>&1 | grep -o "Signature:.*" || true
    TX_COUNT=$((TX_COUNT + 1))
  done
done
echo "Phase 5 done: $TX_COUNT txs"

echo ""
echo "=== Phase 6: Foundation distributes tokens to deployer and sequencer ==="
DEPLOYER_ADDR=$(solana-keygen pubkey "$DEPLOYER")
SEQ_ADDR=$(solana-keygen pubkey "$SEQUENCER")

for mint in $MYTH $USDC $wSOL; do
  for addr in "$DEPLOYER_ADDR" "$SEQ_ADDR"; do
    spl-token create-account "$mint" --url "$URL" --fee-payer "$FP" --owner "$addr" 2>&1 | grep -o "Creating account.*" || true
    TX_COUNT=$((TX_COUNT + 1))
  done
done

spl-token mint "$MYTH" 50000000 --url "$URL" --fee-payer "$FP" --mint-authority "$FP" --recipient-owner "$DEPLOYER_ADDR" 2>&1 | grep -o "Minting.*" || true
TX_COUNT=$((TX_COUNT + 1))
spl-token mint "$MYTH" 10000000 --url "$URL" --fee-payer "$FP" --mint-authority "$FP" --recipient-owner "$SEQ_ADDR" 2>&1 | grep -o "Minting.*" || true
TX_COUNT=$((TX_COUNT + 1))
spl-token mint "$USDC" 5000000 --url "$URL" --fee-payer "$FP" --mint-authority "$FP" --recipient-owner "$DEPLOYER_ADDR" 2>&1 | grep -o "Minting.*" || true
TX_COUNT=$((TX_COUNT + 1))
spl-token mint "$wSOL" 10000 --url "$URL" --fee-payer "$FP" --mint-authority "$FP" --recipient-owner "$DEPLOYER_ADDR" 2>&1 | grep -o "Minting.*" || true
TX_COUNT=$((TX_COUNT + 1))

echo "Phase 6 done: $TX_COUNT txs"

echo ""
echo "=== TOTAL TRANSACTIONS GENERATED: $TX_COUNT ==="
