#!/bin/bash
# Fund 14 wallets with 0.01 SOL each
# Total: 0.14 SOL + fees
set -e

KEYPAIR="$1"
RPC="https://api.mainnet-beta.solana.com"

if [ -z "$KEYPAIR" ]; then
  echo "Usage: ./fund-wallets.sh /path/to/keypair.json"
  exit 1
fi

echo "Sending 0.01 SOL to 14 wallets..."
echo "Keypair: $KEYPAIR"
echo "RPC: $RPC"
echo ""

WALLETS=(
  "2n3DLNFFMbzTAWnZsDHKYaET7ijYCNEbGK4ACQr1rsGy"
  "FT9k9bqEZcmre4rNKxstfjjft2g9HL6j7cFVfPRrzd6"
  "BwiTHEtvwGqAjkFQ7JPGRYVExvzt9reCtkaPrPt4vt7Z"
  "6SrpJsrLHFAs6iPHFRNYmtEHUVnXyd1Q3iSqcVp8myth"
  "5SuMfzfG8yBeokTZt4Re2Mma2Ui3FdjgjxEjsUz4zMsJ"
  "4JP3iUMfUj8BEAobLFKCiNhkaH3NwJbFM5WNSiMeKi74"
  "UGHzC6WCaq5GTQb8WPqxMQph3CnVfba4LdbE6Jx8cGW"
  "4A8twgiCqV6PxAGrxQPFEv9XAHc1sS1g1XxVBwGee9qC"
  "5XfzAqsCfeRXGAxq9yPDiuBzFG8CkdAb6xNj4Zqu3Efu"
  "k4pCDXLKx1vNCbYH9EuYobr6m748ShPgHUVh3W5Vdr9"
  "CF3Vq66TMJHkamp3van5sxckdfZrixNCHqqj2sdT8syT"
  "GY3hD9nVaUfgc3Yy7wQYJaPdhMoNGd9dXp9FWPx2yw7Q"
  "GqdcfWtrYtjThBZ6ufBgDFeyFbYXRjmn8gH9CtNPWPKQ"
  "EnY5sBGpbcQxakwfeqwAYyUqyvK4KGZ7UTXEWQ1M9maw"
)

LABELS=(
  "FUND" "P1" "P2" "W2" "P3" "P4" "P5"
  "P6" "P7" "P8" "P9" "P10" "P11" "W13"
)

for i in "${!WALLETS[@]}"; do
  echo "[${LABELS[$i]}] Sending 0.01 SOL to ${WALLETS[$i]}..."
  solana transfer "${WALLETS[$i]}" 0.01 \
    --keypair "$KEYPAIR" \
    --url "$RPC" \
    --allow-unfunded-recipient \
    --with-compute-unit-price 5000
  echo "  Done."
  sleep 0.5
done

echo ""
echo "All 14 transfers complete."
