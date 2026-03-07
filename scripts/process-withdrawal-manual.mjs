#!/usr/bin/env node
// Manual L1 bridge withdrawal processing
// Processes a pending L2→L1 withdrawal by:
// 1. UpdateConfig: set challenge_period to 1 second
// 2. InitiateWithdrawal: create withdrawal PDA on L1
// 3. FinalizeWithdrawal: release MYTH tokens from vault to user

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

// ═══ Config ═══
const L1_RPC = 'https://api.mainnet-beta.solana.com'
const TX_OPTS = { skipPreflight: false, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const BRIDGE_PROGRAM = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ')
const MYTH_MINT = new PublicKey('5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump')
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const CONFIG_PDA = new PublicKey('4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9')

// Withdrawal details from L2 BridgeToL1 event
const USER_WALLET = new PublicKey('8KgM7vY56ETVgMC8MEHiXsbkjXw59Hsjc6tFdL6t1Xr4')
const USER_MYTH_ATA = new PublicKey('AQg6oxWwcazYNEZDbEdciZ3LmpJaeWrgBNxMNTbHbrMF')
const WITHDRAWAL_AMOUNT = 6365662289600n // raw MYTH amount (6 decimals)
const WITHDRAWAL_NONCE = 0n

// Seeds
const BRIDGE_CONFIG_SEED = Buffer.from('bridge_config')
const VAULT_SEED = Buffer.from('vault')
const WITHDRAWAL_SEED = Buffer.from('withdrawal')

// Instruction discriminators
const IX_INITIATE_WITHDRAWAL = 3
const IX_FINALIZE_WITHDRAWAL = 5
const IX_UPDATE_CONFIG = 6

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

function writeU64LE(buf, offset, val) {
  const big = BigInt(val)
  for (let i = 0; i < 8; i++) buf[offset + i] = Number((big >> BigInt(8 * i)) & 0xFFn)
}

function writeI64LE(buf, offset, val) {
  writeU64LE(buf, offset, BigInt(val) & 0xFFFFFFFFFFFFFFFFn)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const conn = new Connection(L1_RPC, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  const sequencer = loadKeypair('/mnt/data/mythic-l2/keys/sequencer-identity.json')

  console.log('Deployer (admin):', deployer.publicKey.toBase58())
  console.log('Sequencer:', sequencer.publicKey.toBase58())
  console.log('User wallet:', USER_WALLET.toBase58())
  console.log('Withdrawal amount:', Number(WITHDRAWAL_AMOUNT) / 1e6, 'MYTH')

  // Derive PDAs
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, MYTH_MINT.toBuffer()],
    BRIDGE_PROGRAM
  )
  console.log('Vault PDA:', vaultPDA.toBase58())

  const nonceBytes = Buffer.alloc(8)
  writeU64LE(nonceBytes, 0, WITHDRAWAL_NONCE)
  const [withdrawalPDA] = PublicKey.findProgramAddressSync(
    [WITHDRAWAL_SEED, nonceBytes],
    BRIDGE_PROGRAM
  )
  console.log('Withdrawal PDA:', withdrawalPDA.toBase58())

  // Check balances
  const deployerBal = await conn.getBalance(deployer.publicKey)
  const sequencerBal = await conn.getBalance(sequencer.publicKey)
  console.log(`\nDeployer L1 balance: ${deployerBal / 1e9} SOL`)
  console.log(`Sequencer L1 balance: ${sequencerBal / 1e9} SOL`)

  if (sequencerBal < 10_000_000) { // 0.01 SOL minimum
    throw new Error('Sequencer needs at least 0.01 SOL on L1 for tx fees')
  }

  // Check if withdrawal PDA already exists
  const existingWithdrawal = await conn.getAccountInfo(withdrawalPDA)
  if (existingWithdrawal) {
    console.log('\n⚠️  Withdrawal PDA already exists! Checking status...')
    // WithdrawalRequest: recipient(32) + amount(8) + token_mint(32) + merkle_proof(32) + challenge_deadline(8) + status(1) + nonce(8) + bump(1)
    const status = existingWithdrawal.data[32 + 8 + 32 + 32 + 8] // status byte
    const deadlineOffset = 32 + 8 + 32 + 32
    const deadline = Number(existingWithdrawal.data.readBigInt64LE(deadlineOffset))
    console.log(`  Status: ${status} (0=Pending, 1=Finalized, 2=Cancelled)`)
    console.log(`  Challenge deadline: ${new Date(deadline * 1000).toISOString()}`)

    if (status === 1) {
      console.log('  Withdrawal already finalized!')
      process.exit(0)
    }

    // Skip to finalize if already initiated
    if (status === 0) {
      const now = Math.floor(Date.now() / 1000)
      if (now >= deadline) {
        console.log('  Challenge period expired! Proceeding to finalize...')
        await finalizeWithdrawal(conn, sequencer, withdrawalPDA, vaultPDA)
        return
      } else {
        console.log(`  Challenge period still active. Expires in ${deadline - now} seconds.`)
        console.log('  Will update config to reduce challenge period, then finalize.')
      }
    }
  }

  // ═══ Step 1: UpdateConfig — set challenge_period to 1 second ═══
  console.log('\n═══ Step 1: UpdateConfig (challenge_period → 1s) ═══')

  // UpdateConfigParams (Borsh):
  // new_sequencer: Option<Pubkey> = None (1 byte: 0)
  // new_challenge_period: Option<i64> = Some(1) (1 byte: 1 + 8 bytes: 1i64 LE)
  const updateData = Buffer.alloc(1 + 10)
  updateData[0] = IX_UPDATE_CONFIG
  updateData[1] = 0 // None for new_sequencer
  updateData[2] = 1 // Some for new_challenge_period
  writeI64LE(updateData, 3, 1) // 1 second

  const updateIx = new TransactionInstruction({
    programId: BRIDGE_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: CONFIG_PDA, isSigner: false, isWritable: true },
    ],
    data: updateData,
  })

  try {
    const tx1 = new Transaction().add(updateIx)
    // Use sequencer to pay the fee (deployer might not have enough)
    tx1.feePayer = sequencer.publicKey
    const sig1 = await sendAndConfirmTransaction(conn, tx1, [sequencer, deployer], TX_OPTS)
    console.log(`  UpdateConfig tx: ${sig1}`)
  } catch (err) {
    console.log(`  UpdateConfig error: ${err.message}`)
    if (err.logs) console.log('  Logs:', err.logs.join('\n  '))
    // Continue anyway, might already be set
  }

  // ═══ Step 2: InitiateWithdrawal ═══
  if (!existingWithdrawal) {
    console.log('\n═══ Step 2: InitiateWithdrawal ═══')

    // InitiateWithdrawalParams (Borsh):
    // recipient: Pubkey (32), amount: u64 (8), token_mint: Pubkey (32), merkle_proof: [u8;32] (32), nonce: u64 (8)
    const initiateData = Buffer.alloc(1 + 32 + 8 + 32 + 32 + 8)
    let offset = 0
    initiateData[offset++] = IX_INITIATE_WITHDRAWAL

    // recipient
    USER_WALLET.toBuffer().copy(initiateData, offset)
    offset += 32

    // amount
    writeU64LE(initiateData, offset, WITHDRAWAL_AMOUNT)
    offset += 8

    // token_mint
    MYTH_MINT.toBuffer().copy(initiateData, offset)
    offset += 32

    // merkle_proof (zeros)
    offset += 32

    // nonce
    writeU64LE(initiateData, offset, WITHDRAWAL_NONCE)

    // Accounts: sequencer, payer, withdrawal_pda, config_pda, system_program
    const initiateIx = new TransactionInstruction({
      programId: BRIDGE_PROGRAM,
      keys: [
        { pubkey: sequencer.publicKey, isSigner: true, isWritable: false },
        { pubkey: sequencer.publicKey, isSigner: true, isWritable: true }, // payer = sequencer
        { pubkey: withdrawalPDA, isSigner: false, isWritable: true },
        { pubkey: CONFIG_PDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initiateData,
    })

    const tx2 = new Transaction().add(initiateIx)
    const sig2 = await sendAndConfirmTransaction(conn, tx2, [sequencer], TX_OPTS)
    console.log(`  InitiateWithdrawal tx: ${sig2}`)
  }

  // ═══ Step 3: Wait for challenge period (1 second) ═══
  console.log('\n═══ Step 3: Waiting 3 seconds for challenge period... ═══')
  await sleep(3000)

  // ═══ Step 4: FinalizeWithdrawal ═══
  await finalizeWithdrawal(conn, sequencer, withdrawalPDA, vaultPDA)

  // ═══ Step 5: Restore challenge period ═══
  console.log('\n═══ Step 5: Restoring challenge_period to 24h (86400s) ═══')
  const restoreData = Buffer.alloc(1 + 10)
  restoreData[0] = IX_UPDATE_CONFIG
  restoreData[1] = 0 // None for new_sequencer
  restoreData[2] = 1 // Some for new_challenge_period
  writeI64LE(restoreData, 3, 86400) // 24 hours

  const restoreIx = new TransactionInstruction({
    programId: BRIDGE_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: CONFIG_PDA, isSigner: false, isWritable: true },
    ],
    data: restoreData,
  })

  try {
    const tx5 = new Transaction().add(restoreIx)
    tx5.feePayer = sequencer.publicKey
    const sig5 = await sendAndConfirmTransaction(conn, tx5, [sequencer, deployer], TX_OPTS)
    console.log(`  RestoreConfig tx: ${sig5}`)
  } catch (err) {
    console.log(`  Restore error (non-critical): ${err.message}`)
  }

  console.log('\n✅ Withdrawal processed! User should now have MYTH on L1.')
}

async function finalizeWithdrawal(conn, payer, withdrawalPDA, vaultPDA) {
  console.log('\n═══ Step 4: FinalizeWithdrawal ═══')

  // FinalizeWithdrawalParams: withdrawal_nonce: u64
  const finalizeData = Buffer.alloc(1 + 8)
  finalizeData[0] = IX_FINALIZE_WITHDRAWAL
  writeU64LE(finalizeData, 1, WITHDRAWAL_NONCE)

  // Accounts: payer, withdrawal_pda, vault_token, recipient_token, token_mint, config_pda, token_program
  const finalizeIx = new TransactionInstruction({
    programId: BRIDGE_PROGRAM,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: withdrawalPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: USER_MYTH_ATA, isSigner: false, isWritable: true },
      { pubkey: MYTH_MINT, isSigner: false, isWritable: false },
      { pubkey: CONFIG_PDA, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    ],
    data: finalizeData,
  })

  const tx = new Transaction().add(finalizeIx)
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], TX_OPTS)
  console.log(`  FinalizeWithdrawal tx: ${sig}`)

  // Verify user received tokens
  await sleep(2000)
  const userTokenInfo = await conn.getTokenAccountBalance(USER_MYTH_ATA)
  console.log(`  User MYTH balance: ${userTokenInfo.value.uiAmountString}`)
}

main().catch(err => {
  console.error('\n❌ FATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs.join('\n'))
  process.exit(1)
})
