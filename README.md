# Mythic L2

Mythic is a high-performance Layer 2 network built on a Firedancer-fork Solana validator with native AI precompiles, a full token economy, and an optimistic rollup bridge to Solana mainnet.

## Architecture

- **Validator**: Firedancer-fork (Frankendancer) running as a standalone L2 chain
- **Bridge**: Optimistic rollup bridge with 42-hour challenge period to Solana L1
- **Settlement**: State roots posted to Solana L1 every 100 slots
- **Consensus**: Single sequencer (testnet), multi-validator (mainnet planned)

## Programs (11 deployed on L2 with vanity IDs)

| Program | ID |
|---------|-----|
| Bridge L1 | `MythBrdg11111111111111111111111111111111111` |
| Bridge L2 | `MythBrdgL2111111111111111111111111111111111` |
| AI Precompiles | `CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ` |
| Compute Market | `AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh` |
| Settlement | `MythSett1ement11111111111111111111111111111` |
| MYTH Token | `MythToken1111111111111111111111111111111111` |
| Launchpad | `MythPad111111111111111111111111111111111111` |
| Swap | `MythSwap11111111111111111111111111111111111` |
| Staking | `MythStak11111111111111111111111111111111111` |
| Governance | `MythGov111111111111111111111111111111111111` |
| Airdrop | `MythDrop11111111111111111111111111111111111` |

## L1 Deployments (Solana Mainnet)

| Program | ID |
|---------|-----|
| Bridge | `oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ` |
| Settlement | `4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav` |

## Token Mints (L2)

| Token | Mint | Decimals |
|-------|------|----------|
| MYTH | `7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq` | 6 |
| wSOL | `FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3` | 9 |
| USDC | `6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN` | 6 |
| wBTC | `8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw` | 8 |
| wETH | `4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT` | 8 |

## MYTH Token Fee System

- **Fee Split**: 50% validators / 10% foundation / 40% burn
- **Burn**: Real `spl_token::burn` permanently removes tokens from supply
- **Max Supply**: 1,000,000,000 MYTH (1 billion, 6 decimals)

## Key Addresses

| Role | Address |
|------|---------|
| Sequencer | `DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg` |
| Deployer | `4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s` |
| Foundation | `AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e` |
| MYTH Mint | `7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq` |

## Build

### Prerequisites

- Rust 1.93+
- Solana CLI 3.0.15+
- Node.js 20+

### Programs

```bash
# Pin dependencies for BPF compatibility
# blake3 = ">=1.3, <1.8" and getrandom with "custom" feature

cd programs/<program-name>
cargo build-sbf --force-tools-install
```

### Website

```bash
cd website
npm install
npm run dev
```

## Ecosystem Services

| Service | Port | Domain |
|---------|------|--------|
| Main Website | 3000 | mythic.sh |
| MythicPad (Launchpad) | 3001 | mythic.money |
| MythicSwap (DEX) | 3002 | mythicswap.app |
| Wallet Site | 3003 | wallet.mythic.sh |
| Foundation | 3004 | mythic.foundation |
| Labs | 3005 | mythiclabs.io |
| Explorer API | 4000 | api.mythic.sh |
| DEX API | 4001 | dex.mythic.sh |
| Supply Oracle | 4002 | (internal) |
| Validator RPC | 8899 | testnet.mythic.sh |

## License

Proprietary - Mythic Labs
