import { NextRequest, NextResponse } from 'next/server'
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { readFileSync } from 'fs'

const L2_RPC = process.env.L2_RPC_URL || process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh'
const RELAYER_KEYPAIR_PATH = process.env.RELAYER_KEYPAIR_PATH || '/mnt/data/mythic-l2/keys/deployer.json'
const MYTH_NAMES_PROGRAM_ID = new PublicKey('GCmfmfV8LeVAsWBtHkwGvRU2r2gE37NWnHjMcQFyBV97')
const CONFIG_SEED = Buffer.from('myth_names_config')
const DOMAIN_SEED = Buffer.from('myth_domain')

let _relayerKeypair: Keypair | null = null

function getRelayerKeypair(): Keypair | null {
  if (_relayerKeypair) return _relayerKeypair

  // Try env var first (base64 or JSON array)
  const envKey = process.env.RELAYER_PRIVATE_KEY
  if (envKey) {
    try {
      const bytes = JSON.parse(envKey)
      _relayerKeypair = Keypair.fromSecretKey(new Uint8Array(bytes))
      return _relayerKeypair
    } catch {}
  }

  // Try file path
  try {
    const raw = readFileSync(RELAYER_KEYPAIR_PATH, 'utf-8')
    const bytes = JSON.parse(raw)
    _relayerKeypair = Keypair.fromSecretKey(new Uint8Array(bytes))
    return _relayerKeypair
  } catch {
    return null
  }
}

function getDomainPDA(domain: string): [PublicKey, number] {
  const normalized = domain.toLowerCase().replace(/\.myth$/, '')
  return PublicKey.findProgramAddressSync(
    [DOMAIN_SEED, Buffer.from(normalized)],
    MYTH_NAMES_PROGRAM_ID,
  )
}

function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], MYTH_NAMES_PROGRAM_ID)
}

function buildRegisterDomainIx(
  owner: PublicKey,
  domain: string,
  metadataUri: string,
  privacyShield: boolean,
): TransactionInstruction {
  const normalized = domain.toLowerCase().replace(/\.myth$/, '')
  const [configPda] = getConfigPDA()
  const [domainPda] = getDomainPDA(normalized)

  const domainBytes = Buffer.from(normalized, 'utf8')
  const uriBytes = Buffer.from(metadataUri, 'utf8')

  const data = Buffer.alloc(1 + 4 + domainBytes.length + 4 + uriBytes.length + 1)
  let offset = 0
  data[offset] = 1 // RegisterDomain discriminator
  offset += 1
  data.writeUInt32LE(domainBytes.length, offset)
  offset += 4
  domainBytes.copy(data, offset)
  offset += domainBytes.length
  data.writeUInt32LE(uriBytes.length, offset)
  offset += 4
  uriBytes.copy(data, offset)
  offset += uriBytes.length
  data[offset] = privacyShield ? 1 : 0

  return new TransactionInstruction({
    programId: MYTH_NAMES_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: domainPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

function buildTransferDomainIx(
  currentOwner: PublicKey,
  newOwner: PublicKey,
  domain: string,
): TransactionInstruction {
  const [domainPda] = getDomainPDA(domain)

  return new TransactionInstruction({
    programId: MYTH_NAMES_PROGRAM_ID,
    keys: [
      { pubkey: currentOwner, isSigner: true, isWritable: false },
      { pubkey: newOwner, isSigner: false, isWritable: false },
      { pubkey: domainPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([3]), // TransferDomain discriminator
  })
}

export async function POST(req: NextRequest) {
  // Auth check
  const wallet = req.headers.get('x-wallet-address')
  if (!wallet) {
    return NextResponse.json({ error: 'x-wallet-address header required' }, { status: 401 })
  }

  const relayer = getRelayerKeypair()
  if (!relayer) {
    return NextResponse.json({ error: 'Relayer not configured' }, { status: 503 })
  }

  try {
    const body = await req.json()
    const { domain, metadata_uri, privacy_shield } = body

    if (!domain || typeof domain !== 'string' || domain.length < 2 || domain.length > 24) {
      return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
    }

    const normalized = domain.toLowerCase().replace(/\.myth$/, '').replace(/[^a-z0-9_-]/g, '')
    if (normalized.length < 2) {
      return NextResponse.json({ error: 'Domain too short' }, { status: 400 })
    }

    // Use localhost RPC on server for reliability
    const rpcUrl = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
      ? 'http://localhost:8899'
      : L2_RPC
    const conn = new Connection(rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30000,
    })
    const userPubkey = new PublicKey(wallet)

    // Check if domain already exists on-chain
    const [domainPda] = getDomainPDA(normalized)
    const existingAccount = await conn.getAccountInfo(domainPda)
    if (existingAccount && existingAccount.data.length > 0 && existingAccount.data[0] === 1) {
      return NextResponse.json({ error: 'Domain already registered on-chain', on_chain: true }, { status: 409 })
    }

    // Step 1: Register domain with relayer as owner (relayer pays rent)
    const registerIx = buildRegisterDomainIx(
      relayer.publicKey,
      normalized,
      metadata_uri || '',
      privacy_shield ?? false,
    )

    // Step 2: Transfer domain to user
    const transferIx = buildTransferDomainIx(
      relayer.publicKey,
      userPubkey,
      normalized,
    )

    // Build single transaction with both instructions
    const tx = new Transaction().add(registerIx, transferIx)
    tx.feePayer = relayer.publicKey
    const { blockhash } = await conn.getLatestBlockhash('finalized')
    tx.recentBlockhash = blockhash

    // Sign with relayer
    tx.sign(relayer)

    // Send to L2 with skipPreflight for speed
    const sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    })

    // Wait for confirmation with generous timeout
    const confirmation = await conn.confirmTransaction(sig, 'confirmed')

    if (confirmation.value.err) {
      return NextResponse.json({
        error: 'Transaction failed on-chain',
        detail: JSON.stringify(confirmation.value.err),
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      domain: `${normalized}.myth`,
      owner: wallet,
      signature: sig,
      on_chain: true,
    })
  } catch (err: any) {
    console.error('Domain registration failed:', err?.message || err)
    return NextResponse.json({
      error: 'On-chain registration failed',
      detail: err?.message || String(err),
    }, { status: 500 })
  }
}
