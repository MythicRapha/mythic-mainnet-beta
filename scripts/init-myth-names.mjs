#!/usr/bin/env node
/**
 * Initialize the MythNames on-chain domain registry
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js'
import { readFileSync } from 'fs'
import { serialize } from 'borsh'

const PROGRAM_ID = new PublicKey('GCmfmfV8LeVAsWBtHkwGvRU2r2gE37NWnHjMcQFyBV97')
const CONFIG_SEED = Buffer.from('myth_names_config')

const RPC = process.env.RPC_URL || 'http://localhost:8899'
const KEYPAIR_PATH = process.env.KEYPAIR || '/mnt/data/mythic-l2/keys/deployer.json'

async function main() {
  const connection = new Connection(RPC, 'confirmed')
  const keypairData = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8'))
  const admin = Keypair.fromSecretKey(Uint8Array.from(keypairData))

  console.log('Admin:', admin.publicKey.toBase58())
  console.log('Program:', PROGRAM_ID.toBase58())

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID
  )
  console.log('Config PDA:', configPda.toBase58())

  // Check if already initialized
  const configInfo = await connection.getAccountInfo(configPda)
  if (configInfo && configInfo.data.length > 0) {
    console.log('Already initialized! Data length:', configInfo.data.length)
    return
  }

  // Build Initialize instruction (discriminator=0, fee=0 lamports)
  // InitializeArgs { registration_fee: u64 }
  const feeBuffer = Buffer.alloc(8)
  feeBuffer.writeBigUInt64LE(0n) // free registration

  const data = Buffer.concat([
    Buffer.from([0]), // discriminator = 0 (Initialize)
    feeBuffer,
  ])

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new Transaction().add(ix)
  tx.feePayer = admin.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(admin)

  const sig = await connection.sendRawTransaction(tx.serialize())
  console.log('Signature:', sig)

  await connection.confirmTransaction(sig, 'confirmed')
  console.log('MythNames registry initialized!')

  // Verify
  const after = await connection.getAccountInfo(configPda)
  console.log('Config account created:', after ? `${after.data.length} bytes` : 'FAILED')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
