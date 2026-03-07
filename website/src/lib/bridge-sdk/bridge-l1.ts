import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import {
  BRIDGE_L1_PROGRAM_ID,
  L1_IX,
  TOKEN_2022_PROGRAM_ID,
} from './types'
import {
  deriveBridgeConfig,
  deriveSolVault,
  deriveTokenVault,
  deriveWithdrawalRequest,
} from './accounts'

// ── Deposit SOL ─────────────────────────────────────────────────────────────
// Accounts (must match on-chain process_deposit_sol):
//   0. [signer, writable] depositor
//   1. [writable] sol_vault PDA
//   2. [writable] bridge_config PDA
//   3. [] system_program

export function createDepositSOLInstruction(
  depositor: PublicKey,
  amountLamports: bigint,
  l2Recipient?: PublicKey,
): TransactionInstruction {
  const [configPda] = deriveBridgeConfig()
  const [solVault] = deriveSolVault()

  // l2_recipient defaults to depositor's pubkey
  const recipient = l2Recipient || depositor

  // Serialize: discriminator(1) + amount(8) + l2_recipient(32)
  const data = Buffer.alloc(1 + 8 + 32)
  data[0] = L1_IX.DEPOSIT_SOL
  data.writeBigUInt64LE(amountLamports, 1)
  recipient.toBuffer().copy(data, 9)

  return new TransactionInstruction({
    programId: BRIDGE_L1_PROGRAM_ID,
    keys: [
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

// ── Deposit SPL Token ───────────────────────────────────────────────────────
// Accounts (must match on-chain process_deposit):
//   0. [signer] depositor
//   1. [writable] depositor token account
//   2. [writable] vault token account (PDA-owned)
//   3. [] token mint
//   4. [writable] bridge_config PDA
//   5. [] token_program (SPL Token OR Token-2022)

export function createDepositSPLInstruction(
  depositor: PublicKey,
  depositorTokenAccount: PublicKey,
  vaultTokenAccount: PublicKey,
  mint: PublicKey,
  amountTokens: bigint,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
  l2Recipient?: PublicKey,
): TransactionInstruction {
  const [configPda] = deriveBridgeConfig()
  const recipient = l2Recipient || depositor

  // Serialize: discriminator(1) + amount(8) + l2_recipient(32)
  const data = Buffer.alloc(1 + 8 + 32)
  data[0] = L1_IX.DEPOSIT
  data.writeBigUInt64LE(amountTokens, 1)
  recipient.toBuffer().copy(data, 9)

  return new TransactionInstruction({
    programId: BRIDGE_L1_PROGRAM_ID,
    keys: [
      { pubkey: depositor, isSigner: true, isWritable: false },
      { pubkey: depositorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

// ── Finalize Withdrawal ─────────────────────────────────────────────────────
// Accounts (must match on-chain process_finalize_withdrawal):
//   0. [signer, writable] payer
//   1. [writable] withdrawal_request PDA
//   2. [writable] vault token account
//   3. [writable] recipient token account
//   4. [] token mint
//   5. [] bridge_config PDA
//   6. [] token_program (SPL Token OR Token-2022)

export function createFinalizeWithdrawalInstruction(
  payer: PublicKey,
  withdrawalNonce: bigint,
  vaultTokenAccount: PublicKey,
  recipientTokenAccount: PublicKey,
  tokenMint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const [configPda] = deriveBridgeConfig()
  const [withdrawalPda] = deriveWithdrawalRequest(withdrawalNonce)

  // Serialize: discriminator(1) + withdrawal_nonce(8)
  const data = Buffer.alloc(1 + 8)
  data[0] = L1_IX.FINALIZE_WITHDRAWAL
  data.writeBigUInt64LE(withdrawalNonce, 1)

  return new TransactionInstruction({
    programId: BRIDGE_L1_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: withdrawalPda, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

// ── Build Full Deposit SOL Transaction ──────────────────────────────────────

export async function buildDepositSOLTransaction(
  connection: Connection,
  depositor: PublicKey,
  amountLamports: bigint,
  l2Recipient?: PublicKey,
): Promise<Transaction> {
  const ix = createDepositSOLInstruction(depositor, amountLamports, l2Recipient)
  const tx = new Transaction().add(ix)
  tx.feePayer = depositor
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  return tx
}

// ── Build Full Deposit SPL Token Transaction ────────────────────────────────

export async function buildDepositSPLTransaction(
  connection: Connection,
  depositor: PublicKey,
  mint: PublicKey,
  amountTokens: bigint,
  isToken2022: boolean = false,
  l2Recipient?: PublicKey,
): Promise<Transaction> {
  const tokenProgramId = isToken2022
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID

  // Derive user's ATA
  const depositorAta = getAssociatedTokenAddressSync(
    mint,
    depositor,
    false,
    tokenProgramId,
  )

  // Derive vault token account (PDA-derived from [vault, mint])
  // The on-chain program validates: PDA = findProgramAddress([VAULT_SEED, mint], programId)
  const [vaultPda] = deriveTokenVault(mint)

  const tx = new Transaction()

  // Create vault token account if it doesn't exist
  // Note: The vault is a raw PDA, not an ATA. If it doesn't exist yet,
  // the admin must call CreateVault (IX 11) before deposits can occur.
  // We check here to provide a better error message.
  const vaultInfo = await connection.getAccountInfo(vaultPda)
  if (!vaultInfo) {
    // The vault PDA doesn't exist. For ATA-based vaults, we could create it,
    // but the on-chain program uses a raw PDA vault initialized via CreateVault.
    // We'll try to create an ATA owned by the vault PDA as a fallback for
    // compatibility with the existing deployment.
    const [configPda] = deriveBridgeConfig()
    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      configPda,
      true, // PDA-owned
      tokenProgramId,
    )
    const vaultAtaInfo = await connection.getAccountInfo(vaultAta)
    if (!vaultAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          depositor,
          vaultAta,
          configPda,
          mint,
          tokenProgramId,
        ),
      )
    }
  }

  // Add the deposit instruction
  const ix = createDepositSPLInstruction(
    depositor,
    depositorAta,
    vaultPda,
    mint,
    amountTokens,
    tokenProgramId,
    l2Recipient,
  )
  tx.add(ix)

  tx.feePayer = depositor
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  return tx
}
