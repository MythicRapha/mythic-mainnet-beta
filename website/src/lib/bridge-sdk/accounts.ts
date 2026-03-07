import { Connection, PublicKey } from '@solana/web3.js'
import {
  BRIDGE_L1_PROGRAM_ID,
  BRIDGE_L2_PROGRAM_ID,
  BRIDGE_CONFIG_SEED,
  SOL_VAULT_SEED,
  VAULT_SEED,
  WITHDRAWAL_SEED,
  L2_BRIDGE_CONFIG_SEED,
  BRIDGE_RESERVE_SEED,
  MINT_SEED,
  PROCESSED_SEED,
  FEE_VAULT_SEED,
  BridgeConfig,
  L2BridgeConfig,
  WithdrawalRequest,
  WithdrawalStatus,
} from './types'

// ── PDA Derivation ──────────────────────────────────────────────────────────

export function deriveBridgeConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([BRIDGE_CONFIG_SEED], BRIDGE_L1_PROGRAM_ID)
}

export function deriveSolVault(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SOL_VAULT_SEED], BRIDGE_L1_PROGRAM_ID)
}

export function deriveTokenVault(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED, mint.toBuffer()], BRIDGE_L1_PROGRAM_ID)
}

export function deriveFeeVault(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FEE_VAULT_SEED], BRIDGE_L1_PROGRAM_ID)
}

export function deriveTokenFeeVault(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FEE_VAULT_SEED, mint.toBuffer()], BRIDGE_L1_PROGRAM_ID)
}

export function deriveWithdrawalRequest(nonce: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(nonce)
  return PublicKey.findProgramAddressSync([WITHDRAWAL_SEED, buf], BRIDGE_L1_PROGRAM_ID)
}

export function deriveL2BridgeConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([L2_BRIDGE_CONFIG_SEED], BRIDGE_L2_PROGRAM_ID)
}

export function deriveBridgeReserve(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([BRIDGE_RESERVE_SEED], BRIDGE_L2_PROGRAM_ID)
}

export function deriveProcessedDeposit(nonce: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(nonce)
  return PublicKey.findProgramAddressSync([PROCESSED_SEED, buf], BRIDGE_L2_PROGRAM_ID)
}

// ── Account Deserialization ─────────────────────────────────────────────────

function readPubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32))
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset)
}

function readI64(data: Buffer, offset: number): bigint {
  return data.readBigInt64LE(offset)
}

function readBool(data: Buffer, offset: number): boolean {
  return data[offset] !== 0
}

function readU8(data: Buffer, offset: number): number {
  return data[offset]
}

export function deserializeBridgeConfig(data: Buffer | Uint8Array): BridgeConfig {
  // Ensure we have a Buffer (not just Uint8Array) for readBigUInt64LE etc.
  if (!(data instanceof Buffer)) data = Buffer.from(data)
  // On-chain BridgeConfig layout (123 bytes without pending_admin, 155 with):
  //   admin: Pubkey (32) + sequencer: Pubkey (32) + challenge_period: i64 (8)
  //   + deposit_nonce: u64 (8) + is_initialized: bool (1) + bump: u8 (1)
  //   + paused: bool (1) + min_deposit_lamports: u64 (8) + max_deposit_lamports: u64 (8)
  //   + daily_limit_lamports: u64 (8) + daily_volume: u64 (8) + last_reset_slot: u64 (8)
  //   + pending_admin: Pubkey (32) [optional — not present in 123-byte configs]
  let offset = 0
  const admin = readPubkey(data, offset); offset += 32
  const sequencer = readPubkey(data, offset); offset += 32
  const challengePeriod = readI64(data, offset); offset += 8
  const depositNonce = readU64(data, offset); offset += 8
  const isInitialized = readBool(data, offset); offset += 1
  const bump = readU8(data, offset); offset += 1
  const paused = readBool(data, offset); offset += 1
  const minDepositLamports = readU64(data, offset); offset += 8
  const maxDepositLamports = readU64(data, offset); offset += 8
  const dailyLimitLamports = readU64(data, offset); offset += 8
  const dailyVolume = readU64(data, offset); offset += 8
  const lastResetSlot = readU64(data, offset); offset += 8
  const pendingAdmin = data.length >= offset + 32
    ? readPubkey(data, offset)
    : PublicKey.default

  return {
    admin, sequencer, challengePeriod, depositNonce, isInitialized,
    bump, paused, minDepositLamports, maxDepositLamports, dailyLimitLamports,
    dailyVolume, lastResetSlot, pendingAdmin,
  }
}

export function deserializeL2BridgeConfig(data: Buffer): L2BridgeConfig {
  // L2BridgeConfig struct (92 bytes):
  //   admin: Pubkey (32)
  //   relayer: Pubkey (32)
  //   withdraw_nonce: u64 (8)
  //   total_released: u64 (8)
  //   total_received: u64 (8)
  //   is_initialized: bool (1)
  //   bump: u8 (1)
  //   paused: bool (1)
  //   reserve_bump: u8 (1)
  let offset = 0
  const admin = readPubkey(data, offset); offset += 32
  const relayer = readPubkey(data, offset); offset += 32
  const withdrawNonce = readU64(data, offset); offset += 8
  const totalReleased = readU64(data, offset); offset += 8
  const totalReceived = readU64(data, offset); offset += 8
  const isInitialized = readBool(data, offset); offset += 1
  const bump = readU8(data, offset); offset += 1
  const paused = readBool(data, offset); offset += 1
  const reserveBump = readU8(data, offset)

  return {
    admin, relayer, withdrawNonce, totalReleased, totalReceived,
    isInitialized, bump, paused, reserveBump,
  }
}

export function deserializeWithdrawalRequest(data: Buffer): WithdrawalRequest {
  let offset = 0
  const recipient = readPubkey(data, offset); offset += 32
  const amount = readU64(data, offset); offset += 8
  const tokenMint = readPubkey(data, offset); offset += 32
  const merkleProof = new Uint8Array(data.subarray(offset, offset + 32)); offset += 32
  const challengeDeadline = readI64(data, offset); offset += 8
  const statusByte = readU8(data, offset); offset += 1
  const nonce = readU64(data, offset); offset += 8
  const bump = readU8(data, offset)

  const status = statusByte as WithdrawalStatus

  return { recipient, amount, tokenMint, merkleProof, challengeDeadline, status, nonce, bump }
}

// ── Fetch Functions ─────────────────────────────────────────────────────────

export async function fetchBridgeConfig(connection: Connection): Promise<BridgeConfig | null> {
  const [configPda] = deriveBridgeConfig()

  // Use raw fetch as primary — bypasses Solana Connection class issues in browser
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpcUrl = (connection as any)._rpcEndpoint
    || (typeof window !== 'undefined' ? window.location.origin + '/api/l1-rpc' : '')
  let data: Buffer | null = null

  if (rpcUrl) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getAccountInfo',
          params: [configPda.toBase58(), { encoding: 'base64', commitment: 'confirmed' }],
        }),
      })
      const json = await res.json()
      if (json?.error) {
        console.error('[Bridge] RPC error:', json.error)
      }
      const b64 = json?.result?.value?.data?.[0]
      if (b64) data = Buffer.from(b64, 'base64')
    } catch (e) {
      console.error('[Bridge] raw fetch failed:', e)
    }
  }

  // Fallback to Connection class if raw fetch didn't work
  if (!data) {
    try {
      const info = await connection.getAccountInfo(configPda)
      if (info?.data) data = Buffer.from(info.data)
    } catch (e) {
      console.error('[Bridge] Connection.getAccountInfo also failed:', e)
    }
  }

  if (!data) return null
  return deserializeBridgeConfig(data)
}

export async function fetchL2BridgeConfig(connection: Connection): Promise<L2BridgeConfig | null> {
  const [configPda] = deriveL2BridgeConfig()
  const info = await connection.getAccountInfo(configPda)
  if (!info || !info.data) return null
  return deserializeL2BridgeConfig(Buffer.from(info.data))
}

export async function fetchWithdrawalRequest(
  connection: Connection,
  nonce: bigint,
): Promise<WithdrawalRequest | null> {
  const [pda] = deriveWithdrawalRequest(nonce)
  const info = await connection.getAccountInfo(pda)
  if (!info || !info.data) return null
  return deserializeWithdrawalRequest(Buffer.from(info.data))
}

export async function fetchBridgeReserveBalance(connection: Connection): Promise<number> {
  const [reserve] = deriveBridgeReserve()
  const balance = await connection.getBalance(reserve)
  return balance
}

export async function fetchSolVaultBalance(connection: Connection): Promise<number> {
  const [vault] = deriveSolVault()
  const balance = await connection.getBalance(vault)
  return balance
}
