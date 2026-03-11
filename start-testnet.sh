#!/bin/bash
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH

echo "Starting Mythic L2 (resume from existing ledger)"
exec solana-test-validator \
  --ledger /mnt/data/mythic-l2/production-ledger-v2 \
  --rpc-port 8899 \
  --gossip-port 8801 \
  --faucet-port 9801 \
  --dynamic-port-range 8900-9000 \
  --limit-ledger-size 50000000 \
  --ticks-per-slot 64 \
  --slots-per-epoch 432000 \
  --quiet 2>&1
