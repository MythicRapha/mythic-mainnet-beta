import { PublicKey } from '@solana/web3.js'

// ── Program IDs (deployed) ──────────────────────────────────────────────────

export const BRIDGE_L1_PROGRAM_ID = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ')
export const BRIDGE_L2_PROGRAM_ID = new PublicKey('3HsETxbcFZ5DnGiLWy3fEvpwQFzb2ThqLXY1eWQjjMLS')

// ── PDA Seeds ───────────────────────────────────────────────────────────────

export const BRIDGE_CONFIG_SEED = Buffer.from('bridge_config')
export const VAULT_SEED = Buffer.from('vault')
export const SOL_VAULT_SEED = Buffer.from('sol_vault')
export const WITHDRAWAL_SEED = Buffer.from('withdrawal')
export const L2_BRIDGE_CONFIG_SEED = Buffer.from('l2_bridge_config')
export const WRAPPED_MINT_SEED = Buffer.from('wrapped_mint')
export const PROCESSED_SEED = Buffer.from('processed')
export const MINT_SEED = Buffer.from('mint')
export const FEE_VAULT_SEED = Buffer.from('bridge_vault')

// ── Instruction Discriminators ──────────────────────────────────────────────

export const L1_IX = {
  INITIALIZE: 0,
  DEPOSIT: 1,
  DEPOSIT_SOL: 2,
  INITIATE_WITHDRAWAL: 3,
  CHALLENGE_WITHDRAWAL: 4,
  FINALIZE_WITHDRAWAL: 5,
  UPDATE_CONFIG: 6,
  PAUSE_BRIDGE: 7,
  UNPAUSE_BRIDGE: 8,
  SET_LIMITS: 9,
} as const

export const L2_IX = {
  INITIALIZE: 0,
  REGISTER_WRAPPED_TOKEN: 1,
  MINT_WRAPPED: 2,
  BURN_WRAPPED: 3,
  UPDATE_CONFIG: 4,
  PAUSE_BRIDGE: 5,
  UNPAUSE_BRIDGE: 6,
} as const

// ── On-chain State Types ────────────────────────────────────────────────────

export interface BridgeConfig {
  admin: PublicKey
  sequencer: PublicKey
  challengePeriod: bigint
  depositNonce: bigint
  isInitialized: boolean
  bump: number
  paused: boolean
  minDepositLamports: bigint
  maxDepositLamports: bigint
  dailyLimitLamports: bigint
  dailyVolume: bigint
  lastResetSlot: bigint
  bridgeVault: PublicKey
  bridgeFeeBps: bigint
  totalFeesCollected: bigint
  totalFeesWithdrawn: bigint
  totalSolFeesCollected: bigint
}

export interface L2BridgeConfig {
  admin: PublicKey
  relayer: PublicKey
  burnNonce: bigint
  isInitialized: boolean
  bump: number
  paused: boolean
  bridgeFeeBps: bigint
  totalFeesCollected: bigint
  totalFeesWithdrawn: bigint
}

export enum WithdrawalStatus {
  Pending = 0,
  Challenged = 1,
  Finalized = 2,
  Cancelled = 3,
}

export interface WithdrawalRequest {
  recipient: PublicKey
  amount: bigint
  tokenMint: PublicKey
  merkleProof: Uint8Array // 32 bytes
  challengeDeadline: bigint
  status: WithdrawalStatus
  nonce: bigint
  bump: number
}

export interface WrappedTokenInfo {
  l1Mint: PublicKey
  l2Mint: PublicKey
  isActive: boolean
  bump: number
}

// ── Frontend Types ──────────────────────────────────────────────────────────

export type BridgeDirection = 'deposit' | 'withdraw'

export interface BridgeAsset {
  symbol: string
  name: string
  icon: string
  l1Mint?: PublicKey   // undefined = native SOL on L1 (MYTH on L2)
  decimals: number
}

export interface DepositRecord {
  signature: string
  amount: number
  token: string
  nonce: number
  timestamp: number
  status: 'pending' | 'confirmed' | 'minted'
}

export interface WithdrawalRecord {
  burnNonce: number
  amount: number
  token: string
  l1Recipient: string
  timestamp: number
  status: 'burned' | 'initiated' | 'challenged' | 'finalized'
  challengeDeadline?: number
}

export interface BridgeStats {
  paused: boolean
  depositNonce: number
  minDeposit: number     // in SOL
  maxDeposit: number     // in SOL
  dailyLimit: number     // in SOL
  dailyVolume: number    // in SOL
  dailyRemaining: number // in SOL
  feeBps: number
  totalFeesCollected: number // in SOL
}

// ── Constants ───────────────────────────────────────────────────────────────

export const LAMPORTS_PER_SOL = 1_000_000_000
export const DAILY_RESET_SLOTS = 216_000
export const CHALLENGE_PERIOD_SECONDS = 604_800 // 7 days
export const BPS_DENOMINATOR = 10_000
export const MIN_FEE_LAMPORTS = 5_000 // 0.000005 SOL minimum fee

export const SUPPORTED_ASSETS: BridgeAsset[] = [
  {
    symbol: 'SOL',
    name: 'Solana',
    icon: 'S',
    decimals: 9,
  },
]
