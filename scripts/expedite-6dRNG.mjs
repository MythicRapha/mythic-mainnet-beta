#!/usr/bin/env node
// Expedite withdrawal for user 6dRNG64MjVBPbT9RajyJBmWYkWVbJ7nY19TT3VtBH3M9
// Old nonce 8 PDA is already past challenge period - just need to finalize

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
const TX_OPTS = { skipPreflight: false, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const BRIDGE_PROGRAM = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ')
const MYTH_MINT = new PublicKey('5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump')
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const CONFIG_PDA = new PublicKey('4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9')

const USER_WALLET = new PublicKey('6dRNG64MjVBPbT9RajyJBmWYkWVbJ7nY19TT3VtBH3M9')
const WITHDRAWAL_NONCE = 8n

const VAULT_SEED = Buffer.from('vault')
const WITHDRAWAL_SEED = Buffer.from('withdrawal')
const IX_FINALIZE_WITHDRAWAL = 5

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

function writeU64LE(buf, offset, val) {
  const big = BigInt(val)
  for (let i = 0; i < 8; i++) buf[offset + i] = Number((big >> BigInt(8 * i)) & 0xFFn)
}

async function main() {
  const conn = new Connection(L1_RPC, 'confirmed')
  const sequencer = loadKeypair('/mnt/data/mythic-l2/keys/sequencer-identity.json')

  console.log('Sequencer:', sequencer.publicKey.toBase58())
  console.log('User:', USER_WALLET.toBase58())

  // Derive vault PDA
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, MYTH_MINT.toBuffer()],
    BRIDGE_PROGRAM
  )
  console.log('Vault PDA:', vaultPDA.toBase58())

  // Derive withdrawal PDA (nonce 8)
  const nonceBytes = Buffer.alloc(8)
  writeU64LE(nonceBytes, 0, WITHDRAWAL_NONCE)
  const [withdrawalPDA] = PublicKey.findProgramAddressSync(
    [WITHDRAWAL_SEED, nonceBytes],
    BRIDGE_PROGRAM
  )
  console.log('Withdrawal PDA (nonce 8):', withdrawalPDA.toBase58())

  // Derive user's MYTH ATA (Token-2022)
  const [userATA] = PublicKey.findProgramAddressSync(
    [USER_WALLET.toBuffer(), TOKEN_2022.toBuffer(), MYTH_MINT.toBuffer()],
    ATA_PROGRAM
  )
  console.log('User ATA:', userATA.toBase58())

  // Check if ATA exists
  const ataInfo = await conn.getAccountInfo(userATA)
  if (!ataInfo) {
    console.log('\nUser ATA does not exist, creating it...')

    // Create ATA instruction (works for Token-2022)
    const createAtaIx = new TransactionInstruction({
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: sequencer.publicKey, isSigner: true, isWritable: true },  // payer
        { pubkey: userATA, isSigner: false, isWritable: true },              // ata
        { pubkey: USER_WALLET, isSigner: false, isWritable: false },         // owner
        { pubkey: MYTH_MINT, isSigner: false, isWritable: false },           // mint
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // system
        { pubkey: TOKEN_2022, isSigner: false, isWritable: false },          // token program
      ],
      data: Buffer.alloc(0), // CreateAssociatedTokenAccount has no data
    })

    const tx1 = new Transaction().add(createAtaIx)
    const sig1 = await sendAndConfirmTransaction(conn, tx1, [sequencer], TX_OPTS)
    console.log('ATA created:', sig1)
  } else {
    console.log('User ATA already exists')
  }

  // Finalize withdrawal (nonce 8)
  console.log('\nFinalizing withdrawal nonce 8...')

  const finalizeData = Buffer.alloc(1 + 8)
  finalizeData[0] = IX_FINALIZE_WITHDRAWAL
  writeU64LE(finalizeData, 1, WITHDRAWAL_NONCE)

  const finalizeIx = new TransactionInstruction({
    programId: BRIDGE_PROGRAM,
    keys: [
      { pubkey: sequencer.publicKey, isSigner: true, isWritable: true },
      { pubkey: withdrawalPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: userATA, isSigner: false, isWritable: true },
      { pubkey: MYTH_MINT, isSigner: false, isWritable: false },
      { pubkey: CONFIG_PDA, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    ],
    data: finalizeData,
  })

  const tx2 = new Transaction().add(finalizeIx)
  const sig2 = await sendAndConfirmTransaction(conn, tx2, [sequencer], TX_OPTS)
  console.log('FinalizeWithdrawal tx:', sig2)

  // Verify
  await new Promise(r => setTimeout(r, 2000))
  const balance = await conn.getTokenAccountBalance(userATA)
  console.log(`\nUser MYTH balance on L1: ${balance.value.uiAmountString} MYTH`)
  console.log('\nDone! User should see MYTH in Phantom now.')
}

main().catch(err => {
  console.error('FATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs.join('\n'))
  process.exit(1)
})
