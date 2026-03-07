#!/usr/bin/env node
// Match L2 MYTH/wSOL pool liquidity to L1 PumpSwap pool reserves
// Usage: node scripts/match-l1-liquidity.mjs [--dry-run]

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { readFileSync } from 'fs'
import { Buffer } from 'buffer'

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const SWAP_PROGRAM = new PublicKey('E3yp3LNjZkM1ayMhHX1ikH1TMFABYFrDpZVkW5GpkU8t')
const MYTH_MINT   = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')
const WSOL_MINT   = new PublicKey('FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

const MYTH_DECIMALS = 6
const WSOL_DECIMALS = 9

// Pool info (L2 MYTH/wSOL pool)
const POOL_PDA = new PublicKey('F1mZ26qS1tF7NEVKJayEU4Zf6Wnp3vSF1bN6WMW8CuY4')
const VAULT_A  = new PublicKey('EW1RtpoGM8F74aoLXaUZT48n4CjjJwcbAzZb4bZtnwbS')  // wMYTH vault
const VAULT_B  = new PublicKey('8VMk2YtL7YFvNUkEuH8CXJBwvJdMZfS4ERtSErARCh7T')  // wSOL vault
const LP_MINT  = new PublicKey('Gk2Be8yjZhTLTBb4Wb5Ap9YAza74mgeMbrTbDC16v5KB')

// Seeds
const LP_POSITION_SEED = Buffer.from('lp_position')

// DexScreener API
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

// ═══════════════════════════════════════════════════════════════
// CLI flags
// ═══════════════════════════════════════════════════════════════

const DRY_RUN = process.argv.includes('--dry-run')

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

function writeU64LE(buf, offset, val) {
  const big = BigInt(val)
  for (let i = 0; i < 8; i++) buf[offset + i] = Number((big >> BigInt(8 * i)) & 0xFFn)
}

function readU64LE(buf, offset) {
  let val = 0n
  for (let i = 0; i < 8; i++) val |= BigInt(buf[offset + i]) << BigInt(8 * i)
  return val
}

function toRawMYTH(amount) { return BigInt(Math.round(amount * 10 ** MYTH_DECIMALS)) }
function toRawWSOL(amount) { return BigInt(Math.round(amount * 10 ** WSOL_DECIMALS)) }
function fromRawMYTH(raw) { return Number(raw) / 10 ** MYTH_DECIMALS }
function fromRawWSOL(raw) { return Number(raw) / 10 ** WSOL_DECIMALS }

function fmtMYTH(raw) {
  const n = fromRawMYTH(raw)
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n.toLocaleString()
}

function fmtSOL(raw) {
  return fromRawWSOL(raw).toFixed(4)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ═══════════════════════════════════════════════════════════════
// Step 1: Fetch live L1 price and reserves from DexScreener
// ═══════════════════════════════════════════════════════════════

async function fetchL1State() {
  console.log('\n--- Step 1: Fetching live L1 MYTH/SOL state from DexScreener ---')

  const resp = await fetch(DEXSCREENER_URL)
  if (!resp.ok) throw new Error('DexScreener API request failed: ' + resp.status)
  const data = await resp.json()

  // Find the PumpSwap pair (preferred) or first available
  const pair = data.pairs?.find(p => p.dexId === 'pumpswap') || data.pairs?.[0]
  if (!pair) throw new Error('No MYTH/SOL pair found on DexScreener')

  const priceInSol = parseFloat(pair.priceNative)
  const priceInUsd = parseFloat(pair.priceUsd)
  const liquidityBase = pair.liquidity?.base || 0     // MYTH amount (human)
  const liquidityQuote = pair.liquidity?.quote || 0   // SOL amount (human)
  const liquidityUsd = pair.liquidity?.usd || 0

  console.log('  DEX:           ' + pair.dexId)
  console.log('  Pair:          ' + pair.pairAddress)
  console.log('  Price:         1 MYTH = ' + priceInSol + ' SOL ($' + priceInUsd + ')')
  console.log('  L1 Reserves:   ~' + (liquidityBase / 1e6).toFixed(1) + 'M MYTH + ~' + liquidityQuote.toFixed(1) + ' SOL')
  console.log('  Liquidity USD: $' + liquidityUsd.toLocaleString())

  return {
    priceInSol,
    priceInUsd,
    l1MythReserve: liquidityBase,   // human-readable MYTH
    l1SolReserve: liquidityQuote,   // human-readable SOL
  }
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Read current L2 pool reserves
// ═══════════════════════════════════════════════════════════════

async function readL2Pool(conn) {
  console.log('\n--- Step 2: Reading current L2 pool reserves ---')

  const poolInfo = await conn.getAccountInfo(POOL_PDA)
  if (!poolInfo) throw new Error('Pool account not found at ' + POOL_PDA.toBase58())

  // Pool layout offsets (from reseed script): reserve_a at 162, reserve_b at 170, lp_supply at 178
  const reserveA = readU64LE(poolInfo.data, 162)
  const reserveB = readU64LE(poolInfo.data, 170)
  const lpSupply = readU64LE(poolInfo.data, 178)

  const currentPrice = reserveA > 0n ? (Number(reserveB) / Number(reserveA)) / 1000 : 0

  console.log('  Reserve MYTH:  ' + fmtMYTH(reserveA) + ' (' + reserveA.toString() + ' raw)')
  console.log('  Reserve wSOL:  ' + fmtSOL(reserveB) + ' (' + reserveB.toString() + ' raw)')
  console.log('  LP Supply:     ' + lpSupply.toString())
  console.log('  Current Price: 1 MYTH = ' + currentPrice.toFixed(10) + ' SOL')

  return { reserveA, reserveB, lpSupply, currentPrice }
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Calculate delta needed
// ═══════════════════════════════════════════════════════════════

function calculateDelta(l1State, l2State) {
  console.log('\n--- Step 3: Calculating liquidity delta ---')

  // Target: match L1 reserves
  const targetMythRaw = toRawMYTH(l1State.l1MythReserve)
  const targetSolRaw  = toRawWSOL(l1State.l1SolReserve)

  const deltaMythRaw = targetMythRaw - l2State.reserveA
  const deltaSolRaw  = targetSolRaw - l2State.reserveB

  console.log('  Target MYTH:   ' + fmtMYTH(targetMythRaw) + ' (' + targetMythRaw.toString() + ' raw)')
  console.log('  Target wSOL:   ' + fmtSOL(targetSolRaw) + ' (' + targetSolRaw.toString() + ' raw)')
  console.log('  Delta MYTH:    +' + fmtMYTH(deltaMythRaw > 0n ? deltaMythRaw : 0n))
  console.log('  Delta wSOL:    +' + fmtSOL(deltaSolRaw > 0n ? deltaSolRaw : 0n))

  if (deltaMythRaw <= 0n && deltaSolRaw <= 0n) {
    console.log('  L2 pool already has >= L1 reserves. Nothing to do.')
    return null
  }

  // We need to add liquidity proportionally to the current pool ratio.
  // But we also want to match the L1 price. The approach:
  //   - Compute how much MYTH and wSOL to add so final reserves match L1 targets
  //   - We must add in the CURRENT pool ratio (AMM constraint) -- any remainder adjusts price
  //   - Actually, for a proportional add, the ratio must match. But the L1 ratio IS the target.
  //   - The cleanest approach: add liquidity amounts that bring reserves to L1 levels.
  //   - The pool uses proportional deposits, so we compute based on current pool ratio
  //     and then accept the proportional amount.

  // Compute the amount to add in current pool ratio:
  // If we request (deltaMythRaw, deltaSolRaw), the pool will take the min proportional.
  // But since L1 ratio might differ from L2 ratio, we should add a large amount
  // and let the pool take proportionally, then the extra of one token stays in our wallet.
  
  // The pool's AddLiquidity takes desired_amount_a and desired_amount_b,
  // then computes LP tokens = min(desired_a * lp_supply / reserve_a, desired_b * lp_supply / reserve_b)
  // and deposits proportionally based on whichever is the limiting factor.
  
  // Strategy: We want final_reserve_a ~= targetMythRaw and final_reserve_b ~= targetSolRaw
  // With proportional deposits, after a single add we can only add in the current ratio.
  // So the final ratio will be the same as the current ratio.
  // If we want to also fix the price, we'd need a swap + add.
  // For simplicity and to match the user's request: add enough to match L1 totals.
  // Provide both delta amounts -- the pool will deposit proportionally.

  // We'll provide generous amounts for both and let the pool pick proportionally.
  // The effective amounts added will match the current ratio.
  // To match L1 price AND reserves, we'd need to do a price correction first.
  // Let's check if prices are close enough.

  const l1Price = l1State.priceInSol
  const l2Price = l2State.currentPrice
  const priceDrift = l2Price > 0 ? Math.abs(l1Price - l2Price) / l1Price * 100 : 100

  console.log('')
  console.log('  L1 Price: ' + l1Price.toFixed(10) + ' SOL/MYTH')
  console.log('  L2 Price: ' + l2Price.toFixed(10) + ' SOL/MYTH')
  console.log('  Drift:    ' + priceDrift.toFixed(2) + '%')

  if (priceDrift > 5) {
    console.log('')
    console.log('  WARNING: L2 price drifts >5% from L1. Consider running reseed-pool-live-price.mjs first.')
    console.log('  Continuing anyway -- will add liquidity proportionally to current L2 ratio.')
  }

  // For the AddLiquidity instruction, we pass desired amounts.
  // The pool will pick the min proportional. We want to add enough to reach L1 levels.
  // Since pool ratio might differ, calculate proportionally from the MYTH delta:
  //   addMYTH = deltaMythRaw
  //   addSOL  = deltaMythRaw * reserveB / reserveA   (proportional to current ratio)
  // OR from the SOL delta:
  //   addSOL  = deltaSolRaw
  //   addMYTH = deltaSolRaw * reserveA / reserveB

  // Pick the approach that adds MORE liquidity (so we get closer to L1)
  let addMythRaw, addSolRaw

  if (deltaMythRaw <= 0n) {
    // Only need more SOL -- add proportionally from SOL delta
    addSolRaw = deltaSolRaw
    addMythRaw = l2State.reserveA > 0n
      ? BigInt(Math.ceil(Number(deltaSolRaw) * Number(l2State.reserveA) / Number(l2State.reserveB)))
      : 0n
  } else if (deltaSolRaw <= 0n) {
    // Only need more MYTH -- add proportionally from MYTH delta
    addMythRaw = deltaMythRaw
    addSolRaw = l2State.reserveB > 0n
      ? BigInt(Math.ceil(Number(deltaMythRaw) * Number(l2State.reserveB) / Number(l2State.reserveA)))
      : 0n
  } else {
    // Need both -- figure out which is the binding constraint
    // Option A: use MYTH delta -> compute proportional SOL
    const solFromMyth = l2State.reserveB > 0n
      ? BigInt(Math.ceil(Number(deltaMythRaw) * Number(l2State.reserveB) / Number(l2State.reserveA)))
      : 0n
    // Option B: use SOL delta -> compute proportional MYTH
    const mythFromSol = l2State.reserveA > 0n
      ? BigInt(Math.ceil(Number(deltaSolRaw) * Number(l2State.reserveA) / Number(l2State.reserveB)))
      : 0n

    // Pick the option that results in larger total add
    if (Number(deltaMythRaw) + Number(solFromMyth) >= Number(mythFromSol) + Number(deltaSolRaw)) {
      addMythRaw = deltaMythRaw
      addSolRaw  = solFromMyth
    } else {
      addMythRaw = mythFromSol
      addSolRaw  = deltaSolRaw
    }
  }

  // Ensure we don't try to add 0
  if (addMythRaw <= 0n || addSolRaw <= 0n) {
    console.log('  Computed add amounts are zero or negative. Nothing to do.')
    return null
  }

  console.log('')
  console.log('  Will add to pool:')
  console.log('    MYTH: ' + fmtMYTH(addMythRaw) + ' (' + addMythRaw.toString() + ' raw)')
  console.log('    wSOL: ' + fmtSOL(addSolRaw) + ' (' + addSolRaw.toString() + ' raw)')

  const finalMythEst = l2State.reserveA + addMythRaw
  const finalSolEst  = l2State.reserveB + addSolRaw
  console.log('')
  console.log('  Estimated final reserves:')
  console.log('    MYTH: ~' + fmtMYTH(finalMythEst))
  console.log('    wSOL: ~' + fmtSOL(finalSolEst))

  return { addMythRaw, addSolRaw }
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Mint wMYTH and wSOL to deployer
// ═══════════════════════════════════════════════════════════════

async function mintTokensToDeployer(conn, deployer, addMythRaw, addSolRaw) {
  console.log('\n--- Step 4: Minting tokens to deployer ---')

  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)

  // Check current deployer balances
  let mythBalance = 0n
  let solBalance = 0n
  try {
    const mythAcct = await getAccount(conn, mythATA)
    mythBalance = mythAcct.amount
  } catch (_) { /* ATA might not exist yet */ }
  try {
    const solAcct = await getAccount(conn, wsolATA)
    solBalance = solAcct.amount
  } catch (_) { /* ATA might not exist yet */ }

  console.log('  Deployer MYTH balance: ' + fmtMYTH(mythBalance) + ' (' + mythBalance.toString() + ' raw)')
  console.log('  Deployer wSOL balance: ' + fmtSOL(solBalance) + ' (' + solBalance.toString() + ' raw)')

  // Calculate how much to mint (only mint what's needed beyond current balance)
  const mintMythNeeded = addMythRaw > mythBalance ? addMythRaw - mythBalance : 0n
  const mintSolNeeded  = addSolRaw > solBalance ? addSolRaw - solBalance : 0n

  console.log('  Need to mint MYTH: ' + fmtMYTH(mintMythNeeded) + ' (' + mintMythNeeded.toString() + ' raw)')
  console.log('  Need to mint wSOL: ' + fmtSOL(mintSolNeeded) + ' (' + mintSolNeeded.toString() + ' raw)')

  if (mintMythNeeded === 0n && mintSolNeeded === 0n) {
    console.log('  Deployer already has sufficient tokens. Skipping mint.')
    return
  }

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would mint tokens. Skipping.')
    return
  }

  const tx = new Transaction()

  // Ensure ATAs exist
  const mythATAInfo = await conn.getAccountInfo(mythATA)
  if (!mythATAInfo) {
    console.log('  Creating deployer MYTH ATA...')
    tx.add(createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      mythATA,
      deployer.publicKey,
      MYTH_MINT
    ))
  }

  const wsolATAInfo = await conn.getAccountInfo(wsolATA)
  if (!wsolATAInfo) {
    console.log('  Creating deployer wSOL ATA...')
    tx.add(createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      wsolATA,
      deployer.publicKey,
      WSOL_MINT
    ))
  }

  // Mint MYTH if needed
  if (mintMythNeeded > 0n) {
    console.log('  Minting ' + fmtMYTH(mintMythNeeded) + ' MYTH to deployer...')
    tx.add(createMintToInstruction(
      MYTH_MINT,
      mythATA,
      deployer.publicKey,  // mint authority
      mintMythNeeded
    ))
  }

  // Mint wSOL if needed
  if (mintSolNeeded > 0n) {
    console.log('  Minting ' + fmtSOL(mintSolNeeded) + ' wSOL to deployer...')
    tx.add(createMintToInstruction(
      WSOL_MINT,
      wsolATA,
      deployer.publicKey,  // mint authority
      mintSolNeeded
    ))
  }

  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log('  Mint tx: ' + sig)

  // Verify post-mint balances
  await sleep(500)
  const mythAfter = await getAccount(conn, mythATA)
  const solAfter  = await getAccount(conn, wsolATA)
  console.log('  Post-mint MYTH: ' + fmtMYTH(mythAfter.amount))
  console.log('  Post-mint wSOL: ' + fmtSOL(solAfter.amount))
}

// ═══════════════════════════════════════════════════════════════
// Step 5: Add liquidity to the pool
// ═══════════════════════════════════════════════════════════════

async function addLiquidity(conn, deployer, addMythRaw, addSolRaw) {
  console.log('\n--- Step 5: Adding liquidity to MYTH/wSOL pool ---')

  console.log('  Amount A (MYTH): ' + fmtMYTH(addMythRaw) + ' (' + addMythRaw.toString() + ' raw)')
  console.log('  Amount B (wSOL): ' + fmtSOL(addSolRaw) + ' (' + addSolRaw.toString() + ' raw)')

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would add liquidity. Skipping.')
    return
  }

  // Get deployer ATAs
  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)
  const lpATA   = await getAssociatedTokenAddress(LP_MINT, deployer.publicKey)

  // Derive LP position PDA
  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, POOL_PDA.toBuffer(), deployer.publicKey.toBuffer()],
    SWAP_PROGRAM
  )

  const tx = new Transaction()

  // Ensure LP ATA exists
  const lpATAInfo = await conn.getAccountInfo(lpATA)
  if (!lpATAInfo) {
    console.log('  Creating deployer LP token ATA...')
    tx.add(createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      lpATA,
      deployer.publicKey,
      LP_MINT
    ))
  }

  // AddLiquidity instruction: discriminator = 2
  // Data: disc(1) + desired_amount_a(8) + desired_amount_b(8) + min_lp_tokens(8) = 25 bytes
  const data = Buffer.alloc(1 + 24)
  data[0] = 2  // AddLiquidity discriminator
  writeU64LE(data, 1, addMythRaw)
  writeU64LE(data, 9, addSolRaw)
  writeU64LE(data, 17, 0n)  // min_lp_tokens = 0 (no slippage check for admin seeding)

  // Accounts order (from swap program source):
  //  0. depositor (signer, writable)
  //  1. pool (writable)
  //  2. vault_a (writable) - pool MYTH vault
  //  3. vault_b (writable) - pool wSOL vault
  //  4. lp_mint (writable)
  //  5. depositor_token_a (writable) - deployer MYTH ATA
  //  6. depositor_token_b (writable) - deployer wSOL ATA
  //  7. depositor_lp_ata (writable) - deployer LP ATA
  //  8. lp_position (writable) - LP position PDA
  //  9. token_program
  // 10. system_program
  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_PDA,           isSigner: false, isWritable: true },
      { pubkey: VAULT_A,            isSigner: false, isWritable: true },
      { pubkey: VAULT_B,            isSigner: false, isWritable: true },
      { pubkey: LP_MINT,            isSigner: false, isWritable: true },
      { pubkey: mythATA,            isSigner: false, isWritable: true },
      { pubkey: wsolATA,            isSigner: false, isWritable: true },
      { pubkey: lpATA,              isSigner: false, isWritable: true },
      { pubkey: lpPositionPDA,      isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM,      isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
  tx.add(ix)

  console.log('  Sending AddLiquidity transaction...')
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log('  AddLiquidity tx: ' + sig)

  // Verify final pool state
  await sleep(1000)
  const poolInfo = await conn.getAccountInfo(POOL_PDA)
  const finalReserveA = readU64LE(poolInfo.data, 162)
  const finalReserveB = readU64LE(poolInfo.data, 170)
  const finalLpSupply = readU64LE(poolInfo.data, 178)
  const finalPrice = Number(finalReserveB) / Number(finalReserveA) / 1000

  console.log('')
  console.log('  ========== FINAL POOL STATE ==========')
  console.log('  Reserve MYTH: ' + fmtMYTH(finalReserveA) + ' (' + finalReserveA.toString() + ' raw)')
  console.log('  Reserve wSOL: ' + fmtSOL(finalReserveB) + ' (' + finalReserveB.toString() + ' raw)')
  console.log('  LP Supply:    ' + finalLpSupply.toString())
  console.log('  Price:        1 MYTH = ' + finalPrice.toFixed(10) + ' SOL')
  console.log('  ======================================')

  return { finalReserveA, finalReserveB, finalLpSupply, finalPrice }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('=================================================')
  console.log(' Match L2 MYTH/wSOL Pool to L1 PumpSwap Reserves')
  console.log('=================================================')

  if (DRY_RUN) {
    console.log('  MODE: DRY RUN (no transactions will be sent)')
  } else {
    console.log('  MODE: LIVE (transactions will be sent)')
  }

  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log('  Deployer: ' + deployer.publicKey.toBase58())
  console.log('  RPC:      ' + RPC_URL)

  // Step 1: Fetch L1 state from DexScreener
  const l1State = await fetchL1State()

  // Step 2: Read current L2 pool
  const l2State = await readL2Pool(conn)

  // Step 3: Calculate delta
  const delta = calculateDelta(l1State, l2State)
  if (!delta) {
    console.log('\nNothing to do. L2 pool already matches or exceeds L1.')
    return
  }

  // Step 4: Mint tokens to deployer
  await mintTokensToDeployer(conn, deployer, delta.addMythRaw, delta.addSolRaw)

  // Step 5: Add liquidity
  const result = await addLiquidity(conn, deployer, delta.addMythRaw, delta.addSolRaw)

  if (!DRY_RUN && result) {
    console.log('\n=================================================')
    console.log(' Summary')
    console.log('=================================================')
    console.log('  L1 MYTH reserve: ~' + (l1State.l1MythReserve / 1e6).toFixed(1) + 'M')
    console.log('  L2 MYTH reserve: ~' + fmtMYTH(result.finalReserveA))
    console.log('  L1 SOL reserve:  ~' + l1State.l1SolReserve.toFixed(1))
    console.log('  L2 SOL reserve:  ~' + fmtSOL(result.finalReserveB))
    console.log('  L1 price:        ' + l1State.priceInSol.toFixed(10) + ' SOL/MYTH')
    console.log('  L2 price:        ' + result.finalPrice.toFixed(10) + ' SOL/MYTH')
    const drift = Math.abs(result.finalPrice - l1State.priceInSol) / l1State.priceInSol * 100
    console.log('  Price drift:     ' + drift.toFixed(2) + '%')
    console.log('=================================================')
    console.log(' Done! L2 pool liquidity matched to L1.')
    console.log('=================================================')
  } else if (DRY_RUN) {
    console.log('\n=================================================')
    console.log(' DRY RUN complete. No transactions were sent.')
    console.log(' Run without --dry-run to execute.')
    console.log('=================================================')
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message || err)
  if (err.logs) console.error('Program logs:', err.logs)
  process.exit(1)
})
