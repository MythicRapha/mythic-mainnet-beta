#!/usr/bin/env node
/**
 * Bridge Expedite Withdrawal — bypasses challenge period for admin withdrawal
 *
 * Steps:
 *   1. Set challenge_period to 0
 *   2. Create recipient MYTH ATA (Token-2022) if needed
 *   3. Initiate withdrawal (sequencer signs)
 *   4. Finalize withdrawal (transfers MYTH from vault to recipient)
 *   5. Set challenge_period back to 86400
 */

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID
} from '@solana/spl-token';
import fs from 'fs';
import { serialize } from 'borsh';

// ── Config ──────────────────────────────────────────────────────────────────

const RPC = 'https://api.mainnet-beta.solana.com';
const BRIDGE_PROGRAM = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ');
const MYTH_MINT = new PublicKey('5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump');

const WITHDRAW_AMOUNT = 2_900_000n * 1_000_000n; // 2.9M MYTH at 6 decimals
const WITHDRAW_NONCE = 99992n; // Fresh nonce (nonce 40 already initiated by relayer with 24h deadline)
const RESTORE_CHALLENGE_PERIOD = 86400; // 24h

const RECIPIENT = new PublicKey('ESvzBBuAGKE4VATpFYbkx6qRUY8RYzv2X5Zp9d1BXvHZ');

// Seeds
const CONFIG_SEED = Buffer.from('bridge_config');
const VAULT_SEED = Buffer.from('vault');
const WITHDRAWAL_SEED = Buffer.from('withdrawal');

// Instruction discriminators
const IX_INITIATE_WITHDRAWAL = 3;
const IX_FINALIZE_WITHDRAWAL = 5;
const IX_UPDATE_CONFIG = 6;

// ── Keypairs ────────────────────────────────────────────────────────────────

const KEY_BASE = process.env.KEY_BASE || '/mnt/data/mythic-l2/keys';
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(`${KEY_BASE}/deployer.json`, 'utf8')))
);
const sequencer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(`${KEY_BASE}/sequencer-identity.json`, 'utf8')))
);

console.log('Deployer (admin):', deployer.publicKey.toBase58());
console.log('Sequencer:', sequencer.publicKey.toBase58());

// ── PDAs ────────────────────────────────────────────────────────────────────

const [configPDA] = PublicKey.findProgramAddressSync([CONFIG_SEED], BRIDGE_PROGRAM);
const [vaultPDA] = PublicKey.findProgramAddressSync([VAULT_SEED, MYTH_MINT.toBuffer()], BRIDGE_PROGRAM);

const nonceBytes = Buffer.alloc(8);
nonceBytes.writeBigUInt64LE(WITHDRAW_NONCE);
const [withdrawalPDA] = PublicKey.findProgramAddressSync([WITHDRAWAL_SEED, nonceBytes], BRIDGE_PROGRAM);

console.log('Config PDA:', configPDA.toBase58());
console.log('Vault PDA:', vaultPDA.toBase58());
console.log('Withdrawal PDA:', withdrawalPDA.toBase58());
console.log('');

// ── Borsh Helpers ───────────────────────────────────────────────────────────

function buildUpdateConfigIx(newChallengePeriod) {
  // IX_UPDATE_CONFIG = 6
  // UpdateConfigParams { new_sequencer: Option<Pubkey>, new_challenge_period: Option<i64> }
  const buf = Buffer.alloc(1 + 1 + 1 + 8); // disc + Option::None + Option::Some(i64)
  let offset = 0;
  buf.writeUInt8(IX_UPDATE_CONFIG, offset); offset += 1;
  buf.writeUInt8(0, offset); offset += 1; // None for new_sequencer
  buf.writeUInt8(1, offset); offset += 1; // Some for new_challenge_period
  buf.writeBigInt64LE(BigInt(newChallengePeriod), offset); offset += 8;

  return new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
    ],
    programId: BRIDGE_PROGRAM,
    data: buf,
  });
}

function buildInitiateWithdrawalIx() {
  // IX_INITIATE_WITHDRAWAL = 3
  // InitiateWithdrawalParams { recipient, amount, token_mint, merkle_proof, nonce }
  // = Pubkey(32) + u64(8) + Pubkey(32) + [u8;32](32) + u64(8) = 112
  const buf = Buffer.alloc(1 + 32 + 8 + 32 + 32 + 8);
  let offset = 0;
  buf.writeUInt8(IX_INITIATE_WITHDRAWAL, offset); offset += 1;
  RECIPIENT.toBuffer().copy(buf, offset); offset += 32; // recipient = target wallet
  buf.writeBigUInt64LE(WITHDRAW_AMOUNT, offset); offset += 8; // amount
  MYTH_MINT.toBuffer().copy(buf, offset); offset += 32; // token_mint
  // merkle_proof = all zeros (placeholder)
  offset += 32;
  buf.writeBigUInt64LE(WITHDRAW_NONCE, offset); offset += 8; // nonce

  return new TransactionInstruction({
    keys: [
      { pubkey: sequencer.publicKey, isSigner: true, isWritable: false }, // sequencer
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },   // payer
      { pubkey: withdrawalPDA, isSigner: false, isWritable: true },       // withdrawal PDA
      { pubkey: configPDA, isSigner: false, isWritable: true },           // config
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BRIDGE_PROGRAM,
    data: buf,
  });
}

function buildFinalizeWithdrawalIx(recipientATA) {
  // IX_FINALIZE_WITHDRAWAL = 5
  // FinalizeWithdrawalParams { withdrawal_nonce: u64 }
  const buf = Buffer.alloc(1 + 8);
  buf.writeUInt8(IX_FINALIZE_WITHDRAWAL, 0);
  buf.writeBigUInt64LE(WITHDRAW_NONCE, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },   // payer
      { pubkey: withdrawalPDA, isSigner: false, isWritable: true },       // withdrawal
      { pubkey: vaultPDA, isSigner: false, isWritable: true },            // vault token
      { pubkey: recipientATA, isSigner: false, isWritable: true },        // recipient token
      { pubkey: MYTH_MINT, isSigner: false, isWritable: false },          // token mint
      { pubkey: configPDA, isSigner: false, isWritable: false },          // config
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // token program
    ],
    programId: BRIDGE_PROGRAM,
    data: buf,
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

const conn = new Connection(RPC, 'confirmed');

async function main() {
  const balance = await conn.getBalance(deployer.publicKey);
  console.log(`Deployer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Get vault balance
  const vaultInfo = await conn.getAccountInfo(vaultPDA);
  const vaultAmount = vaultInfo.data.readBigUInt64LE(64);
  console.log(`Vault MYTH: ${(Number(vaultAmount) / 1e6).toFixed(2)} MYTH`);
  console.log(`Withdrawing: ${(Number(WITHDRAW_AMOUNT) / 1e6).toFixed(2)} MYTH`);

  if (vaultAmount < WITHDRAW_AMOUNT) {
    throw new Error(`Vault has insufficient MYTH: ${vaultAmount} < ${WITHDRAW_AMOUNT}`);
  }
  console.log('');

  // ── Step 1: Set challenge period to 0 ──────────────────────────────────
  console.log('Step 1: Setting challenge_period to 0...');
  const tx1 = new Transaction().add(buildUpdateConfigIx(0));
  const sig1 = await sendAndConfirmTransaction(conn, tx1, [deployer], { commitment: 'confirmed' });
  console.log(`  TX: ${sig1}`);
  console.log('  Challenge period set to 0');
  console.log('');

  // ── Step 2: Create recipient MYTH ATA if needed ─────────────────────────
  const recipientATA = getAssociatedTokenAddressSync(MYTH_MINT, RECIPIENT, false, TOKEN_2022_PROGRAM_ID);
  console.log(`Step 2: Recipient MYTH ATA: ${recipientATA.toBase58()}`);

  const ataInfo = await conn.getAccountInfo(recipientATA);
  if (!ataInfo) {
    console.log('  Creating ATA...');
    const tx2 = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        deployer.publicKey, recipientATA, RECIPIENT, MYTH_MINT, TOKEN_2022_PROGRAM_ID
      )
    );
    const sig2 = await sendAndConfirmTransaction(conn, tx2, [deployer], { commitment: 'confirmed' });
    console.log(`  TX: ${sig2}`);
  } else {
    console.log('  ATA already exists');
  }
  console.log('');

  // ── Step 3: Initiate withdrawal ────────────────────────────────────────
  console.log('Step 3: Initiating withdrawal (nonce:', WITHDRAW_NONCE.toString(), ')...');
  const tx3 = new Transaction().add(buildInitiateWithdrawalIx());
  const sig3 = await sendAndConfirmTransaction(conn, tx3, [sequencer, deployer], { commitment: 'confirmed' });
  console.log(`  TX: ${sig3}`);
  console.log('  Withdrawal initiated with 0s challenge period');
  console.log('');

  // Small delay to ensure next block
  await new Promise(r => setTimeout(r, 2000));

  // ── Step 4: Finalize withdrawal ────────────────────────────────────────
  console.log('Step 4: Finalizing withdrawal (transferring MYTH to recipient)...');
  const tx4 = new Transaction().add(buildFinalizeWithdrawalIx(recipientATA));
  const sig4 = await sendAndConfirmTransaction(conn, tx4, [deployer], { commitment: 'confirmed' });
  console.log(`  TX: ${sig4}`);
  console.log(`  ${(Number(WITHDRAW_AMOUNT) / 1e6).toFixed(0)} MYTH transferred to ${RECIPIENT.toBase58()}`);
  console.log('');

  // ── Step 5: Restore challenge period ───────────────────────────────────
  console.log('Step 5: Restoring challenge_period to', RESTORE_CHALLENGE_PERIOD, 's...');
  const tx5 = new Transaction().add(buildUpdateConfigIx(RESTORE_CHALLENGE_PERIOD));
  const sig5 = await sendAndConfirmTransaction(conn, tx5, [deployer], { commitment: 'confirmed' });
  console.log(`  TX: ${sig5}`);
  console.log('  Challenge period restored to 86400s (24h)');
  console.log('');

  // ── Verify ─────────────────────────────────────────────────────────────
  console.log('=== VERIFICATION ===');

  const recipientATAInfo = await conn.getAccountInfo(recipientATA);
  if (recipientATAInfo) {
    const mythBalance = recipientATAInfo.data.readBigUInt64LE(64);
    console.log(`Recipient MYTH: ${(Number(mythBalance) / 1e6).toFixed(2)} MYTH`);
  }

  const newVaultInfo = await conn.getAccountInfo(vaultPDA);
  const newVaultAmount = newVaultInfo.data.readBigUInt64LE(64);
  console.log(`Vault MYTH remaining: ${(Number(newVaultAmount) / 1e6).toFixed(2)} MYTH`);

  const newConfigInfo = await conn.getAccountInfo(configPDA);
  const newPeriod = newConfigInfo.data.readBigInt64LE(64);
  console.log(`Challenge period: ${newPeriod.toString()}s`);

  const deployerBal = await conn.getBalance(deployer.publicKey);
  console.log(`Deployer SOL: ${deployerBal / LAMPORTS_PER_SOL} SOL`);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('ERROR:', err.message || err);
  // If we fail mid-way, try to restore challenge period
  if (err.message && !err.message.includes('challenge_period')) {
    console.log('\nAttempting to restore challenge period...');
    const tx = new Transaction().add(buildUpdateConfigIx(RESTORE_CHALLENGE_PERIOD));
    sendAndConfirmTransaction(conn, tx, [deployer], { commitment: 'confirmed' })
      .then(sig => console.log('  Restored. TX:', sig))
      .catch(e => console.error('  Failed to restore:', e.message));
  }
  process.exit(1);
});
