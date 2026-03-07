import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js'
import {
  BRIDGE_L2_PROGRAM_ID,
  L2_IX,
  DECIMAL_SCALING_FACTOR,
} from './types'
import {
  deriveL2BridgeConfig,
  deriveBridgeReserve,
} from './accounts'

// ── Bridge To L1 ────────────────────────────────────────────────────────────
// User sends native MYTH to the bridge reserve PDA and specifies their L1
// wallet address. The relayer watches for this event and initiates a
// withdrawal on L1.
//
// Accounts:
//   0. [signer, writable] sender
//   1. [writable] bridge_reserve PDA
//   2. [writable] l2_bridge_config PDA
//   3. [] system_program

export function createBridgeToL1Instruction(
  sender: PublicKey,
  amountLamports: bigint,
  l1Recipient: PublicKey,
): TransactionInstruction {
  const [configPda] = deriveL2BridgeConfig()
  const [reservePda] = deriveBridgeReserve()

  // Validate amount is divisible by DECIMAL_SCALING_FACTOR (1000)
  // L1 MYTH has 6 decimals, L2 has 9, so amounts must map cleanly
  if (amountLamports % BigInt(DECIMAL_SCALING_FACTOR) !== BigInt(0)) {
    throw new Error(
      `Amount must be divisible by ${DECIMAL_SCALING_FACTOR} (L2→L1 decimal alignment)`
    )
  }

  // Serialize: discriminator(1) + amount(8) + l1_recipient(32)
  // BridgeToL1Params { amount: u64, l1_recipient: [u8; 32] }
  const data = Buffer.alloc(1 + 8 + 32)
  data[0] = L2_IX.BRIDGE_TO_L1
  data.writeBigUInt64LE(amountLamports, 1)
  l1Recipient.toBuffer().copy(data, 9)

  return new TransactionInstruction({
    programId: BRIDGE_L2_PROGRAM_ID,
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: reservePda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

// ── Fetch dynamic fee from oracle ───────────────────────────────────────────

export async function fetchRecommendedPriorityFee(): Promise<number> {
  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(baseUrl + '/api/fee-oracle')
    const data = await res.json()
    return data?.recommendedPriorityFee || 0
  } catch {
    return 0
  }
}

// ── Build Full Bridge-to-L1 Transaction ─────────────────────────────────────

export async function buildBridgeToL1Transaction(
  connection: Connection,
  sender: PublicKey,
  amountLamports: bigint,
  l1Recipient?: PublicKey,
): Promise<Transaction> {
  const recipient = l1Recipient || sender

  const tx = new Transaction()

  // Add dynamic priority fee from fee oracle (makes L2 fees ~1 MYTH)
  const priorityFee = await fetchRecommendedPriorityFee()
  if (priorityFee > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }))
  }

  const ix = createBridgeToL1Instruction(sender, amountLamports, recipient)
  tx.add(ix)
  tx.feePayer = sender
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  return tx
}
