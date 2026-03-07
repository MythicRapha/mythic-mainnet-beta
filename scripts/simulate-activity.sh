#!/bin/bash
# simulate-activity.sh - Continuous L2 testnet activity generator
# Sends ~1 tx every 2-5 seconds with SOL + token transfers
set -uo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

URL="http://localhost:8899"
SEQUENCER="/mnt/data/mythic-l2/keys/sequencer-identity.json"
WDIR="/mnt/data/mythic-l2/keys/test-wallets"
LOGFILE="/mnt/data/mythic-l2/logs/activity-sim.log"

mkdir -p /mnt/data/mythic-l2/logs

NUM_WALLETS=10
WALLETS=()
ADDRS=()

# Token mints (sim tokens created on L2)
SIM_MINTS=(
  "8yQEVCxi1Xnyut1z7T77dj6djBXXiPBfc21tF67M8ATS"
  "FDig6D89fCFKNHALCV8jMdAx7qUemJvd4SGeqHZQ4CC1"
  "2wL7LoDnZeBUt6eNGP1RSs4FR8wqrmfFHeaAduunngtb"
  "H5ESdqMPgoonN8Fpj6VePupTV88St8H7McMFZvyVYuKJ"
  "GkT7KV5RP8fwd9TK3yntvhvdzVw3MR7xf4MX7npjsdw8"
  "65yL1ftY4T81xawBTtnwMutq7AyipNj3u26zEpjEDufv"
  "REzzgA6ghvhW6BZ18AcWTtgMs9sQBuCUcwgeNJq6WNY"
  "8mXjFfd1rcJZAnhG1HdkCptqpYxKL5sDfJtH5Qgop4yR"
)
SIM_NAMES=("MAI" "DGLD" "NEON" "SHFI" "ASWP" "PHNX" "CYBR" "QBIT")

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOGFILE"
}

# ─── Phase 0: Load wallets ───
log "=== Activity Simulator Starting ==="
for i in $(seq 1 $NUM_WALLETS); do
  kf="$WDIR/wallet-${i}.json"
  if [ ! -f "$kf" ]; then
    solana-keygen new --no-bip39-passphrase --outfile "$kf" --force 2>/dev/null
    log "Created wallet-$i"
  fi
  WALLETS+=("$kf")
  addr=$(solana-keygen pubkey "$kf")
  ADDRS+=("$addr")
done

log "Loaded ${#WALLETS[@]} wallets"

# ─── Phase 1: Ensure wallets funded ───
log "=== Checking wallet funding ==="
for i in $(seq 0 $((NUM_WALLETS - 1))); do
  bal=$(solana balance "${ADDRS[$i]}" --url "$URL" 2>/dev/null | grep -oP '[\d.]+' || echo "0")
  if (( $(echo "$bal < 50" | bc -l 2>/dev/null || echo 1) )); then
    log "Funding wallet-$((i+1)) with 500 SOL..."
    solana transfer "${ADDRS[$i]}" 500 \
      --from "$SEQUENCER" --url "$URL" \
      --allow-unfunded-recipient --fee-payer "$SEQUENCER" \
      --no-wait 2>&1 >/dev/null || true
    sleep 0.3
  fi
done

log "=== Starting continuous activity loop ==="

TX_COUNT=0
ROUND=0
ERRORS=0

while true; do
  ROUND=$((ROUND + 1))

  # Pick random sender and receiver (different)
  sender_idx=$((RANDOM % NUM_WALLETS))
  recv_idx=$(( (sender_idx + 1 + RANDOM % (NUM_WALLETS - 1)) % NUM_WALLETS ))

  sender_kf="${WALLETS[$sender_idx]}"
  recv_addr="${ADDRS[$recv_idx]}"

  # Decide transaction type
  roll=$((RANDOM % 100))

  if [ $roll -lt 50 ]; then
    # === SOL transfer (50%) ===
    whole=$((RANDOM % 3))
    frac=$(printf '%03d' $((RANDOM % 1000)))
    amount="${whole}.${frac}"
    if [ "$whole" -eq 0 ] && [ "$frac" = "000" ]; then amount="0.001"; fi

    solana transfer "$recv_addr" "$amount" \
      --from "$sender_kf" --url "$URL" \
      --fee-payer "$sender_kf" \
      --allow-unfunded-recipient \
      --no-wait 2>&1 >/dev/null && TX_COUNT=$((TX_COUNT + 1)) || ERRORS=$((ERRORS + 1))

  elif [ $roll -lt 70 ]; then
    # === Sequencer deposit (20%) - simulates bridge ===
    amount="$((RANDOM % 10 + 1)).$((RANDOM % 100))"
    solana transfer "$recv_addr" "$amount" \
      --from "$SEQUENCER" --url "$URL" \
      --fee-payer "$SEQUENCER" \
      --allow-unfunded-recipient \
      --no-wait 2>&1 >/dev/null && TX_COUNT=$((TX_COUNT + 1)) || ERRORS=$((ERRORS + 1))

  elif [ $roll -lt 90 ]; then
    # === SPL token transfer (20%) ===
    # Only between wallets 1-5 which have token accounts
    if [ $sender_idx -lt 5 ] && [ $recv_idx -lt 5 ]; then
      mint_idx=$((RANDOM % ${#SIM_MINTS[@]}))
      mint="${SIM_MINTS[$mint_idx]}"
      tok_name="${SIM_NAMES[$mint_idx]}"
      tok_amount=$((RANDOM % 1000 + 1))

      spl-token transfer "$mint" "$tok_amount" "$recv_addr" \
        --url "$URL" \
        --fee-payer "${sender_kf}" \
        --owner "${sender_kf}" \
        --fund-recipient \
        --allow-unfunded-recipient 2>&1 >/dev/null && TX_COUNT=$((TX_COUNT + 1)) || ERRORS=$((ERRORS + 1))
    else
      # Fallback to SOL transfer if sender/recv don't have tokens
      solana transfer "$recv_addr" "0.$((RANDOM % 999 + 1))" \
        --from "$sender_kf" --url "$URL" \
        --fee-payer "$sender_kf" \
        --allow-unfunded-recipient \
        --no-wait 2>&1 >/dev/null && TX_COUNT=$((TX_COUNT + 1)) || ERRORS=$((ERRORS + 1))
    fi

  else
    # === Multi-transfer burst (10%) ===
    for burst in 1 2 3; do
      b_recv=$(( (sender_idx + burst) % NUM_WALLETS ))
      b_amt="0.$(printf '%03d' $((RANDOM % 999 + 1)))"
      solana transfer "${ADDRS[$b_recv]}" "$b_amt" \
        --from "$sender_kf" --url "$URL" \
        --fee-payer "$sender_kf" \
        --allow-unfunded-recipient \
        --no-wait 2>&1 >/dev/null && TX_COUNT=$((TX_COUNT + 1)) || ERRORS=$((ERRORS + 1))
    done
  fi

  # Log every 100 txs
  if [ $((TX_COUNT % 100)) -eq 0 ] && [ $TX_COUNT -gt 0 ]; then
    log "TX_COUNT=$TX_COUNT ERRORS=$ERRORS ROUND=$ROUND"
  fi

  # Re-fund depleted wallets every 500 rounds
  if [ $((ROUND % 500)) -eq 0 ]; then
    for i in $(seq 0 $((NUM_WALLETS - 1))); do
      bal=$(solana balance "${ADDRS[$i]}" --url "$URL" 2>/dev/null | grep -oP '[\d.]+' || echo "0")
      if (( $(echo "$bal < 20" | bc -l 2>/dev/null || echo 1) )); then
        solana transfer "${ADDRS[$i]}" 200 \
          --from "$SEQUENCER" --url "$URL" \
          --fee-payer "$SEQUENCER" \
          --allow-unfunded-recipient \
          --no-wait 2>&1 >/dev/null || true
        log "Refunded wallet-$((i+1)) (was $bal SOL)"
      fi
    done
  fi

  # Random sleep 2-5 seconds
  sleep $((RANDOM % 4 + 2))
done
