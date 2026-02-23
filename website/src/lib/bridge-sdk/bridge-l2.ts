import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import {
  BRIDGE_L2_PROGRAM_ID,
  L2_IX,
} from './types'
import {
  deriveL2BridgeConfig,
  deriveWrappedTokenInfo,
  deriveL2Mint,
} from './accounts'

// ── Burn Wrapped ────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer] burner (token owner)
//   1. [writable] burner token account (ATA)
//   2. [writable] l2_mint account
//   3. [] wrapped_token_info PDA
//   4. [writable] l2_bridge_config PDA
//   5. [] token_program

export function createBurnWrappedInstruction(
  burner: PublicKey,
  burnerTokenAccount: PublicKey,
  l1Mint: PublicKey,
  amount: bigint,
  l1Recipient?: PublicKey,
): TransactionInstruction {
  const [configPda] = deriveL2BridgeConfig()
  const [wrappedInfoPda] = deriveWrappedTokenInfo(l1Mint)
  const [l2MintPda] = deriveL2Mint(l1Mint)

  const recipient = l1Recipient || burner

  // Serialize: discriminator(1) + amount(8) + l1_recipient(32) + l1_mint(32)
  const data = Buffer.alloc(1 + 8 + 32 + 32)
  data[0] = L2_IX.BURN_WRAPPED
  data.writeBigUInt64LE(amount, 1)
  recipient.toBuffer().copy(data, 9)
  l1Mint.toBuffer().copy(data, 41)

  return new TransactionInstruction({
    programId: BRIDGE_L2_PROGRAM_ID,
    keys: [
      { pubkey: burner, isSigner: true, isWritable: false },
      { pubkey: burnerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: l2MintPda, isSigner: false, isWritable: true },
      { pubkey: wrappedInfoPda, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
}

// ── Build Full Burn Transaction ─────────────────────────────────────────────

export async function buildBurnWrappedTransaction(
  connection: Connection,
  burner: PublicKey,
  l1Mint: PublicKey,
  amount: bigint,
  l1Recipient?: PublicKey,
): Promise<Transaction> {
  const [l2MintPda] = deriveL2Mint(l1Mint)
  const burnerAta = await getAssociatedTokenAddress(l2MintPda, burner)

  const ix = createBurnWrappedInstruction(burner, burnerAta, l1Mint, amount, l1Recipient)
  const tx = new Transaction().add(ix)
  tx.feePayer = burner
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  return tx
}
