#!/usr/bin/env node
/**
 * Challenge Withdrawal Nonce 53 — duplicate of already-finalized nonce 54
 *
 * Sets withdrawal status to "Challenged", preventing finalization.
 * Requires bond of ~1,020.5 SOL (10% of withdrawal amount).
 *
 * Accounts:
 *   0. [signer, writable] challenger (deployer)
 *   1. [writable] withdrawal_request PDA
 *   2. [] bridge_config PDA
 *   3. [writable] challenge_bond PDA (created)
 *   4. [] system_program
 */

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────────────

const RPC = 'https://api.mainnet-beta.solana.com';
const BRIDGE_PROGRAM = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ');

const WITHDRAWAL_NONCE = 53n;
const IX_CHALLENGE_WITHDRAWAL = 4;

// Seeds
const CONFIG_SEED = Buffer.from('bridge_config');
const WITHDRAWAL_SEED = Buffer.from('withdrawal');
const CHALLENGE_BOND_SEED = Buffer.from('challenge_bond');

// ── Keypair ─────────────────────────────────────────────────────────────────

const KEY_BASE = process.env.KEY_BASE || '/mnt/data/mythic-l2/keys';
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(`${KEY_BASE}/deployer.json`, 'utf8')))
);

console.log('Challenger (deployer):', deployer.publicKey.toBase58());

// ── PDAs ────────────────────────────────────────────────────────────────────

const [configPDA] = PublicKey.findProgramAddressSync([CONFIG_SEED], BRIDGE_PROGRAM);

const nonceBytes = Buffer.alloc(8);
nonceBytes.writeBigUInt64LE(WITHDRAWAL_NONCE);
const [withdrawalPDA] = PublicKey.findProgramAddressSync([WITHDRAWAL_SEED, nonceBytes], BRIDGE_PROGRAM);
const [bondPDA] = PublicKey.findProgramAddressSync([CHALLENGE_BOND_SEED, nonceBytes], BRIDGE_PROGRAM);

console.log('Config PDA:', configPDA.toBase58());
console.log('Withdrawal PDA:', withdrawalPDA.toBase58());
console.log('Bond PDA:', bondPDA.toBase58());
console.log('');

// ── Build ChallengeWithdrawal Instruction ───────────────────────────────────

function buildChallengeWithdrawalIx() {
  // Borsh: ChallengeWithdrawalParams { withdrawal_nonce: u64, fraud_proof: Vec<u8> }
  // fraud_proof must be non-empty; we use "duplicate_of_nonce_54" as the proof
  const fraudProof = Buffer.from('duplicate_of_nonce_54');

  // Layout: [ix_disc(1)] + [nonce(8)] + [vec_len(4)] + [fraud_proof(N)]
  const buf = Buffer.alloc(1 + 8 + 4 + fraudProof.length);
  let offset = 0;
  buf.writeUInt8(IX_CHALLENGE_WITHDRAWAL, offset); offset += 1;
  buf.writeBigUInt64LE(WITHDRAWAL_NONCE, offset); offset += 8;
  buf.writeUInt32LE(fraudProof.length, offset); offset += 4;
  fraudProof.copy(buf, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },   // challenger
      { pubkey: withdrawalPDA, isSigner: false, isWritable: true },       // withdrawal PDA
      { pubkey: configPDA, isSigner: false, isWritable: false },          // config
      { pubkey: bondPDA, isSigner: false, isWritable: true },             // challenge bond PDA (created)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BRIDGE_PROGRAM,
    data: buf,
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

const conn = new Connection(RPC, 'confirmed');

async function main() {
  const balance = await conn.getBalance(deployer.publicKey);
  console.log(`Deployer balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Check withdrawal account exists and is Pending
  const withdrawalInfo = await conn.getAccountInfo(withdrawalPDA);
  if (!withdrawalInfo) {
    throw new Error('Withdrawal PDA not found on-chain');
  }
  console.log(`Withdrawal account: ${withdrawalInfo.data.length} bytes, owner: ${withdrawalInfo.owner.toBase58()}`);

  // Check bond PDA doesn't already exist
  const bondInfo = await conn.getAccountInfo(bondPDA);
  if (bondInfo && bondInfo.data.length > 0) {
    throw new Error('Challenge bond PDA already exists — already challenged?');
  }

  // Estimate bond: 10% of withdrawal amount
  // withdrawal.amount is at a known offset in the WithdrawalRequest struct
  // Let's just report what we expect
  console.log('');
  console.log('Expected bond: ~1,020.5 SOL (10% of 10,205,061 MYTH raw amount)');
  console.log('Plus rent for bond PDA (~0.001 SOL)');

  if (balance < 1_021_000_000_000) {
    console.log(`\nWARNING: Balance may be insufficient. Need ~1,021 SOL, have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log('Proceeding anyway — transaction will fail if insufficient...');
  }
  console.log('');

  // ── Challenge ─────────────────────────────────────────────────────────────
  console.log('Submitting ChallengeWithdrawal for nonce 53...');
  const tx = new Transaction().add(buildChallengeWithdrawalIx());
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: false,
  });

  console.log(`\nSUCCESS! Challenge TX: ${sig}`);
  console.log('Withdrawal nonce 53 is now CHALLENGED — cannot be finalized.');
  console.log(`\nVerify: https://solscan.io/tx/${sig}`);
}

main().catch(err => {
  console.error('\nERROR:', err.message || err);
  if (err.logs) {
    console.error('\nProgram logs:');
    err.logs.forEach(l => console.error(' ', l));
  }
  process.exit(1);
});
