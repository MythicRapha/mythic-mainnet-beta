#!/usr/bin/env node
// Price Sync Daemon v2 — keeps L2 MYTH/wSOL pool pegged to L1 PumpSwap price
// Run via PM2: pm2 start scripts/price-sync-daemon.mjs --name mythic-price-sync
//
// Every 30 seconds:
//   1. Fetch L1 MYTH price from DexScreener (with fallback cache)
//   2. Read L2 pool reserves, calculate implied price
//   3. If drift > 0.5%: directly adjust reserves via remove LP → reseed at correct ratio
//
// v2 changes vs v1:
//   - 30s interval (was 5m)
//   - 0.5% threshold (was 2%)
//   - Direct reserve adjustment instead of swap-through-AMM (no fee waste, instant convergence)
//   - No swap cap — full correction in one cycle
//   - Fallback to cached price if DexScreener fails
//   - Handles both upward and downward L1 price moves

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
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { readFileSync } from 'fs'

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const SWAP_PROGRAM = new PublicKey('E3yp3LNjZkM1ayMhHX1ikH1TMFABYFrDpZVkW5GpkU8t')
const MYTH_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')
const WSOL_MINT = new PublicKey('FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

const MYTH_DECIMALS = 6
const WSOL_DECIMALS = 9

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

const DRIFT_THRESHOLD = 0.005  // 0.5% drift triggers rebalance (was 2%)
const SYNC_INTERVAL_MS = 30_000 // 30 seconds (was 5 minutes)

// PDA Seeds
const SWAP_CONFIG_SEED = Buffer.from('swap_config')
const POOL_SEED = Buffer.from('pool')
const PROTOCOL_VAULT_SEED = Buffer.from('protocol_vault')
const LP_POSITION_SEED = Buffer.from('lp_position')

// ═══════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════

let lastKnownL1Price = null
let lastPriceFetchTime = 0
let consecutiveErrors = 0

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

function ts() { return new Date().toISOString() }

// ═══════════════════════════════════════════════════════════════
// Pool Derivation (cached)
// ═══════════════════════════════════════════════════════════════

let _poolCache = null
function getPoolInfo() {
  if (_poolCache) return _poolCache
  const cmp = MYTH_MINT.toBuffer().compare(WSOL_MINT.toBuffer())
  const [sortedA, sortedB] = cmp < 0 ? [MYTH_MINT, WSOL_MINT] : [WSOL_MINT, MYTH_MINT]
  const mythIsA = cmp < 0

  const [poolPDA] = PublicKey.findProgramAddressSync(
    [POOL_SEED, sortedA.toBuffer(), sortedB.toBuffer()],
    SWAP_PROGRAM
  )
  const [configPDA] = PublicKey.findProgramAddressSync([SWAP_CONFIG_SEED], SWAP_PROGRAM)
  const [protocolVaultPDA] = PublicKey.findProgramAddressSync([PROTOCOL_VAULT_SEED], SWAP_PROGRAM)

  _poolCache = { poolPDA, sortedA, sortedB, mythIsA, configPDA, protocolVaultPDA }
  return _poolCache
}

// ═══════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════

let lastKnownL1Reserves = null

async function fetchL1Price() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const resp = await fetch(DEXSCREENER_URL, { signal: controller.signal })
    clearTimeout(timeout)
    const data = await resp.json()
    const pair = data.pairs?.find(p => p.dexId === 'pumpswap') || data.pairs?.find(p => p.dexId === 'raydium') || data.pairs?.[0]
    if (!pair) throw new Error('No pair found on DexScreener')
    const price = parseFloat(pair.priceNative)
    if (isNaN(price) || price <= 0) throw new Error(`Invalid price: ${pair.priceNative}`)

    // Extract L1 pool reserves
    const liq = pair.liquidity || {}
    let mythReserve = 0, solReserve = 0
    if (liq.base > 0 && liq.quote > 0) {
      mythReserve = liq.base
      solReserve = liq.quote
    } else if (liq.usd > 0) {
      const solPriceUsd = parseFloat(pair.priceUsd) / price
      const halfUsd = liq.usd / 2
      solReserve = halfUsd / solPriceUsd
      mythReserve = solReserve / price
    }
    if (mythReserve > 0 && solReserve > 0) {
      lastKnownL1Reserves = { mythReserve, solReserve }
    }

    lastKnownL1Price = price
    lastPriceFetchTime = Date.now()
    consecutiveErrors = 0
    return price
  } catch (err) {
    consecutiveErrors++
    if (lastKnownL1Price && (Date.now() - lastPriceFetchTime) < 300_000) {
      console.log(`[${ts()}] DexScreener error (${err.message}), using cached price: ${lastKnownL1Price}`)
      return lastKnownL1Price
    }
    throw err
  }
}

async function readPoolState(conn) {
  const { poolPDA, mythIsA } = getPoolInfo()
  const poolInfo = await conn.getAccountInfo(poolPDA)
  if (!poolInfo) throw new Error('Pool not found')

  // Pool layout: offset 66=vault_a(32), 98=vault_b(32), 130=lp_mint(32), 162=reserve_a(8), 170=reserve_b(8), 178=lp_supply(8)
  const vaultA = new PublicKey(poolInfo.data.subarray(66, 98))
  const vaultB = new PublicKey(poolInfo.data.subarray(98, 130))
  const lpMint = new PublicKey(poolInfo.data.subarray(130, 162))
  const reserveA = readU64LE(poolInfo.data, 162)
  const reserveB = readU64LE(poolInfo.data, 170)
  const lpSupply = readU64LE(poolInfo.data, 178)

  return { vaultA, vaultB, lpMint, reserveA, reserveB, lpSupply, mythIsA }
}

function calculateL2Price(reserveA, reserveB, mythIsA) {
  const mythReserve = mythIsA ? reserveA : reserveB
  const wsolReserve = mythIsA ? reserveB : reserveA
  const mythHuman = Number(mythReserve) / 10 ** MYTH_DECIMALS
  const wsolHuman = Number(wsolReserve) / 10 ** WSOL_DECIMALS
  if (mythHuman === 0) return 0
  return wsolHuman / mythHuman // SOL per MYTH
}

// ═══════════════════════════════════════════════════════════════
// Direct Reserve Adjustment (v2 approach)
// Instead of swapping through AMM (which wastes fees and is
// limited by slippage), we:
//   1. Remove all deployer LP
//   2. Mint whatever tokens are needed
//   3. Add liquidity back at the exact target ratio
// This achieves perfect price sync in ONE cycle.
// ═══════════════════════════════════════════════════════════════

async function removeLiquidity(conn, deployer, poolPDA, vaultA, vaultB, lpMint) {
  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, poolPDA.toBuffer(), deployer.publicKey.toBuffer()],
    SWAP_PROGRAM
  )

  const lpPosInfo = await conn.getAccountInfo(lpPositionPDA)
  if (!lpPosInfo) return null

  // LpPosition: is_initialized(1) + owner(32) + pool(32) = offset 65 for lp_amount(8)
  const lpAmount = readU64LE(lpPosInfo.data, 65)
  if (lpAmount === 0n) return null

  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)
  const lpATA = await getAssociatedTokenAddress(lpMint, deployer.publicKey)

  // RemoveLiquidity: disc=3, lp_amount(8) + min_amount_a(8) + min_amount_b(8)
  const data = Buffer.alloc(25)
  data[0] = 3
  writeU64LE(data, 1, lpAmount)
  writeU64LE(data, 9, 0n)
  writeU64LE(data, 17, 0n)

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: mythATA, isSigner: false, isWritable: true },
      { pubkey: wsolATA, isSigner: false, isWritable: true },
      { pubkey: lpATA, isSigner: false, isWritable: true },
      { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  })

  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [deployer], TX_OPTS)
  return sig
}

async function addLiquidityAtPrice(conn, deployer, poolPDA, vaultA, vaultB, lpMint, targetPrice, mythIsA) {
  // Match L1 reserve amounts exactly if available, otherwise use deployer balance
  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)

  let mythToAdd, wsolNeeded

  if (lastKnownL1Reserves && lastKnownL1Reserves.mythReserve > 0) {
    // Use exact L1 pool reserve amounts
    mythToAdd = BigInt(Math.round(lastKnownL1Reserves.mythReserve * 10 ** MYTH_DECIMALS))
    wsolNeeded = BigInt(Math.round(lastKnownL1Reserves.solReserve * 10 ** WSOL_DECIMALS))
    console.log(`[${ts()}] Matching L1 reserves: ${lastKnownL1Reserves.mythReserve.toFixed(0)} MYTH / ${lastKnownL1Reserves.solReserve.toFixed(4)} SOL`)
  } else {
    // Fallback: use deployer balance at target price ratio
    const rawPriceRatio = targetPrice * (10 ** WSOL_DECIMALS) / (10 ** MYTH_DECIMALS)
    const mythBal = BigInt((await conn.getTokenAccountBalance(mythATA)).value.amount)
    mythToAdd = mythBal * 9n / 10n
    wsolNeeded = BigInt(Math.ceil(Number(mythToAdd) * rawPriceRatio))
    console.log(`[${ts()}] No L1 reserves available, using deployer balance`)
  }

  // Ensure deployer has enough of both tokens (mint if needed)
  const mythBal = BigInt((await conn.getTokenAccountBalance(mythATA)).value.amount)
  const wsolBal = BigInt((await conn.getTokenAccountBalance(wsolATA)).value.amount)

  if (mythBal < mythToAdd) {
    const mintAmount = mythToAdd - mythBal + 1_000_000n
    console.log(`[${ts()}] Minting ${mintAmount} MYTH for LP`)
    const tx = new Transaction().add(createMintToInstruction(MYTH_MINT, mythATA, deployer.publicKey, mintAmount))
    await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  }

  if (wsolBal < wsolNeeded) {
    const mintAmount = wsolNeeded - wsolBal + 1_000_000n
    console.log(`[${ts()}] Minting ${mintAmount} wSOL for LP`)
    const tx = new Transaction().add(createMintToInstruction(WSOL_MINT, wsolATA, deployer.publicKey, mintAmount))
    await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  }

  if (mythToAdd <= 0n || wsolNeeded <= 0n) {
    console.log(`[${ts()}] Cannot add liquidity: MYTH=${mythToAdd}, wSOL=${wsolNeeded}`)
    return
  }

  // Sort amounts according to pool token ordering
  const amountA = mythIsA ? mythToAdd : wsolNeeded
  const amountB = mythIsA ? wsolNeeded : mythToAdd

  // LP position PDA
  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, poolPDA.toBuffer(), deployer.publicKey.toBuffer()],
    SWAP_PROGRAM
  )
  const lpATA = await getAssociatedTokenAddress(lpMint, deployer.publicKey)

  // AddLiquidity: disc=2, desired_amount_a(8) + desired_amount_b(8) + min_lp_tokens(8)
  const data = Buffer.alloc(25)
  data[0] = 2
  writeU64LE(data, 1, amountA)
  writeU64LE(data, 9, amountB)
  writeU64LE(data, 17, 0n)

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: mythATA, isSigner: false, isWritable: true },
      { pubkey: wsolATA, isSigner: false, isWritable: true },
      { pubkey: lpATA, isSigner: false, isWritable: true },
      { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })

  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [deployer], TX_OPTS)
  return sig
}

// ═══════════════════════════════════════════════════════════════
// Fallback: Swap-based rebalance (for when pool has other LPs)
// ═══════════════════════════════════════════════════════════════

async function swapRebalance(conn, deployer, l1Price, reserveA, reserveB, mythIsA, poolPDA, vaultA, vaultB) {
  const { configPDA, protocolVaultPDA } = getPoolInfo()

  const mythReserve = mythIsA ? reserveA : reserveB
  const wsolReserve = mythIsA ? reserveB : reserveA

  const k = Number(mythReserve) * Number(wsolReserve)
  const rawPriceRatio = l1Price * (10 ** WSOL_DECIMALS) / (10 ** MYTH_DECIMALS)
  const targetMyth = Math.sqrt(k / rawPriceRatio)

  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)

  let aToB, swapAmount, inputMint

  if (Number(mythReserve) < targetMyth) {
    // Need more MYTH in pool → swap MYTH in (push MYTH, pull wSOL)
    swapAmount = BigInt(Math.ceil(targetMyth - Number(mythReserve)))
    aToB = mythIsA
    inputMint = MYTH_MINT

    // Ensure deployer has enough MYTH
    const bal = BigInt((await conn.getTokenAccountBalance(mythATA)).value.amount)
    if (bal < swapAmount) {
      const mint = swapAmount - bal + 1_000_000n
      console.log(`[${ts()}] Minting ${mint} MYTH for swap rebalance`)
      await sendAndConfirmTransaction(conn,
        new Transaction().add(createMintToInstruction(MYTH_MINT, mythATA, deployer.publicKey, mint)),
        [deployer], TX_OPTS)
    }
  } else {
    // Need more wSOL in pool → swap wSOL in
    const targetWsol = k / targetMyth
    swapAmount = BigInt(Math.ceil(targetWsol - Number(wsolReserve)))
    aToB = !mythIsA
    inputMint = WSOL_MINT

    const bal = BigInt((await conn.getTokenAccountBalance(wsolATA)).value.amount)
    if (bal < swapAmount) {
      const mint = swapAmount - bal + 1_000_000n
      console.log(`[${ts()}] Minting ${mint} wSOL for swap rebalance`)
      await sendAndConfirmTransaction(conn,
        new Transaction().add(createMintToInstruction(WSOL_MINT, wsolATA, deployer.publicKey, mint)),
        [deployer], TX_OPTS)
    }
  }

  if (swapAmount <= 0n) return

  const protocolFeeVaultToken = await getAssociatedTokenAddress(inputMint, protocolVaultPDA, true)

  const tx = new Transaction()
  const feeATAInfo = await conn.getAccountInfo(protocolFeeVaultToken)
  if (!feeATAInfo) {
    tx.add(createAssociatedTokenAccountInstruction(deployer.publicKey, protocolFeeVaultToken, protocolVaultPDA, inputMint))
  }

  const traderTokenIn = aToB
    ? (mythIsA ? mythATA : wsolATA)
    : (mythIsA ? wsolATA : mythATA)
  const traderTokenOut = aToB
    ? (mythIsA ? wsolATA : mythATA)
    : (mythIsA ? mythATA : wsolATA)

  const data = Buffer.alloc(18)
  data[0] = 4
  writeU64LE(data, 1, swapAmount)
  writeU64LE(data, 9, 0n)
  data[17] = aToB ? 1 : 0

  tx.add(new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: traderTokenIn, isSigner: false, isWritable: true },
      { pubkey: traderTokenOut, isSigner: false, isWritable: true },
      { pubkey: protocolFeeVaultToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  }))

  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  return sig
}

// ═══════════════════════════════════════════════════════════════
// Sync Cycle
// ═══════════════════════════════════════════════════════════════

async function syncCycle(conn, deployer) {
  try {
    // 1. Fetch L1 price
    const l1Price = await fetchL1Price()

    // 2. Read L2 pool state
    const { poolPDA, mythIsA } = getPoolInfo()
    const pool = await readPoolState(conn)

    if (pool.reserveA === 0n || pool.reserveB === 0n) {
      console.log(`[${ts()}] Pool has zero reserves — skipping`)
      return
    }

    // 3. Calculate L2 price and drift
    const l2Price = calculateL2Price(pool.reserveA, pool.reserveB, mythIsA)
    const drift = (l2Price - l1Price) / l1Price
    const driftPct = (drift * 100).toFixed(4)

    console.log(`[${ts()}] L1=${l1Price.toFixed(10)} | L2=${l2Price.toFixed(10)} | drift=${driftPct}%`)

    // Also check reserve size drift (L2 should match L1 pool depth)
    let reserveDrift = 0
    if (lastKnownL1Reserves && lastKnownL1Reserves.mythReserve > 0) {
      const mythRes = pool.mythIsA ? pool.reserveA : pool.reserveB
      const l2MythHuman = Number(mythRes) / 10 ** MYTH_DECIMALS
      reserveDrift = Math.abs(l2MythHuman - lastKnownL1Reserves.mythReserve) / lastKnownL1Reserves.mythReserve
    }

    if (Math.abs(drift) < DRIFT_THRESHOLD && reserveDrift < 0.05) {
      return // Within threshold for both price and reserves
    }

    const reason = Math.abs(drift) >= DRIFT_THRESHOLD
      ? `price drift ${driftPct}%`
      : `reserve drift ${(reserveDrift * 100).toFixed(1)}%`
    console.log(`[${ts()}] Rebalancing (${reason})`)

    // 4. Strategy: Try direct LP remove+reseed first (cleanest, instant convergence)
    //    Fallback to swap if remove LP fails (e.g., other LPs in pool)
    let usedSwapFallback = false

    try {
      // Remove deployer's LP
      const removeSig = await removeLiquidity(conn, deployer, poolPDA, pool.vaultA, pool.vaultB, pool.lpMint)

      if (removeSig) {
        console.log(`[${ts()}] Removed LP: ${removeSig}`)

        // Re-read pool state — if reserves are near zero, the pool is ours
        const poolAfter = await readPoolState(conn)

        if (poolAfter.reserveA <= 1000n && poolAfter.reserveB <= 1000n) {
          // Pool is empty (dust only) — reseed at exact target price
          const addSig = await addLiquidityAtPrice(
            conn, deployer, poolPDA, pool.vaultA, pool.vaultB, pool.lpMint, l1Price, mythIsA
          )
          if (addSig) console.log(`[${ts()}] Re-seeded LP at L1 price: ${addSig}`)
        } else {
          // Other LPs in pool — we removed ours but pool still has reserves
          // Need to swap to adjust price, then re-add our LP
          console.log(`[${ts()}] Pool still has reserves from other LPs — swap rebalancing`)
          const swapSig = await swapRebalance(conn, deployer, l1Price,
            poolAfter.reserveA, poolAfter.reserveB, mythIsA, poolPDA, pool.vaultA, pool.vaultB)
          if (swapSig) console.log(`[${ts()}] Swap rebalance: ${swapSig}`)
          usedSwapFallback = true

          // Re-add LP at new ratio
          const poolAfterSwap = await readPoolState(conn)
          const newPrice = calculateL2Price(poolAfterSwap.reserveA, poolAfterSwap.reserveB, mythIsA)
          const addSig = await addLiquidityAtPrice(
            conn, deployer, poolPDA, pool.vaultA, pool.vaultB, pool.lpMint, newPrice, mythIsA
          )
          if (addSig) console.log(`[${ts()}] Re-added LP: ${addSig}`)
        }
      } else {
        // No LP position to remove — just swap
        console.log(`[${ts()}] No deployer LP — swap rebalancing`)
        const swapSig = await swapRebalance(conn, deployer, l1Price,
          pool.reserveA, pool.reserveB, mythIsA, poolPDA, pool.vaultA, pool.vaultB)
        if (swapSig) console.log(`[${ts()}] Swap rebalance: ${swapSig}`)
        usedSwapFallback = true
      }
    } catch (innerErr) {
      // If LP remove/reseed fails, fall back to swap
      console.log(`[${ts()}] LP adjust failed (${innerErr.message}), falling back to swap`)
      try {
        const swapSig = await swapRebalance(conn, deployer, l1Price,
          pool.reserveA, pool.reserveB, mythIsA, poolPDA, pool.vaultA, pool.vaultB)
        if (swapSig) console.log(`[${ts()}] Swap fallback: ${swapSig}`)
        usedSwapFallback = true
      } catch (swapErr) {
        console.error(`[${ts()}] Swap fallback also failed:`, swapErr.message)
      }
    }

    // 5. Verify final price
    const finalPool = await readPoolState(conn)
    const finalL2Price = calculateL2Price(finalPool.reserveA, finalPool.reserveB, mythIsA)
    const finalDrift = ((finalL2Price - l1Price) / l1Price * 100).toFixed(4)
    const method = usedSwapFallback ? 'swap' : 'reseed'
    console.log(`[${ts()}] Post-${method}: L2=${finalL2Price.toFixed(10)} | drift=${finalDrift}%`)

    // If still drifted after swap fallback, run another swap immediately
    if (usedSwapFallback && Math.abs(parseFloat(finalDrift)) > DRIFT_THRESHOLD * 100) {
      console.log(`[${ts()}] Still drifted — running second swap pass`)
      try {
        await swapRebalance(conn, deployer, l1Price,
          finalPool.reserveA, finalPool.reserveB, mythIsA, poolPDA, finalPool.vaultA, finalPool.vaultB)
        const check = await readPoolState(conn)
        const checkPrice = calculateL2Price(check.reserveA, check.reserveB, mythIsA)
        console.log(`[${ts()}] After 2nd pass: L2=${checkPrice.toFixed(10)} | drift=${((checkPrice - l1Price) / l1Price * 100).toFixed(4)}%`)
      } catch (e) {
        console.error(`[${ts()}] 2nd pass failed:`, e.message)
      }
    }

  } catch (err) {
    console.error(`[${ts()}] Sync error:`, err.message || err)
    if (consecutiveErrors > 10) {
      console.error(`[${ts()}] 10+ consecutive errors — backing off 60s`)
      await new Promise(r => setTimeout(r, 60_000))
      consecutiveErrors = 0
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  MYTH/wSOL Price Sync Daemon v2')
  console.log(`  Interval: ${SYNC_INTERVAL_MS / 1000}s | Threshold: ${DRIFT_THRESHOLD * 100}%`)
  console.log(`  Strategy: Direct LP reseed (swap fallback)`)
  console.log('═══════════════════════════════════════════════════')

  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`)

  // Derive pool info once
  const { poolPDA, mythIsA } = getPoolInfo()
  console.log(`Pool PDA: ${poolPDA.toBase58()}`)
  console.log(`MYTH is token ${mythIsA ? 'A' : 'B'}`)

  // Run immediately
  await syncCycle(conn, deployer)

  // Then every 30 seconds
  setInterval(() => syncCycle(conn, deployer), SYNC_INTERVAL_MS)
}

main().catch(err => {
  console.error('FATAL:', err.message || err)
  process.exit(1)
})
