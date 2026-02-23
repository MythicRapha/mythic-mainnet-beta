# Mythic Bridge — L1 Mainnet Deployment Guide

## Overview

Deploy the Mythic Bridge program to Solana L1 mainnet-beta. This program handles lock-and-mint deposits (SOL and SPL tokens) that the relayer watches to credit users on Mythic L2, and optimistic-rollup withdrawals with a 7-day challenge period.

## Key Addresses

| Role | Address |
|------|---------|
| Deployer / Admin | `4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s` |
| Sequencer | Run `solana-keygen pubkey /mnt/data/mythic-l2/keys/sequencer-identity.json` |
| L1 Program ID | Run `solana-keygen pubkey /mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json` |

**Important:** The L1 program ID will NOT be `MythBrdg11111111111111111111111111111111111` — that vanity ID was only injected into the L2 genesis block. On mainnet L1, the program ID is determined by the keypair at `target/deploy/mythic_bridge-keypair.json` (currently `oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ`).

## Cost Estimate

| Item | Cost |
|------|------|
| Program data rent (284,896 bytes x 2) | ~1.98 SOL |
| Transaction fees | ~0.01 SOL |
| Initialize config tx | ~0.003 SOL |
| Safety buffer | ~1.0 SOL |
| **Total needed** | **~3.0 SOL** |

Program .so size: 142,448 bytes. Solana allocates 2x for upgradeable programs.

## RPC Options

The Frankendancer node at `20.81.176.84:8899` is a full mainnet-beta node and **supports sendTransaction**. It can be used for deployment. Alternatively, use a commercial RPC:

- `http://20.81.176.84:8899` — our dedicated Frankendancer (preferred, no rate limits)
- `https://api.mainnet-beta.solana.com` — public, rate limited, may reject large deploys

## Pre-Deployment Checklist

- [ ] Fund deployer `4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s` with at least 3 SOL on mainnet
- [ ] Verify bridge source is up to date on server (`cd /mnt/data/mythic-l2 && git pull`)
- [ ] Confirm `.so` is current (the deploy script auto-rebuilds if source is newer)
- [ ] Verify you have SSH access to the server

## Deployment Steps

### Step 1: SSH into the server

```bash
ssh -i /Users/raphaelcardona/mythic-l2/mythic-l2-rpc_key.pem mythic@48.211.216.77
```

### Step 2: Fund the deployer (from any mainnet wallet)

Send at least 3 SOL to:
```
4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s
```

Verify:
```bash
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
solana balance 4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s --url http://20.81.176.84:8899
```

### Step 3: Run the deployment script

```bash
cd /mnt/data/mythic-l2
chmod +x deploy-bridge-l1.sh
./deploy-bridge-l1.sh http://20.81.176.84:8899
```

The script will:
1. Validate all keypairs exist
2. Check deployer balance and warn if insufficient
3. Rebuild the .so if source has changed
4. Estimate deployment cost
5. Prompt for confirmation before deploying
6. Deploy the program
7. Verify deployment

### Step 4: Initialize the bridge config

After deployment, initialize the bridge config PDA:

```bash
# Install deps if needed
cd /mnt/data/mythic-l2
npm install @solana/web3.js borsh typescript ts-node

# Run initializer
npx ts-node initialize-bridge-l1.ts http://20.81.176.84:8899
```

This creates the bridge config PDA with:
- Admin: deployer address
- Sequencer: sequencer identity
- Challenge period: 7 days (604,800 seconds)
- Bridge fee: 0.1% (10 BPS)
- Min deposit: 0.01 SOL
- Max deposit: 1,000 SOL
- Daily limit: 10,000 SOL
- Bridge starts **unpaused**

### Step 5: Verify the config PDA

```bash
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
PROGRAM_ID=$(solana-keygen pubkey /mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json)
solana program show "$PROGRAM_ID" --url http://20.81.176.84:8899
```

## Post-Deployment Config Updates

After deployment, update these configs with the new L1 program ID:

### 1. Relayer Service

File: `/mnt/data/mythic-l2/services/relayer/config.ts` (or `.env`)
```
L1_BRIDGE_PROGRAM_ID=<new program ID>
```

Then restart:
```bash
pm2 restart mythic-relayer
```

### 2. Website Bridge UI

File: `/mnt/data/mythic-l2/website/src/lib/constants.ts` (or similar)
```typescript
export const BRIDGE_L1_PROGRAM_ID = "<new program ID>";
```

Then rebuild and restart:
```bash
cd /mnt/data/mythic-l2/website && npm run build
pm2 restart mythic-website
```

### 3. Explorer API

If the explorer indexes L1 bridge events, update its config too.

## Security: Transfer Admin to Ledger

**CRITICAL:** Before going live with real funds, transfer the bridge admin authority to a Ledger hardware wallet:

```typescript
// Using UpdateConfig instruction (IX_UPDATE_CONFIG = 6)
// This should be done AFTER testing the bridge with small amounts

// 1. Get Ledger pubkey
// 2. Call process_update_config with new_sequencer = None
// 3. For admin transfer, you'd need to add a transfer_admin instruction
//    (not currently in the program — consider adding before mainnet)
```

**NOTE:** The current program does NOT have a `transfer_admin` instruction. The admin is set at initialization and cannot be changed. To use a Ledger admin:
1. Export the Ledger's public key
2. Create a keypair file with the Ledger pubkey (for the initialize instruction's `admin` signer)
3. Sign the initialize transaction with the Ledger
4. Or: add a `transfer_admin` instruction to the program before deploying

## Program Features (deployed binary)

- **Deposits:** SOL and SPL tokens with 0.1% fee
- **Withdrawals:** Optimistic rollup with 7-day challenge period
- **Emergency pause:** Admin can pause/unpause deposits and withdrawals
- **Deposit limits:** Min 0.01 SOL, max 1,000 SOL, daily cap 10,000 SOL
- **Fee management:** Admin can update fee BPS (capped at 1%) and withdraw collected fees
- **Upgradeable:** Program is deployed as upgradeable (upgrade authority = deployer)

## Files

| File | Purpose |
|------|---------|
| `deploy-bridge-l1.sh` | Main deployment script |
| `initialize-bridge-l1.ts` | TypeScript script to initialize config PDA |
| `programs/bridge/src/lib.rs` | Bridge program source code |
| `target/deploy/mythic_bridge.so` | Compiled BPF binary |
| `target/deploy/mythic_bridge-keypair.json` | Program keypair (determines program ID) |
| `keys/deployer.json` | Deployer/admin keypair |
| `keys/sequencer-identity.json` | Sequencer keypair |

## Troubleshooting

**"Insufficient funds for deployment"**
- Fund the deployer with more SOL. Need at least ~2.5 SOL.

**"Program already exists"**
- The program ID keypair was already used for a deployment. Either:
  - Use `solana program deploy --program-id <keypair> <.so>` to upgrade
  - Or generate a new keypair: `solana-keygen new -o new-bridge-keypair.json`

**"Transaction simulation failed"**
- Check compute unit price. Mainnet may need higher priority fees during congestion.
- Try adding `--with-compute-unit-price 5000` or higher.

**"RPC connection failed"**
- Verify Frankendancer is running: `curl http://20.81.176.84:8899 -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
- Fall back to public RPC if needed.

**"Config PDA already exists"**
- The bridge was already initialized. To re-initialize with different params, you need to close the existing PDA account first (requires admin signature).
