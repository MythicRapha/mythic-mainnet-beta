import { Connection, PublicKey } from '@solana/web3.js'
import {
  BRIDGE_L1_PROGRAM_ID,
  BRIDGE_L2_PROGRAM_ID,
  BRIDGE_CONFIG_SEED,
  SOL_VAULT_SEED,
  VAULT_SEED,
  WITHDRAWAL_SEED,
  L2_BRIDGE_CONFIG_SEED,
  WRAPPED_MINT_SEED,
  MINT_SEED,
  PROCESSED_SEED,
  FEE_VAULT_SEED,
  BridgeConfig,
  L2BridgeConfig,
  WithdrawalRequest,
  WithdrawalStatus,
  WrappedTokenInfo,
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

export function deriveWrappedTokenInfo(l1Mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([WRAPPED_MINT_SEED, l1Mint.toBuffer()], BRIDGE_L2_PROGRAM_ID)
}

export function deriveL2Mint(l1Mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MINT_SEED, l1Mint.toBuffer()], BRIDGE_L2_PROGRAM_ID)
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

export function deserializeBridgeConfig(data: Buffer): BridgeConfig {
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

  // Fee fields added in v2 (187 bytes). Old format is 123 bytes.
  const hasV2Fields = data.length >= 187
  const bridgeVault = hasV2Fields ? readPubkey(data, offset) : admin; offset += hasV2Fields ? 32 : 0
  const bridgeFeeBps = hasV2Fields ? readU64(data, offset) : BigInt(10); offset += hasV2Fields ? 8 : 0
  const totalFeesCollected = hasV2Fields ? readU64(data, offset) : BigInt(0); offset += hasV2Fields ? 8 : 0
  const totalFeesWithdrawn = hasV2Fields ? readU64(data, offset) : BigInt(0); offset += hasV2Fields ? 8 : 0
  const totalSolFeesCollected = hasV2Fields ? readU64(data, offset) : BigInt(0)

  return {
    admin, sequencer, challengePeriod, depositNonce, isInitialized,
    bump, paused, minDepositLamports, maxDepositLamports, dailyLimitLamports,
    dailyVolume, lastResetSlot, bridgeVault, bridgeFeeBps, totalFeesCollected,
    totalFeesWithdrawn, totalSolFeesCollected,
  }
}

export function deserializeL2BridgeConfig(data: Buffer): L2BridgeConfig {
  let offset = 0
  const admin = readPubkey(data, offset); offset += 32
  const relayer = readPubkey(data, offset); offset += 32
  const burnNonce = readU64(data, offset); offset += 8
  const isInitialized = readBool(data, offset); offset += 1
  const bump = readU8(data, offset); offset += 1
  const paused = readBool(data, offset); offset += 1

  // Fee fields added in v2 (99 bytes). Old format is 75 bytes.
  const hasV2Fields = data.length >= 99
  const bridgeFeeBps = hasV2Fields ? readU64(data, offset) : BigInt(10); offset += hasV2Fields ? 8 : 0
  const totalFeesCollected = hasV2Fields ? readU64(data, offset) : BigInt(0); offset += hasV2Fields ? 8 : 0
  const totalFeesWithdrawn = hasV2Fields ? readU64(data, offset) : BigInt(0)

  return {
    admin, relayer, burnNonce, isInitialized, bump, paused,
    bridgeFeeBps, totalFeesCollected, totalFeesWithdrawn,
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

export function deserializeWrappedTokenInfo(data: Buffer): WrappedTokenInfo {
  let offset = 0
  const l1Mint = readPubkey(data, offset); offset += 32
  const l2Mint = readPubkey(data, offset); offset += 32
  const isActive = readBool(data, offset); offset += 1
  const bump = readU8(data, offset)

  return { l1Mint, l2Mint, isActive, bump }
}

// ── Fetch Functions ─────────────────────────────────────────────────────────

export async function fetchBridgeConfig(connection: Connection): Promise<BridgeConfig | null> {
  const [configPda] = deriveBridgeConfig()
  const info = await connection.getAccountInfo(configPda)
  if (!info || !info.data) return null
  return deserializeBridgeConfig(Buffer.from(info.data))
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

export async function fetchWrappedTokenInfo(
  connection: Connection,
  l1Mint: PublicKey,
): Promise<WrappedTokenInfo | null> {
  const [pda] = deriveWrappedTokenInfo(l1Mint)
  const info = await connection.getAccountInfo(pda)
  if (!info || !info.data) return null
  return deserializeWrappedTokenInfo(Buffer.from(info.data))
}

export async function fetchSolVaultBalance(connection: Connection): Promise<number> {
  const [vault] = deriveSolVault()
  const balance = await connection.getBalance(vault)
  return balance
}
