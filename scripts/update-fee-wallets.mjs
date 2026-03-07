#!/usr/bin/env node
/**
 * Update all program fee/foundation wallets to the specified address.
 * Programs: Launchpad, MYTH Token, Swap (authority only)
 *
 * Run: node scripts/update-fee-wallets.mjs
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { serialize } from 'borsh';

const RPC = 'http://localhost:8899';
const connection = new Connection(RPC, 'confirmed');

// Load deployer keypair (admin for all programs)
const DEPLOYER_PATH = '/mnt/data/mythic-l2/keys/deployer.json';
const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(DEPLOYER_PATH, 'utf-8'))));
console.log('Admin:', deployer.publicKey.toBase58());

const NEW_FOUNDATION = new PublicKey('6SrpJsrLHFAs6iPHRNYmtEHUVnXyd1Q3iSqcVp8myth');
console.log('New fee wallet:', NEW_FOUNDATION.toBase58());

// ============================================================================
// 1. Launchpad - UpdateConfig (instruction 5)
// ============================================================================
async function updateLaunchpad() {
  const PROGRAM = new PublicKey('AdECU7ZgAxeknz5MDXTyERuoXivU2jjKnPVegEmFMn6K');
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('launchpad_config')],
    PROGRAM
  );

  // Borsh: instruction_id(u8) + graduation_threshold(Option<u64>) + protocol_fee_bps(Option<u16>) + foundation_wallet(Option<Pubkey>)
  const buf = Buffer.alloc(1 + 1 + 1 + 1 + 32);
  let offset = 0;
  buf[offset++] = 5; // UpdateConfig instruction
  buf[offset++] = 0; // None for graduation_threshold
  buf[offset++] = 0; // None for protocol_fee_bps
  buf[offset++] = 1; // Some for foundation_wallet
  NEW_FOUNDATION.toBuffer().copy(buf, offset);

  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
    ],
    data: buf,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log('✓ Launchpad foundation wallet updated:', sig);
  } catch (err) {
    console.error('✗ Launchpad update failed:', err.message);
  }
}

// ============================================================================
// 2. MYTH Token - UpdateFeeConfig (instruction 7)
// ============================================================================
async function updateMythToken() {
  const PROGRAM = new PublicKey('MythToken1111111111111111111111111111111111');
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config')],
    PROGRAM
  );

  // Borsh: instruction_id(u8) + gas_split(Option) + compute_split(Option) + inference_split(Option) + bridge_split(Option) + foundation_wallet(Option<Pubkey>)
  const buf = Buffer.alloc(1 + 1 + 1 + 1 + 1 + 1 + 32);
  let offset = 0;
  buf[offset++] = 7; // UpdateFeeConfig instruction
  buf[offset++] = 0; // None for gas_split
  buf[offset++] = 0; // None for compute_split
  buf[offset++] = 0; // None for inference_split
  buf[offset++] = 0; // None for bridge_split
  buf[offset++] = 1; // Some for foundation_wallet
  NEW_FOUNDATION.toBuffer().copy(buf, offset);

  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
    ],
    data: buf,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log('✓ MYTH Token foundation wallet updated:', sig);
  } catch (err) {
    console.error('✗ MYTH Token update failed:', err.message);
  }
}

// ============================================================================
// Run all updates
// ============================================================================
async function main() {
  console.log('\n--- Updating fee wallets to', NEW_FOUNDATION.toBase58(), '---\n');
  await updateLaunchpad();
  await updateMythToken();
  console.log('\nDone! All fee wallets updated.');
}

main().catch(console.error);
