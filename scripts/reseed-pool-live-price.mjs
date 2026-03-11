#!/usr/bin/env node
// Re-seed MYTH/wSOL pool at LIVE L1 price from DexScreener
// Steps:
// 1. Fetch live price from DexScreener
// 2. Remove deployer's LP from existing pool
// 3. Swap MYTH into pool to set correct price ratio
// 4. Add 2M MYTH + equivalent wSOL as liquidity

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
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
const MYTH_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')
const WSOL_MINT = new PublicKey('FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

const MYTH_DECIMALS = 6
const WSOL_DECIMALS = 9
const MYTH_AMOUNT = 2_000_000 // 2M MYTH to seed

// Pool info (from on-chain state)
const POOL_PDA = new PublicKey('F1mZ26qS1tF7NEVKJayEU4Zf6Wnp3vSF1bN6WMW8CuY4')
const VAULT_A = new PublicKey('EW1RtpoGM8F74aoLXaUZT48n4CjjJwcbAzZb4bZtnwbS')  // MYTH vault
const VAULT_B = new PublicKey('8VMk2YtL7YFvNUkEuH8CXJBwvJdMZfS4ERtSErARCh7T')  // wSOL vault
const LP_MINT = new PublicKey('Gk2Be8yjZhTLTBb4Wb5Ap9YAza74mgeMbrTbDC16v5KB')

// Seeds
const SWAP_CONFIG_SEED = Buffer.from('swap_config')
const LP_POSITION_SEED = Buffer.from('lp_position')
const POOL_SEED = Buffer.from('pool')
const PROTOCOL_VAULT_SEED = Buffer.from('protocol_vault')

// DexScreener API
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ═══════════════════════════════════════════════════════════════
// Step 1: Fetch Live Price
// ═══════════════════════════════════════════════════════════════

async function fetchLivePrice() {
  console.log('\n═══ Step 1: Fetching live MYTH/SOL price from DexScreener ═══')
  const resp = await fetch(DEXSCREENER_URL)
  const data = await resp.json()

  // Find the PumpSwap pair
  const pair = data.pairs?.find(p => p.dexId === 'pumpswap' || p.dexId === 'raydium') || data.pairs?.[0]
  if (!pair) throw new Error('No pair found on DexScreener')

  const priceInSol = parseFloat(pair.priceNative)
  const priceInUsd = parseFloat(pair.priceUsd)

  console.log(`  Price: 1 MYTH = ${priceInSol} SOL ($${priceInUsd})`)
  console.log(`  Liquidity: $${pair.liquidity?.usd || 'N/A'}`)
  console.log(`  DEX: ${pair.dexId}`)

  return { priceInSol, priceInUsd }
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Remove Deployer's LP
// ═══════════════════════════════════════════════════════════════

async function removeLiquidity(conn, deployer) {
  console.log('\n═══ Step 2: Removing deployer LP from MYTH/wSOL pool ═══')

  // Derive LP position PDA (note: seed order is [LP_POSITION_SEED, pool, depositor] based on add_liquidity)
  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, POOL_PDA.toBuffer(), deployer.publicKey.toBuffer()],
    SWAP_PROGRAM
  )

  // Check LP position
  const lpPosInfo = await conn.getAccountInfo(lpPositionPDA)
  if (!lpPosInfo) {
    console.log('  No LP position found — may already be drained')
    return
  }

  // LpPosition layout: is_initialized(1) + owner(32) + pool(32) = offset 65 for lp_amount(8)
  const lpAmount = readU64LE(lpPosInfo.data, 65)
  if (lpAmount === 0n) {
    console.log('  LP amount is 0 — already drained')
    return
  }
  console.log(`  Deployer LP amount: ${lpAmount} raw (${fromRawMYTH(lpAmount)} at 6 dec)`)

  // Get deployer ATAs
  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)
  const lpATA = await getAssociatedTokenAddress(LP_MINT, deployer.publicKey)

  // RemoveLiquidity: disc=3, lp_amount(8) + min_amount_a(8) + min_amount_b(8)
  const data = Buffer.alloc(1 + 24)
  data[0] = 3
  writeU64LE(data, 1, lpAmount)
  writeU64LE(data, 9, 0n)   // min_amount_a = 0
  writeU64LE(data, 17, 0n)  // min_amount_b = 0

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_PDA, isSigner: false, isWritable: true },
      { pubkey: VAULT_A, isSigner: false, isWritable: true },
      { pubkey: VAULT_B, isSigner: false, isWritable: true },
      { pubkey: LP_MINT, isSigner: false, isWritable: true },
      { pubkey: mythATA, isSigner: false, isWritable: true },
      { pubkey: wsolATA, isSigner: false, isWritable: true },
      { pubkey: lpATA, isSigner: false, isWritable: true },
      { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log(`  RemoveLiquidity tx: ${sig}`)

  // Read pool state after drain
  await sleep(1000)
  const poolInfo = await conn.getAccountInfo(POOL_PDA)
  const reserveA = readU64LE(poolInfo.data, 162) // offset for reserve_a
  const reserveB = readU64LE(poolInfo.data, 170) // offset for reserve_b
  const lpSupply = readU64LE(poolInfo.data, 178) // offset for lp_supply
  console.log(`  Pool after drain: reserve_a=${reserveA}, reserve_b=${reserveB}, lp_supply=${lpSupply}`)

  return { reserveA, reserveB, lpSupply }
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Swap to Set Correct Price Ratio
// ═══════════════════════════════════════════════════════════════

async function swapToSetPrice(conn, deployer, priceInSol, reserveA, reserveB) {
  console.log('\n═══ Step 3: Swapping to set correct price ratio ═══')

  // Target price: 1 MYTH = priceInSol SOL
  // In raw: 10^6 raw_MYTH = priceInSol * 10^9 raw_wSOL
  // Target ratio: reserve_wSOL / reserve_MYTH = priceInSol * 10^9 / 10^6 = priceInSol * 1000
  const targetRatio = priceInSol * 1000 // wSOL_raw / MYTH_raw

  console.log(`  Current reserves: MYTH=${reserveA}, wSOL=${reserveB}`)
  console.log(`  Target ratio (wSOL/MYTH raw): ${targetRatio}`)
  console.log(`  Current ratio: ${Number(reserveB) / Number(reserveA)}`)

  // With constant product k = reserveA * reserveB:
  // target: reserve_wSOL = targetRatio * reserve_MYTH
  // targetRatio * reserve_MYTH^2 = k
  // reserve_MYTH = sqrt(k / targetRatio)
  const k = Number(reserveA) * Number(reserveB)
  const targetReserveMYTH = Math.sqrt(k / targetRatio)
  const targetReserveWSOL = k / targetReserveMYTH

  console.log(`  Target reserves: MYTH≈${Math.round(targetReserveMYTH)}, wSOL≈${Math.round(targetReserveWSOL)}`)

  if (targetReserveMYTH > Number(reserveA)) {
    // Need to swap MYTH → wSOL (push more MYTH in, take wSOL out)
    // Amount of MYTH to swap in (approximate, before fees):
    const mythToSwap = Math.ceil(targetReserveMYTH - Number(reserveA)) + 100 // add buffer
    console.log(`  Swapping ~${mythToSwap} raw MYTH → wSOL (a_to_b = true)`)

    await executeSwap(conn, deployer, BigInt(mythToSwap), true)
  } else {
    // Need to swap wSOL → MYTH (push more wSOL in, take MYTH out)
    const wsolToSwap = Math.ceil(targetReserveWSOL - Number(reserveB)) + 100
    console.log(`  Swapping ~${wsolToSwap} raw wSOL → MYTH (a_to_b = false)`)

    await executeSwap(conn, deployer, BigInt(wsolToSwap), false)
  }

  // Read updated pool state
  await sleep(1000)
  const poolInfo = await conn.getAccountInfo(POOL_PDA)
  const newReserveA = readU64LE(poolInfo.data, 162)
  const newReserveB = readU64LE(poolInfo.data, 170)
  const newRatio = Number(newReserveB) / Number(newReserveA)
  const impliedPrice = newRatio / 1000 // SOL per MYTH

  console.log(`  Post-swap reserves: MYTH=${newReserveA}, wSOL=${newReserveB}`)
  console.log(`  Post-swap ratio: ${newRatio} (target was ${targetRatio})`)
  console.log(`  Implied price: 1 MYTH = ${impliedPrice} SOL (target: ${priceInSol})`)

  return { reserveA: newReserveA, reserveB: newReserveB }
}

async function executeSwap(conn, deployer, amountIn, aToB) {
  // Derive config PDA
  const [configPDA] = PublicKey.findProgramAddressSync(
    [SWAP_CONFIG_SEED],
    SWAP_PROGRAM
  )

  // Derive protocol vault PDA
  const [protocolVaultPDA] = PublicKey.findProgramAddressSync(
    [PROTOCOL_VAULT_SEED],
    SWAP_PROGRAM
  )

  // Get deployer ATAs
  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)

  // Protocol fee vault token = ATA of protocol_vault for the INPUT token
  const inputMint = aToB ? MYTH_MINT : WSOL_MINT
  const protocolFeeVaultToken = await getAssociatedTokenAddress(inputMint, protocolVaultPDA, true)

  // Ensure protocol fee vault token ATA exists
  const tx = new Transaction()
  const feeATAInfo = await conn.getAccountInfo(protocolFeeVaultToken)
  if (!feeATAInfo) {
    console.log(`  Creating protocol fee vault ATA for ${aToB ? 'MYTH' : 'wSOL'}...`)
    tx.add(createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      protocolFeeVaultToken,
      protocolVaultPDA,
      inputMint
    ))
  }

  // SwapArgs: amount_in(8) + min_amount_out(8) + a_to_b(1)
  const data = Buffer.alloc(1 + 17)
  data[0] = 4 // Swap
  writeU64LE(data, 1, amountIn)
  writeU64LE(data, 9, 0n) // min_amount_out = 0 (no slippage check for admin)
  data[17] = aToB ? 1 : 0

  const traderTokenIn = aToB ? mythATA : wsolATA
  const traderTokenOut = aToB ? wsolATA : mythATA

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: POOL_PDA, isSigner: false, isWritable: true },
      { pubkey: VAULT_A, isSigner: false, isWritable: true },
      { pubkey: VAULT_B, isSigner: false, isWritable: true },
      { pubkey: traderTokenIn, isSigner: false, isWritable: true },
      { pubkey: traderTokenOut, isSigner: false, isWritable: true },
      { pubkey: protocolFeeVaultToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  })
  tx.add(ix)

  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log(`  Swap tx: ${sig}`)
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Add Liquidity at Correct Price
// ═══════════════════════════════════════════════════════════════

async function addLiquidity(conn, deployer, priceInSol, currentReserveA, currentReserveB) {
  console.log('\n═══ Step 4: Adding 2M MYTH + equivalent wSOL liquidity ═══')

  const mythRaw = toRawMYTH(MYTH_AMOUNT)
  // Calculate proportional wSOL based on current pool ratio
  const ratio = Number(currentReserveB) / Number(currentReserveA)
  const wsolRaw = BigInt(Math.ceil(Number(mythRaw) * ratio))

  const wsolAmount = fromRawWSOL(wsolRaw)
  console.log(`  Adding: ${MYTH_AMOUNT} MYTH (${mythRaw} raw) + ${wsolAmount} wSOL (${wsolRaw} raw)`)
  console.log(`  Expected price: 1 MYTH = ${ratio / 1000} SOL (target: ${priceInSol})`)

  // Get deployer ATAs
  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)
  const lpATA = await getAssociatedTokenAddress(LP_MINT, deployer.publicKey)

  // Derive LP position PDA
  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, POOL_PDA.toBuffer(), deployer.publicKey.toBuffer()],
    SWAP_PROGRAM
  )

  // Check deployer balances
  const mythBal = await conn.getTokenAccountBalance(mythATA)
  const wsolBal = await conn.getTokenAccountBalance(wsolATA)
  console.log(`  Deployer MYTH: ${mythBal.value.uiAmountString}`)
  console.log(`  Deployer wSOL: ${wsolBal.value.uiAmountString}`)

  if (BigInt(mythBal.value.amount) < mythRaw) {
    throw new Error(`Insufficient MYTH: have ${mythBal.value.uiAmountString}, need ${MYTH_AMOUNT}`)
  }
  if (BigInt(wsolBal.value.amount) < wsolRaw) {
    throw new Error(`Insufficient wSOL: have ${wsolBal.value.uiAmountString}, need ${wsolAmount}`)
  }

  // AddLiquidity: disc=2, desired_amount_a(8) + desired_amount_b(8) + min_lp_tokens(8)
  const data = Buffer.alloc(1 + 24)
  data[0] = 2
  writeU64LE(data, 1, mythRaw)
  writeU64LE(data, 9, wsolRaw)
  writeU64LE(data, 17, 0n) // min_lp_tokens = 0 (no slippage check for admin)

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_PDA, isSigner: false, isWritable: true },
      { pubkey: VAULT_A, isSigner: false, isWritable: true },
      { pubkey: VAULT_B, isSigner: false, isWritable: true },
      { pubkey: LP_MINT, isSigner: false, isWritable: true },
      { pubkey: mythATA, isSigner: false, isWritable: true },
      { pubkey: wsolATA, isSigner: false, isWritable: true },
      { pubkey: lpATA, isSigner: false, isWritable: true },
      { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log(`  AddLiquidity tx: ${sig}`)

  // Verify final pool state
  await sleep(1000)
  const poolInfo = await conn.getAccountInfo(POOL_PDA)
  const finalReserveA = readU64LE(poolInfo.data, 162)
  const finalReserveB = readU64LE(poolInfo.data, 170)
  const finalLpSupply = readU64LE(poolInfo.data, 178)
  const finalPrice = (Number(finalReserveB) / Number(finalReserveA)) / 1000

  console.log(`\n═══ FINAL POOL STATE ═══`)
  console.log(`  Reserve MYTH: ${fromRawMYTH(finalReserveA)} (${finalReserveA} raw)`)
  console.log(`  Reserve wSOL: ${fromRawWSOL(finalReserveB)} (${finalReserveB} raw)`)
  console.log(`  LP Supply: ${finalLpSupply} raw`)
  console.log(`  Price: 1 MYTH = ${finalPrice} SOL`)
  console.log(`  Target: 1 MYTH = ${priceInSol} SOL`)
  console.log(`  Drift: ${((finalPrice - priceInSol) / priceInSol * 100).toFixed(4)}%`)
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log('Deployer:', deployer.publicKey.toBase58())

  // Step 1: Fetch live price
  const { priceInSol } = await fetchLivePrice()

  // Step 2: Remove deployer's LP
  const drainResult = await removeLiquidity(conn, deployer)

  if (!drainResult) {
    // Pool was already drained, read current state
    const poolInfo = await conn.getAccountInfo(POOL_PDA)
    const reserveA = readU64LE(poolInfo.data, 162)
    const reserveB = readU64LE(poolInfo.data, 170)
    console.log(`  Current pool: MYTH=${reserveA}, wSOL=${reserveB}`)

    if (reserveA === 0n || reserveB === 0n) {
      console.log('  Pool has zero reserves — cannot swap to set price')
      console.log('  Pool needs to be recreated or manually seeded')
      process.exit(1)
    }

    // Step 3: Swap to set correct price
    const swapResult = await swapToSetPrice(conn, deployer, priceInSol, reserveA, reserveB)
    // Step 4: Add liquidity
    await addLiquidity(conn, deployer, priceInSol, swapResult.reserveA, swapResult.reserveB)
  } else {
    const { reserveA, reserveB } = drainResult

    if (reserveA === 0n || reserveB === 0n) {
      console.log('  Pool fully drained — cannot swap. Need manual re-creation.')
      process.exit(1)
    }

    // Step 3: Swap to set correct price
    const swapResult = await swapToSetPrice(conn, deployer, priceInSol, reserveA, reserveB)
    // Step 4: Add liquidity
    await addLiquidity(conn, deployer, priceInSol, swapResult.reserveA, swapResult.reserveB)
  }

  console.log('\n✅ Pool re-seeded successfully at live L1 price!')
}

main().catch(err => {
  console.error('\n❌ FATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs)
  process.exit(1)
})
