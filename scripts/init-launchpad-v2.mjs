#!/usr/bin/env node
// Initialize Launchpad V2 (with vanity mint support)
// New program: CLBeDnHqa55wcgYeQwYdFyaG7WXoBdSrJwijA7DUgNy1
// Run on server: node scripts/init-launchpad-v2.mjs

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

const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed' }

const LAUNCHPAD_V2_PROGRAM = new PublicKey('CLBeDnHqa55wcgYeQwYdFyaG7WXoBdSrJwijA7DUgNy1')
const FOUNDATION = new PublicKey('6SrpJsrLHFAs6iPHRNYmtEHUVnXyd1Q3iSqcVp8myth')

const PUMPSWAP_MYTH_CA = '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'
const GRADUATION_SOL_VALUE = 20
const MYTH_DECIMALS = 6
const PROTOCOL_FEE_BPS = 100

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

async function fetchMythPriceInSol() {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${PUMPSWAP_MYTH_CA}`
  console.log('Fetching MYTH price from DexScreener...')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`)
  const data = await res.json()
  if (!data.pairs || data.pairs.length === 0) throw new Error('No pairs found')
  const solPair = data.pairs
    .filter(p => p.quoteToken?.symbol === 'SOL' || p.baseToken?.symbol === 'SOL')
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]
  if (!solPair) throw new Error('No MYTH/SOL pair found')
  let priceInSol = solPair.baseToken?.address === PUMPSWAP_MYTH_CA
    ? parseFloat(solPair.priceNative)
    : 1 / parseFloat(solPair.priceNative)
  console.log(`  MYTH price: ${priceInSol.toFixed(12)} SOL`)
  return priceInSol
}

async function main() {
  console.log('Initialize Launchpad V2 (vanity mint support)')
  console.log(`Program: ${LAUNCHPAD_V2_PROGRAM.toBase58()}`)

  const priceInSol = await fetchMythPriceInSol()
  const mythAmount = GRADUATION_SOL_VALUE / priceInSol
  const GRADUATION_THRESHOLD = BigInt(Math.floor(mythAmount * (10 ** MYTH_DECIMALS)))
  console.log(`Graduation: ${GRADUATION_THRESHOLD} raw = ~${mythAmount.toFixed(0)} MYTH = ${GRADUATION_SOL_VALUE} SOL`)

  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`)

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('launchpad_config')],
    LAUNCHPAD_V2_PROGRAM
  )
  console.log(`Config PDA: ${configPDA.toBase58()}`)

  const configInfo = await conn.getAccountInfo(configPDA)
  if (configInfo && configInfo.data[0] === 1) {
    console.log('Already initialized!')
    return
  }

  const buf = Buffer.alloc(1 + 8 + 2 + 32)
  buf[0] = 0
  buf.writeBigUInt64LE(GRADUATION_THRESHOLD, 1)
  buf.writeUInt16LE(PROTOCOL_FEE_BPS, 9)
  FOUNDATION.toBuffer().copy(buf, 11)

  const ix = new TransactionInstruction({
    programId: LAUNCHPAD_V2_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buf,
  })

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log(`Initialize tx: ${sig}`)

  const newInfo = await conn.getAccountInfo(configPDA)
  if (newInfo && newInfo.data[0] === 1) {
    console.log('Launchpad V2 initialized successfully!')
  } else {
    console.error('ERROR: Config not initialized')
  }
}

main().catch(err => {
  console.error('FATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs)
  process.exit(1)
})
