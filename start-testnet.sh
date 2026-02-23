#!/bin/bash
source $HOME/.cargo/env
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

exec solana-test-validator \
    --ledger /mnt/data/mythic-l2/testnet-ledger \
    --rpc-port 8899 \
    --faucet-port 9900 \
    --limit-ledger-size 50000000 \
    --log \
    --reset
