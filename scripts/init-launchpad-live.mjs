#!/usr/bin/env node
// Phase 4: Initialize Launchpad Config on L2
// Fetches live MYTH/SOL price from PumpSwap to calculate 85 SOL worth of MYTH
// Run on server: node scripts/init-launchpad-live.mjs

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js'
import { readFileSync } from 'fs'

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const LAUNCHPAD_PROGRAM = new PublicKey('MythPad111111111111111111111111111111111111')
const FOUNDATION = new PublicKey('AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e')

// PumpSwap MYTH token on Solana L1
const PUMPSWAP_MYTH_CA = '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

// Graduation = 85 SOL worth of MYTH (calculated dynamically)
const GRADUATION_SOL_VALUE = 85
const MYTH_DECIMALS = 6
const PROTOCOL_FEE_BPS = 100  // 1%

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

function serializeBorsh(fields) {
  const buffers = []
  for (const [type, value] of fields) {
    if (type === 'u8') {
      const b = Buffer.alloc(1)
      b.writeUInt8(value, 0)
      buffers.push(b)
    } else if (type === 'u16') {
      const b = Buffer.alloc(2)
      b.writeUInt16LE(value, 0)
      buffers.push(b)
    } else if (type === 'u64') {
      const b = Buffer.alloc(8)
      b.writeBigUInt64LE(BigInt(value), 0)
      buffers.push(b)
    } else if (type === 'pubkey') {
      buffers.push(value.toBuffer())
    }
  }
  return Buffer.concat(buffers)
}

// ═══════════════════════════════════════════════════════════════
// Fetch live MYTH price from DexScreener (PumpSwap on Solana L1)
// ═══════════════════════════════════════════════════════════════

async function fetchMythPriceInSol() {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${PUMPSWAP_MYTH_CA}`
  console.log(`Fetching MYTH price from DexScreener...`)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`)
  const data = await res.json()

  if (!data.pairs || data.pairs.length === 0) {
    throw new Error('No pairs found for MYTH on DexScreener')
  }

  // Find the PumpSwap SOL pair (highest liquidity)
  const solPair = data.pairs
    .filter(p => p.quoteToken?.symbol === 'SOL' || p.baseToken?.symbol === 'SOL')
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]

  if (!solPair) {
    throw new Error('No MYTH/SOL pair found on DexScreener')
  }

  // Get price in SOL
  let priceInSol
  if (solPair.baseToken?.address === PUMPSWAP_MYTH_CA) {
    // MYTH is base, SOL is quote → priceNative = price in SOL
    priceInSol = parseFloat(solPair.priceNative)
  } else {
    // SOL is base, MYTH is quote → invert
    priceInSol = 1 / parseFloat(solPair.priceNative)
  }

  if (!priceInSol || priceInSol <= 0 || !isFinite(priceInSol)) {
    throw new Error(`Invalid MYTH price: ${priceInSol}`)
  }

  console.log(`  Pair: ${solPair.pairAddress}`)
  console.log(`  DEX: ${solPair.dexId}`)
  console.log(`  MYTH price: ${priceInSol.toFixed(12)} SOL`)
  console.log(`  Liquidity: $${solPair.liquidity?.usd?.toLocaleString() || 'unknown'}`)

  return priceInSol
}

// ═══════════════════════════════════════════════════════════════
// Calculate graduation threshold: 85 SOL worth of MYTH
// ═══════════════════════════════════════════════════════════════

function calculateGraduationThreshold(priceInSol) {
  // 85 SOL / pricePerMyth = number of MYTH tokens
  const mythAmount = GRADUATION_SOL_VALUE / priceInSol

  // Convert to raw (6 decimals)
  const rawAmount = BigInt(Math.floor(mythAmount * (10 ** MYTH_DECIMALS)))

  console.log(`\nGraduation threshold calculation:`)
  console.log(`  ${GRADUATION_SOL_VALUE} SOL / ${priceInSol.toFixed(12)} SOL/MYTH`)
  console.log(`  = ${mythAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} MYTH`)
  console.log(`  = ${rawAmount.toString()} raw (${MYTH_DECIMALS} decimals)`)

  return rawAmount
}

// ═══════════════════════════════════════════════════════════════
// Initialize Launchpad
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Phase 4: Initialize Launchpad Config')
  console.log('  Graduation = 85 SOL worth of MYTH (live price)')
  console.log('═══════════════════════════════════════════════════\n')

  // Step 1: Fetch live MYTH price
  const priceInSol = await fetchMythPriceInSol()
  const GRADUATION_THRESHOLD = calculateGraduationThreshold(priceInSol)

  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log(`\nDeployer: ${deployer.publicKey.toBase58()}`)

  // Derive config PDA
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('launchpad_config')],
    LAUNCHPAD_PROGRAM
  )
  console.log(`Config PDA: ${configPDA.toBase58()}`)

  // Check if already initialized
  const configInfo = await conn.getAccountInfo(configPDA)
  if (configInfo) {
    if (configInfo.data[0] === 1) {
      console.log('\nLaunchpad already initialized!')

      const admin = new PublicKey(configInfo.data.subarray(1, 33))
      const gradThreshold = configInfo.data.readBigUInt64LE(33)
      const feeBps = configInfo.data.readUInt16LE(41)
      const foundation = new PublicKey(configInfo.data.subarray(43, 75))
      const totalLaunched = configInfo.data.readBigUInt64LE(75)
      const totalCollected = configInfo.data.readBigUInt64LE(83)
      const totalGrads = configInfo.data.readBigUInt64LE(91)

      const currentMythValue = Number(gradThreshold) / (10 ** MYTH_DECIMALS)
      const currentSolValue = currentMythValue * priceInSol

      console.log(`  Admin: ${admin.toBase58()}`)
      console.log(`  Graduation threshold: ${gradThreshold} raw`)
      console.log(`    = ${currentMythValue.toLocaleString()} MYTH`)
      console.log(`    = ${currentSolValue.toFixed(2)} SOL at current price`)
      console.log(`  Protocol fee: ${feeBps} bps (${feeBps / 100}%)`)
      console.log(`  Foundation: ${foundation.toBase58()}`)
      console.log(`  Total launched: ${totalLaunched}`)
      console.log(`  Total collected: ${totalCollected}`)
      console.log(`  Total graduations: ${totalGrads}`)

      // Check if threshold needs updating (>10% drift from 85 SOL target)
      const drift = Math.abs(currentSolValue - GRADUATION_SOL_VALUE) / GRADUATION_SOL_VALUE
      if (drift > 0.10) {
        console.log(`\n  WARNING: Current threshold = ${currentSolValue.toFixed(2)} SOL (${(drift * 100).toFixed(1)}% drift from ${GRADUATION_SOL_VALUE} SOL target)`)
        console.log(`  Consider updating via UpdateConfig instruction`)
      } else {
        console.log(`\n  Threshold is within 10% of ${GRADUATION_SOL_VALUE} SOL target — OK`)
      }
      return
    }
  }

  // Build Initialize instruction
  // Discriminator 0 + graduation_threshold(u64) + protocol_fee_bps(u16) + foundation_wallet(pubkey)
  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['u64', GRADUATION_THRESHOLD],
      ['u16', PROTOCOL_FEE_BPS],
      ['pubkey', FOUNDATION],
    ]),
  ])

  const ix = new TransactionInstruction({
    programId: LAUNCHPAD_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log(`\nInitialize tx: ${sig}`)

  // Verify
  const newConfigInfo = await conn.getAccountInfo(configPDA)
  if (newConfigInfo && newConfigInfo.data[0] === 1) {
    const verifyThreshold = newConfigInfo.data.readBigUInt64LE(33)
    const verifyMythValue = Number(verifyThreshold) / (10 ** MYTH_DECIMALS)
    const verifySolValue = verifyMythValue * priceInSol

    console.log('\nLaunchpad initialized successfully!')
    console.log(`  Graduation threshold: ${verifyThreshold} raw`)
    console.log(`    = ${verifyMythValue.toLocaleString()} MYTH`)
    console.log(`    = ${verifySolValue.toFixed(2)} SOL worth at current price`)
    console.log(`  Protocol fee: ${PROTOCOL_FEE_BPS} bps (${PROTOCOL_FEE_BPS / 100}%)`)
    console.log(`  Foundation wallet: ${FOUNDATION.toBase58()}`)
  } else {
    console.error('ERROR: Config account not found or not initialized after tx')
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs)
  process.exit(1)
})
