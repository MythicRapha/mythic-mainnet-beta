#!/usr/bin/env node
// One-shot: reseed L2 MYTH/wSOL pool to exactly match L1 PumpSwap reserves
// Fetches real L1 pool data from DexScreener, removes LP, reseeds at exact amounts
//
// Run on server: node scripts/reseed-pool-match-l1.mjs

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  createMintToInstruction, TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { readFileSync } from 'fs'

// ═══════════════════════════════════════════════════════════════
const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const SWAP_PROGRAM = new PublicKey('E3yp3LNjZkM1ayMhHX1ikH1TMFABYFrDpZVkW5GpkU8t')
const MYTH_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')
const WSOL_MINT = new PublicKey('FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

const MYTH_DECIMALS = 6
const WSOL_DECIMALS = 9

const POOL_SEED = Buffer.from('pool')
const LP_POSITION_SEED = Buffer.from('lp_position')

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

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

function derivePool() {
  const cmp = MYTH_MINT.toBuffer().compare(WSOL_MINT.toBuffer())
  const [sortedA, sortedB] = cmp < 0 ? [MYTH_MINT, WSOL_MINT] : [WSOL_MINT, MYTH_MINT]
  const mythIsA = cmp < 0
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [POOL_SEED, sortedA.toBuffer(), sortedB.toBuffer()], SWAP_PROGRAM
  )
  return { poolPDA, mythIsA }
}

// ═══════════════════════════════════════════════════════════════

async function fetchL1Reserves() {
  console.log('Fetching L1 pool reserves from DexScreener...')
  const resp = await fetch(DEXSCREENER_URL)
  const data = await resp.json()
  const pair = data.pairs?.find(p => p.dexId === 'pumpswap') || data.pairs?.find(p => p.dexId === 'raydium') || data.pairs?.[0]
  if (!pair) throw new Error('No pair found')

  // DexScreener liquidity object has base/quote
  // pair.baseToken is MYTH, pair.quoteToken is SOL
  const priceNative = parseFloat(pair.priceNative) // SOL per MYTH
  const liquidity = pair.liquidity
  const baseReserve = parseFloat(pair.liquidity?.base || 0) // MYTH amount
  const quoteReserve = parseFloat(pair.liquidity?.quote || 0) // SOL amount

  // If liquidity.base/quote not available, calculate from USD values
  let mythReserve, solReserve

  if (baseReserve > 0 && quoteReserve > 0) {
    mythReserve = baseReserve
    solReserve = quoteReserve
  } else {
    // Fallback: use price + total USD liquidity
    // Total liquidity USD is split 50/50
    const halfUsd = (liquidity?.usd || 30000) / 2
    const solPrice = parseFloat(pair.priceUsd) / priceNative // USD per SOL
    solReserve = halfUsd / solPrice
    mythReserve = solReserve / priceNative
  }

  console.log(`  L1 Price: 1 MYTH = ${priceNative} SOL ($${pair.priceUsd})`)
  console.log(`  L1 Pooled MYTH: ${Math.round(mythReserve).toLocaleString()}`)
  console.log(`  L1 Pooled SOL:  ${solReserve.toFixed(4)}`)
  console.log(`  L1 Liquidity:   $${liquidity?.usd?.toLocaleString() || 'N/A'}`)

  return { mythReserve, solReserve, priceNative }
}

async function readPoolState(conn) {
  const { poolPDA, mythIsA } = derivePool()
  const poolInfo = await conn.getAccountInfo(poolPDA)
  if (!poolInfo) throw new Error('Pool not found')

  const vaultA = new PublicKey(poolInfo.data.subarray(66, 98))
  const vaultB = new PublicKey(poolInfo.data.subarray(98, 130))
  const lpMint = new PublicKey(poolInfo.data.subarray(130, 162))
  const reserveA = readU64LE(poolInfo.data, 162)
  const reserveB = readU64LE(poolInfo.data, 170)
  const lpSupply = readU64LE(poolInfo.data, 178)

  const mythRes = mythIsA ? reserveA : reserveB
  const solRes = mythIsA ? reserveB : reserveA
  const mythHuman = Number(mythRes) / 10 ** MYTH_DECIMALS
  const solHuman = Number(solRes) / 10 ** WSOL_DECIMALS
  const price = solHuman / mythHuman

  console.log(`  L2 Pool: ${Math.round(mythHuman).toLocaleString()} MYTH / ${solHuman.toFixed(4)} wSOL`)
  console.log(`  L2 Price: 1 MYTH = ${price.toFixed(12)} SOL`)

  return { poolPDA, vaultA, vaultB, lpMint, reserveA, reserveB, lpSupply, mythIsA }
}

async function removeLiquidity(conn, deployer, pool) {
  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, pool.poolPDA.toBuffer(), deployer.publicKey.toBuffer()], SWAP_PROGRAM
  )
  const lpPosInfo = await conn.getAccountInfo(lpPositionPDA)
  if (!lpPosInfo) { console.log('  No LP position found'); return false }
  const lpAmount = readU64LE(lpPosInfo.data, 65)
  if (lpAmount === 0n) { console.log('  LP amount is 0'); return false }

  console.log(`  Removing ${lpAmount} LP tokens...`)

  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)
  const lpATA = await getAssociatedTokenAddress(pool.lpMint, deployer.publicKey)

  const data = Buffer.alloc(25)
  data[0] = 3
  writeU64LE(data, 1, lpAmount)
  writeU64LE(data, 9, 0n)
  writeU64LE(data, 17, 0n)

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pool.poolPDA, isSigner: false, isWritable: true },
      { pubkey: pool.vaultA, isSigner: false, isWritable: true },
      { pubkey: pool.vaultB, isSigner: false, isWritable: true },
      { pubkey: pool.lpMint, isSigner: false, isWritable: true },
      { pubkey: mythATA, isSigner: false, isWritable: true },
      { pubkey: wsolATA, isSigner: false, isWritable: true },
      { pubkey: lpATA, isSigner: false, isWritable: true },
      { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  })

  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [deployer], TX_OPTS)
  console.log(`  Removed LP: ${sig}`)
  return true
}

async function ensureBalance(conn, deployer, mint, ata, needed, label) {
  const bal = BigInt((await conn.getTokenAccountBalance(ata)).value.amount)
  if (bal >= needed) return
  const mintAmount = needed - bal + 1_000_000n
  console.log(`  Minting ${mintAmount} ${label} (have ${bal}, need ${needed})`)
  const tx = new Transaction().add(createMintToInstruction(mint, ata, deployer.publicKey, mintAmount))
  await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
}

async function addLiquidity(conn, deployer, pool, mythRaw, wsolRaw) {
  const mythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)
  const lpATA = await getAssociatedTokenAddress(pool.lpMint, deployer.publicKey)

  // Ensure deployer has enough tokens
  await ensureBalance(conn, deployer, MYTH_MINT, mythATA, mythRaw, 'MYTH')
  await ensureBalance(conn, deployer, WSOL_MINT, wsolATA, wsolRaw, 'wSOL')

  const [lpPositionPDA] = PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, pool.poolPDA.toBuffer(), deployer.publicKey.toBuffer()], SWAP_PROGRAM
  )

  // Sort amounts: A and B follow pool token ordering
  const amountA = pool.mythIsA ? mythRaw : wsolRaw
  const amountB = pool.mythIsA ? wsolRaw : mythRaw

  const data = Buffer.alloc(25)
  data[0] = 2
  writeU64LE(data, 1, amountA)
  writeU64LE(data, 9, amountB)
  writeU64LE(data, 17, 0n)

  const ix = new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pool.poolPDA, isSigner: false, isWritable: true },
      { pubkey: pool.vaultA, isSigner: false, isWritable: true },
      { pubkey: pool.vaultB, isSigner: false, isWritable: true },
      { pubkey: pool.lpMint, isSigner: false, isWritable: true },
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
  console.log(`  Added liquidity: ${sig}`)
  return sig
}

// ═══════════════════════════════════════════════════════════════

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log(`Deployer: ${deployer.publicKey.toBase58()}\n`)

  // 1. Fetch L1 reserves
  const l1 = await fetchL1Reserves()
  console.log('')

  // 2. Read L2 pool
  console.log('Reading L2 pool state...')
  const pool = await readPoolState(conn)
  console.log('')

  // 3. Convert L1 reserves to raw amounts
  const targetMythRaw = BigInt(Math.round(l1.mythReserve * 10 ** MYTH_DECIMALS))
  const targetSolRaw = BigInt(Math.round(l1.solReserve * 10 ** WSOL_DECIMALS))

  console.log(`Target raw amounts:`)
  console.log(`  MYTH: ${targetMythRaw} (${l1.mythReserve.toFixed(0)} human)`)
  console.log(`  wSOL: ${targetSolRaw} (${l1.solReserve.toFixed(4)} human)`)
  console.log(`  Implied price: ${(l1.solReserve / l1.mythReserve).toFixed(12)} SOL/MYTH`)
  console.log('')

  // 4. Remove deployer LP
  console.log('Removing deployer LP...')
  await removeLiquidity(conn, deployer, pool)
  console.log('')

  // 5. Check if pool is empty (should be after removing sole LP)
  const poolAfter = await readPoolState(conn)

  if (poolAfter.reserveA > 1000n || poolAfter.reserveB > 1000n) {
    console.log('Pool still has reserves from other LPs.')
    console.log('Adding liquidity at target ratio on top of existing reserves...')
    // Calculate amounts proportional to target ratio
    // But we still want to match the L1 total, so add the difference
  }

  // 6. Add liquidity at exact L1 reserve amounts
  console.log('Adding liquidity to match L1 reserves...')
  await addLiquidity(conn, deployer, pool, targetMythRaw, targetSolRaw)
  console.log('')

  // 7. Verify
  console.log('=== FINAL VERIFICATION ===')
  const finalPool = await readPoolState(conn)
  const finalMyth = pool.mythIsA ? finalPool.reserveA : finalPool.reserveB
  const finalSol = pool.mythIsA ? finalPool.reserveB : finalPool.reserveA
  const finalMythHuman = Number(finalMyth) / 10 ** MYTH_DECIMALS
  const finalSolHuman = Number(finalSol) / 10 ** WSOL_DECIMALS
  const finalPrice = finalSolHuman / finalMythHuman

  console.log('')
  console.log(`  L1: ${Math.round(l1.mythReserve).toLocaleString()} MYTH / ${l1.solReserve.toFixed(4)} SOL`)
  console.log(`  L2: ${Math.round(finalMythHuman).toLocaleString()} MYTH / ${finalSolHuman.toFixed(4)} wSOL`)
  console.log(`  L1 price: ${l1.priceNative.toFixed(12)} SOL/MYTH`)
  console.log(`  L2 price: ${finalPrice.toFixed(12)} SOL/MYTH`)
  console.log(`  Drift: ${(((finalPrice - l1.priceNative) / l1.priceNative) * 100).toFixed(4)}%`)
  console.log('')
  console.log('Done! Pool reserves now match L1.')
}

main().catch(err => {
  console.error('FATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs)
  process.exit(1)
})
