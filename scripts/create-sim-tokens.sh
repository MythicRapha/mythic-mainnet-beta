#!/bin/bash
# create-sim-tokens.sh - Create simulated "launched" tokens on L2
set -uo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

URL="http://localhost:8899"
SEQUENCER="/mnt/data/mythic-l2/keys/sequencer-identity.json"
WDIR="/mnt/data/mythic-l2/keys/test-wallets"
MINT_DIR="/mnt/data/mythic-l2/keys/sim-mints"
LOGFILE="/mnt/data/mythic-l2/logs/sim-tokens.log"

mkdir -p "$MINT_DIR"
mkdir -p /mnt/data/mythic-l2/logs

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE"
}

# Fun token definitions: name, symbol, decimals, supply
declare -a TOKEN_NAMES=(
  "MythicAI"
  "DragonGold"
  "NeonPulse"
  "ShadowFi"
  "AstralSwap"
  "PhoenixDAO"
  "CyberVault"
  "QuantumBit"
)
declare -a TOKEN_SYMBOLS=(
  "MAI"
  "DGLD"
  "NEON"
  "SHFI"
  "ASWP"
  "PHNX"
  "CYBR"
  "QBIT"
)
declare -a TOKEN_DECIMALS=(6 9 6 8 6 9 6 6)
declare -a TOKEN_SUPPLY=(1000000000 500000000 100000000 250000000 750000000 50000000 2000000000 100000000)

SEQUENCER_ADDR=$(solana-keygen pubkey "$SEQUENCER")

log "=== Creating Simulated Launched Tokens ==="
log "Creator: $SEQUENCER_ADDR"

for i in "${!TOKEN_NAMES[@]}"; do
  name="${TOKEN_NAMES[$i]}"
  symbol="${TOKEN_SYMBOLS[$i]}"
  decimals="${TOKEN_DECIMALS[$i]}"
  supply="${TOKEN_SUPPLY[$i]}"
  mint_kf="$MINT_DIR/${symbol,,}-mint.json"

  log ""
  log "--- Token $((i+1))/8: $name ($symbol) ---"

  # Create mint keypair if not exists
  if [ ! -f "$mint_kf" ]; then
    solana-keygen new --no-bip39-passphrase --outfile "$mint_kf" --force 2>/dev/null
  fi
  mint_addr=$(solana-keygen pubkey "$mint_kf")
  log "Mint address: $mint_addr"

  # Create the token mint
  log "Creating token with $decimals decimals..."
  spl-token create-token \
    --url "$URL" \
    --fee-payer "$SEQUENCER" \
    --mint-authority "$SEQUENCER" \
    --decimals "$decimals" \
    "$mint_kf" 2>&1 | tee -a "$LOGFILE" || {
    log "Mint may already exist, continuing..."
  }

  # Create token account for sequencer
  log "Creating token account..."
  spl-token create-account "$mint_addr" \
    --url "$URL" \
    --fee-payer "$SEQUENCER" \
    --owner "$SEQUENCER" 2>&1 | tee -a "$LOGFILE" || {
    log "Token account may already exist, continuing..."
  }

  # Mint initial supply
  log "Minting $supply tokens..."
  spl-token mint "$mint_addr" "$supply" \
    --url "$URL" \
    --fee-payer "$SEQUENCER" \
    --mint-authority "$SEQUENCER" 2>&1 | tee -a "$LOGFILE" || {
    log "Minting failed or already done, continuing..."
  }

  # Distribute to test wallets (give each wallet some tokens)
  log "Distributing to test wallets..."
  for w in $(seq 1 5); do
    wallet_kf="$WDIR/wallet-${w}.json"
    wallet_addr=$(solana-keygen pubkey "$wallet_kf")
    # Give each wallet 1% of supply
    dist_amount=$((supply / 100))

    # Create ATA for wallet
    spl-token create-account "$mint_addr" \
      --url "$URL" \
      --fee-payer "$SEQUENCER" \
      --owner "$wallet_kf" 2>&1 >/dev/null || true

    # Transfer tokens
    spl-token transfer "$mint_addr" "$dist_amount" "$wallet_addr" \
      --url "$URL" \
      --fee-payer "$SEQUENCER" \
      --from "$SEQUENCER" \
      --fund-recipient \
      --allow-unfunded-recipient 2>&1 | tail -1 | tee -a "$LOGFILE" || true
  done

  log "$name ($symbol) created and distributed!"
done

log ""
log "=== All tokens created! ==="
log "Mint addresses:"
for i in "${!TOKEN_SYMBOLS[@]}"; do
  symbol="${TOKEN_SYMBOLS[$i]}"
  mint_kf="$MINT_DIR/${symbol,,}-mint.json"
  mint_addr=$(solana-keygen pubkey "$mint_kf")
  log "  ${TOKEN_NAMES[$i]} ($symbol): $mint_addr"
done
