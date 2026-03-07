// PumpSwap direct integration — no Jupiter dependency
// Swaps SOL → MYTH via PumpFun AMM on Solana mainnet

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token'

// ── Constants ────────────────────────────────────────────────────────────────

const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')
const PUMPFEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

// MYTH/SOL pool on PumpSwap
const MYTH_POOL = new PublicKey('Hg6fPz8zPQtrV7McXh7SxQndmd6zh4v8HSvQ6yYg3uuB')
const MYTH_MINT = new PublicKey('5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump')

// Pool token accounts (verified from on-chain pool data)
const POOL_BASE_TOKEN_ACCOUNT = new PublicKey('iB28uxnFM6dA2fixVpX9KEthsRWeS2FWwmTXVxqnVyk')   // MYTH
const POOL_QUOTE_TOKEN_ACCOUNT = new PublicKey('3dgiBGb3qgsJb3GrkN1ikQTLtZS67dUEmSN1fCE63DAe') // wSOL

// Anchor buy instruction discriminator: sha256("global:buy")[0..8]
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234])

// Pool data layout offset for coin_creator field
// Layout: disc(8) + bump(1) + index(2) + creator(32) + baseMint(32) + quoteMint(32) + lpMint(32) + baseTokenAccount(32) + quoteTokenAccount(32) + u64(8) = 211
const POOL_COIN_CREATOR_OFFSET = 211

// Global config: protocolFeeRecipients array starts at offset 57 (8 entries x 32 bytes)
const GLOBAL_CONFIG_RECIPIENTS_OFFSET = 57

// ── Pool Reserves ────────────────────────────────────────────────────────────

export interface PoolReserves {
  solReserve: bigint    // wSOL in pool (lamports)
  mythReserve: bigint   // MYTH in pool (raw units, 6 decimals)
  price: number         // MYTH per SOL (human-readable)
}

export async function getPoolReserves(connection: Connection): Promise<PoolReserves> {
  const [solBal, mythBal] = await Promise.all([
    connection.getTokenAccountBalance(POOL_QUOTE_TOKEN_ACCOUNT),
    connection.getTokenAccountBalance(POOL_BASE_TOKEN_ACCOUNT),
  ])

  const solReserve = BigInt(solBal.value.amount)
  const mythReserve = BigInt(mythBal.value.amount)

  const price = (solBal.value.uiAmount && mythBal.value.uiAmount)
    ? mythBal.value.uiAmount / solBal.value.uiAmount
    : 0

  return { solReserve, mythReserve, price }
}

// ── AMM Math (constant product) ──────────────────────────────────────────────

export function calculateBuyOutput(
  solAmountLamports: bigint,
  solReserve: bigint,
  mythReserve: bigint,
): bigint {
  // x * y = k (constant product)
  const k = solReserve * mythReserve
  const newSolReserve = solReserve + solAmountLamports
  const newMythReserve = k / newSolReserve + BigInt(1) // round up
  const mythOut = mythReserve - newMythReserve
  return mythOut > BigInt(0) ? mythOut : BigInt(0)
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  return amount * BigInt(10000 - slippageBps) / BigInt(10000)
}

// ── Build Buy Transaction ────────────────────────────────────────────────────

export async function buildPumpSwapBuyTransaction(
  connection: Connection,
  user: PublicKey,
  solAmount: number,
  slippageBps: number = 300,
): Promise<{ transaction: Transaction; expectedMythOut: bigint; minMythOut: bigint }> {
  const solAmountLamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL))

  // Derive static PDAs
  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_config')],
    PUMPSWAP_PROGRAM_ID,
  )
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    PUMPSWAP_PROGRAM_ID,
  )
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_volume_accumulator')],
    PUMPSWAP_PROGRAM_ID,
  )
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), user.toBytes()],
    PUMPSWAP_PROGRAM_ID,
  )
  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config'), PUMPSWAP_PROGRAM_ID.toBytes()],
    PUMPFEE_PROGRAM_ID,
  )

  // Fetch pool data, global config, and reserves in parallel
  const [poolInfo, globalConfigInfo, solBal, mythBal] = await Promise.all([
    connection.getAccountInfo(MYTH_POOL),
    connection.getAccountInfo(globalConfig),
    connection.getTokenAccountBalance(POOL_QUOTE_TOKEN_ACCOUNT),
    connection.getTokenAccountBalance(POOL_BASE_TOKEN_ACCOUNT),
  ])

  if (!poolInfo?.data) throw new Error('Failed to fetch MYTH pool account')
  if (!globalConfigInfo?.data) throw new Error('Failed to fetch PumpSwap global config')

  // Extract coin_creator from pool data and derive vault authority PDA
  const poolCoinCreator = new PublicKey(
    poolInfo.data.subarray(POOL_COIN_CREATOR_OFFSET, POOL_COIN_CREATOR_OFFSET + 32)
  )
  const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), poolCoinCreator.toBytes()],
    PUMPSWAP_PROGRAM_ID,
  )

  // Extract first protocol fee recipient from global config array
  const protocolFeeRecipient = new PublicKey(
    globalConfigInfo.data.subarray(
      GLOBAL_CONFIG_RECIPIENTS_OFFSET,
      GLOBAL_CONFIG_RECIPIENTS_OFFSET + 32,
    )
  )

  // Calculate expected output from reserves
  const solReserve = BigInt(solBal.value.amount)
  const mythReserve = BigInt(mythBal.value.amount)
  const expectedMythOut = calculateBuyOutput(solAmountLamports, solReserve, mythReserve)
  const minMythOut = applySlippage(expectedMythOut, slippageBps)

  if (expectedMythOut <= BigInt(0)) {
    throw new Error('Insufficient pool liquidity for this swap amount')
  }

  // MYTH is Token-2022, wSOL is regular Token Program
  const mythTokenProgram = TOKEN_2022_PROGRAM_ID
  const wsolTokenProgram = TOKEN_PROGRAM_ID

  // User ATAs
  const userMythAta = getAssociatedTokenAddressSync(MYTH_MINT, user, false, mythTokenProgram)
  const userWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user, false, wsolTokenProgram)

  // Protocol fee recipient wSOL ATA (allowOwnerOffCurve — recipient may be a PDA)
  const protocolFeeAta = getAssociatedTokenAddressSync(
    NATIVE_MINT, protocolFeeRecipient, true, wsolTokenProgram,
  )

  // Coin creator vault wSOL ATA (allowOwnerOffCurve — vault authority is a PDA)
  const coinCreatorVaultAta = getAssociatedTokenAddressSync(
    NATIVE_MINT, coinCreatorVaultAuthority, true, wsolTokenProgram,
  )

  // Build instruction data: discriminator(8) + baseAmountOut(u64) + maxQuoteAmountIn(u64) + trackVolume(Option<bool>)
  const data = Buffer.alloc(8 + 8 + 8 + 1) // 25 bytes
  BUY_DISCRIMINATOR.copy(data, 0)
  writeBigUInt64LE(data, minMythOut, 8)
  const maxSolIn = solAmountLamports + (solAmountLamports * BigInt(slippageBps) / BigInt(10000))
  writeBigUInt64LE(data, maxSolIn, 16)
  data[24] = 0 // trackVolume = None

  // Buy instruction — 23 accounts matching PumpSwap IDL
  const buyIx = new TransactionInstruction({
    programId: PUMPSWAP_PROGRAM_ID,
    keys: [
      { pubkey: MYTH_POOL, isSigner: false, isWritable: true },                     // 0: pool
      { pubkey: user, isSigner: true, isWritable: true },                            // 1: user
      { pubkey: globalConfig, isSigner: false, isWritable: false },                  // 2: globalConfig
      { pubkey: MYTH_MINT, isSigner: false, isWritable: false },                     // 3: baseMint
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },                   // 4: quoteMint
      { pubkey: userMythAta, isSigner: false, isWritable: true },                    // 5: userBaseTokenAccount
      { pubkey: userWsolAta, isSigner: false, isWritable: true },                    // 6: userQuoteTokenAccount
      { pubkey: POOL_BASE_TOKEN_ACCOUNT, isSigner: false, isWritable: true },        // 7: poolBaseTokenAccount
      { pubkey: POOL_QUOTE_TOKEN_ACCOUNT, isSigner: false, isWritable: true },       // 8: poolQuoteTokenAccount
      { pubkey: protocolFeeRecipient, isSigner: false, isWritable: false },          // 9: protocolFeeRecipient
      { pubkey: protocolFeeAta, isSigner: false, isWritable: true },                 // 10: protocolFeeRecipientAta
      { pubkey: mythTokenProgram, isSigner: false, isWritable: false },              // 11: baseTokenProgram
      { pubkey: wsolTokenProgram, isSigner: false, isWritable: false },              // 12: quoteTokenProgram
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },       // 13: systemProgram
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },   // 14: associatedTokenProgram
      { pubkey: eventAuthority, isSigner: false, isWritable: false },                // 15: eventAuthority
      { pubkey: PUMPSWAP_PROGRAM_ID, isSigner: false, isWritable: false },           // 16: program
      { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },            // 17: coinCreatorVaultAta
      { pubkey: coinCreatorVaultAuthority, isSigner: false, isWritable: false },     // 18: coinCreatorVaultAuthority
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },       // 19: globalVolumeAccumulator
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },          // 20: userVolumeAccumulator
      { pubkey: feeConfig, isSigner: false, isWritable: false },                     // 21: feeConfig
      { pubkey: PUMPFEE_PROGRAM_ID, isSigner: false, isWritable: false },            // 22: feeProgram
    ],
    data,
  })

  // Build full transaction
  const tx = new Transaction()

  // Compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }))
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }))

  // Create MYTH ATA (idempotent — no-op if exists)
  tx.add(createAssociatedTokenAccountIdempotentInstruction(
    user, userMythAta, user, MYTH_MINT, mythTokenProgram,
  ))

  // Create wSOL ATA (idempotent)
  tx.add(createAssociatedTokenAccountIdempotentInstruction(
    user, userWsolAta, user, NATIVE_MINT, wsolTokenProgram,
  ))

  // Transfer SOL to wSOL ATA and sync (wrap SOL)
  const totalSolNeeded = Number(maxSolIn)
  tx.add(SystemProgram.transfer({
    fromPubkey: user,
    toPubkey: userWsolAta,
    lamports: totalSolNeeded,
  }))
  tx.add(createSyncNativeInstruction(userWsolAta, wsolTokenProgram))

  // The actual swap
  tx.add(buyIx)

  // Close wSOL account to reclaim remaining SOL
  tx.add(createCloseAccountInstruction(userWsolAta, user, user, [], wsolTokenProgram))

  // Set recent blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.lastValidBlockHeight = lastValidBlockHeight
  tx.feePayer = user

  return { transaction: tx, expectedMythOut, minMythOut }
}

// ── Quote (for UI display) ───────────────────────────────────────────────────

export async function getPumpSwapQuote(
  connection: Connection,
  solAmount: number,
): Promise<{ mythOut: number; price: number; priceImpact: number }> {
  const solLamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL))
  const { solReserve, mythReserve, price } = await getPoolReserves(connection)
  const mythOutRaw = calculateBuyOutput(solLamports, solReserve, mythReserve)
  const mythOut = Number(mythOutRaw) / 1e6 // MYTH has 6 decimals

  // Price impact
  const spotPrice = Number(mythReserve) / Number(solReserve) // MYTH per lamport
  const execPrice = Number(mythOutRaw) / Number(solLamports)
  const priceImpact = spotPrice > 0 ? ((spotPrice - execPrice) / spotPrice) * 100 : 0

  return { mythOut, price, priceImpact }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeBigUInt64LE(buf: Buffer, value: bigint, offset: number) {
  const lo = Number(value & BigInt(0xFFFFFFFF))
  const hi = Number((value >> BigInt(32)) & BigInt(0xFFFFFFFF))
  buf.writeUInt32LE(lo, offset)
  buf.writeUInt32LE(hi, offset + 4)
}

export { MYTH_MINT, MYTH_POOL, PUMPSWAP_PROGRAM_ID }
