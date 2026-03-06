import { Connection, PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js'

export const MYTH_NAMES_PROGRAM_ID = new PublicKey('GCmfmfV8LeVAsWBtHkwGvRU2r2gE37NWnHjMcQFyBV97')
const CONFIG_SEED = Buffer.from('myth_names_config')
const DOMAIN_SEED = Buffer.from('myth_domain')

const L2_RPC = process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh'

/**
 * Derive the config PDA
 */
export function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], MYTH_NAMES_PROGRAM_ID)
}

/**
 * Derive a domain PDA from the domain name (without .myth)
 */
export function getDomainPDA(domain: string): [PublicKey, number] {
  const normalized = domain.toLowerCase().replace(/\.myth$/, '')
  return PublicKey.findProgramAddressSync(
    [DOMAIN_SEED, Buffer.from(normalized)],
    MYTH_NAMES_PROGRAM_ID,
  )
}

/**
 * Check if a domain is registered on-chain
 */
export async function isDomainRegistered(domain: string): Promise<boolean> {
  try {
    const conn = new Connection(L2_RPC, 'confirmed')
    const [pda] = getDomainPDA(domain)
    const info = await conn.getAccountInfo(pda)
    return info !== null && info.data.length > 0 && info.data[0] === 1 // is_initialized = true
  } catch {
    return false
  }
}

/**
 * Get domain info from on-chain
 */
export async function getDomainInfo(domain: string): Promise<{
  owner: string
  domain: string
  metadataUri: string
  privacyShield: boolean
  createdSlot: number
} | null> {
  try {
    const conn = new Connection(L2_RPC, 'confirmed')
    const [pda] = getDomainPDA(domain)
    const info = await conn.getAccountInfo(pda)
    if (!info || info.data.length < 205 || info.data[0] !== 1) return null

    const data = info.data
    const owner = new PublicKey(data.slice(1, 33)).toBase58()
    const domainBytes = data.slice(33, 57)
    const domainLen = data[57]
    const domainStr = Buffer.from(domainBytes.slice(0, domainLen)).toString('utf8')
    const uriBytes = data.slice(58, 186)
    const uriLen = data[186]
    const metadataUri = Buffer.from(uriBytes.slice(0, uriLen)).toString('utf8')
    const privacyShield = data[187] === 1
    const createdSlot = Number(data.readBigUInt64LE(188))

    return { owner, domain: domainStr, metadataUri, privacyShield, createdSlot }
  } catch {
    return null
  }
}

/**
 * Build a RegisterDomain transaction instruction
 */
export function buildRegisterDomainIx(
  owner: PublicKey,
  domain: string,
  metadataUri: string,
  privacyShield: boolean,
): TransactionInstruction {
  const normalized = domain.toLowerCase().replace(/\.myth$/, '')
  const [configPda] = getConfigPDA()
  const [domainPda] = getDomainPDA(normalized)

  // Serialize RegisterDomainArgs using borsh-compatible manual encoding
  // String = 4-byte LE length + utf8 bytes
  const domainBytes = Buffer.from(normalized, 'utf8')
  const uriBytes = Buffer.from(metadataUri, 'utf8')

  const data = Buffer.alloc(1 + 4 + domainBytes.length + 4 + uriBytes.length + 1)
  let offset = 0

  // Discriminator
  data[offset] = 1 // RegisterDomain
  offset += 1

  // domain: String (4-byte LE length prefix + bytes)
  data.writeUInt32LE(domainBytes.length, offset)
  offset += 4
  domainBytes.copy(data, offset)
  offset += domainBytes.length

  // metadata_uri: String
  data.writeUInt32LE(uriBytes.length, offset)
  offset += 4
  uriBytes.copy(data, offset)
  offset += uriBytes.length

  // privacy_shield: bool
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

/**
 * Build an UpdateDomain transaction instruction
 */
export function buildUpdateDomainIx(
  owner: PublicKey,
  domain: string,
  metadataUri?: string,
  privacyShield?: boolean,
): TransactionInstruction {
  const normalized = domain.toLowerCase().replace(/\.myth$/, '')
  const [domainPda] = getDomainPDA(normalized)

  // Serialize UpdateDomainArgs
  // metadata_uri: Option<String>, privacy_shield: Option<bool>
  const parts: Buffer[] = [Buffer.from([2])] // discriminator = 2

  // Option<String> for metadata_uri
  if (metadataUri !== undefined) {
    const uriBytes = Buffer.from(metadataUri, 'utf8')
    const optBuf = Buffer.alloc(1 + 4 + uriBytes.length)
    optBuf[0] = 1 // Some
    optBuf.writeUInt32LE(uriBytes.length, 1)
    uriBytes.copy(optBuf, 5)
    parts.push(optBuf)
  } else {
    parts.push(Buffer.from([0])) // None
  }

  // Option<bool> for privacy_shield
  if (privacyShield !== undefined) {
    parts.push(Buffer.from([1, privacyShield ? 1 : 0])) // Some(bool)
  } else {
    parts.push(Buffer.from([0])) // None
  }

  return new TransactionInstruction({
    programId: MYTH_NAMES_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: domainPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat(parts),
  })
}
