#!/usr/bin/env node
// Verify and restore L1 bridge challenge period to 86400s (24h)
// Run: node scripts/verify-challenge-period.mjs

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { readFileSync } from 'fs'

const L1_RPC = 'https://api.mainnet-beta.solana.com'
const BRIDGE_PROGRAM = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ')
const CONFIG_SEED = Buffer.from('bridge_config')
const TARGET_PERIOD = 86400n // 24 hours

// Derive config PDA
const [configPDA] = PublicKey.findProgramAddressSync([CONFIG_SEED], BRIDGE_PROGRAM)

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

async function main() {
  const conn = new Connection(L1_RPC, 'confirmed')
  console.log(`Config PDA: ${configPDA.toBase58()}`)

  // Read current config
  const configInfo = await conn.getAccountInfo(configPDA)
  if (!configInfo) {
    console.error('Bridge config not found!')
    process.exit(1)
  }

  // BridgeConfig layout: admin(32) + sequencer(32) + challenge_period(i64 at offset 64)
  const currentPeriod = configInfo.data.readBigInt64LE(64)
  console.log(`Current challenge_period: ${currentPeriod}s`)

  if (currentPeriod === TARGET_PERIOD) {
    console.log(`Challenge period is already ${TARGET_PERIOD}s (24h). All good!`)
    process.exit(0)
  }

  console.log(`Challenge period is ${currentPeriod}s, NOT ${TARGET_PERIOD}s. FIXING...`)

  const deployer = loadKeypair('/Users/raphaelcardona/mythic-l2/keys/deployer.json')
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`)

  // UpdateConfig: disc=6, new_sequencer: Option<Pubkey>=None, new_challenge_period: Option<i64>=Some(86400)
  const buf = Buffer.alloc(11)
  buf[0] = 6  // UpdateConfig discriminator
  buf[1] = 0  // None for new_sequencer
  buf[2] = 1  // Some for new_challenge_period
  buf.writeBigInt64LE(TARGET_PERIOD, 3)

  const ix = new TransactionInstruction({
    programId: BRIDGE_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
    ],
    data: buf,
  })

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], { commitment: 'confirmed' })
  console.log(`Updated! TX: ${sig}`)

  // Verify
  const newConfig = await conn.getAccountInfo(configPDA)
  const newPeriod = newConfig.data.readBigInt64LE(64)
  console.log(`Verified challenge_period: ${newPeriod}s`)
}

main().catch(err => {
  console.error('Error:', err.message || err)
  process.exit(1)
})
