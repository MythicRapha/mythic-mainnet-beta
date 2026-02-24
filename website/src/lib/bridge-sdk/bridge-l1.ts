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
} from './types'
import {
  deriveBridgeConfig,
  deriveSolVault,
  deriveTokenVault,
  deriveFeeVault,
  deriveTokenFeeVault,
  deriveWithdrawalRequest,
} from './accounts'

// ── Deposit SOL ─────────────────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] depositor
//   1. [writable] sol_vault PDA
//   2. [writable] bridge_config PDA
//   3. [] system_program
//   4. [writable] fee_vault PDA

export function createDepositSOLInstruction(
  depositor: PublicKey,
  amountLamports: bigint,
  l2Recipient?: PublicKey,
): TransactionInstruction {
  const [configPda] = deriveBridgeConfig()
  const [solVault] = deriveSolVault()
  const [feeVault] = deriveFeeVault()

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
      { pubkey: feeVault, isSigner: false, isWritable: true },
    ],
    data,
  })
}

// ── Deposit SPL Token ───────────────────────────────────────────────────────
// Accounts:
//   0. [signer] depositor
//   1. [writable] depositor token account
//   2. [writable] vault token account (PDA-owned ATA)
//   3. [] token mint
//   4. [writable] bridge_config PDA
//   5. [] token_program
//   6. [writable] fee_vault token account

export function createDepositSPLInstruction(
  depositor: PublicKey,
  depositorTokenAccount: PublicKey,
  vaultTokenAccount: PublicKey,
  feeVaultTokenAccount: PublicKey,
  mint: PublicKey,
  amountTokens: bigint,
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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: feeVaultTokenAccount, isSigner: false, isWritable: true },
    ],
    data,
  })
}

// ── Finalize Withdrawal ─────────────────────────────────────────────────────
// Accounts:
//   0. [signer, writable] payer
//   1. [writable] withdrawal_request PDA
//   2. [writable] vault token account
//   3. [writable] recipient token account
//   4. [] token mint
//   5. [] bridge_config PDA
//   6. [] token_program

export function createFinalizeWithdrawalInstruction(
  payer: PublicKey,
  withdrawalNonce: bigint,
  vaultTokenAccount: PublicKey,
  recipientTokenAccount: PublicKey,
  tokenMint: PublicKey,
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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
    ? new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
    : TOKEN_PROGRAM_ID

  // Derive user's ATA
  const depositorAta = getAssociatedTokenAddressSync(
    mint,
    depositor,
    false,
    tokenProgramId,
  )

  // Derive vault ATA (owned by the bridge config PDA)
  const [configPda] = deriveBridgeConfig()
  const vaultAta = getAssociatedTokenAddressSync(
    mint,
    configPda,
    true, // PDA-owned
    tokenProgramId,
  )

  // Derive fee vault ATA (owned by the fee vault PDA)
  const [feeVaultPda] = deriveFeeVault()
  const feeVaultAta = getAssociatedTokenAddressSync(
    mint,
    feeVaultPda,
    true,
    tokenProgramId,
  )

  const tx = new Transaction()

  // Create vault ATA if it doesn't exist
  const vaultInfo = await connection.getAccountInfo(vaultAta)
  if (!vaultInfo) {
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

  // Create fee vault ATA if it doesn't exist
  const feeInfo = await connection.getAccountInfo(feeVaultAta)
  if (!feeInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        depositor,
        feeVaultAta,
        feeVaultPda,
        mint,
        tokenProgramId,
      ),
    )
  }

  // Add the deposit instruction
  const ix = createDepositSPLInstruction(
    depositor,
    depositorAta,
    vaultAta,
    feeVaultAta,
    mint,
    amountTokens,
    l2Recipient,
  )
  tx.add(ix)

  tx.feePayer = depositor
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  return tx
}
