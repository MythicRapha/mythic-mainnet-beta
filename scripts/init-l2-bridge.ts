// Initialize the L2 Bridge and fund the reserve PDA
// Usage: npx ts-node scripts/init-l2-bridge.ts

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as borsh from "borsh";

// ── Config ──────────────────────────────────────────────────────────────────

const L2_RPC = "https://rpc.mythic.sh";
const BRIDGE_L2_PROGRAM_ID = new PublicKey("5t8JwXzGQ3c7PCY6p6oJqZgFt8gff2d6uTLrqa1jFrKP");

const L2_BRIDGE_CONFIG_SEED = Buffer.from("l2_bridge_config");
const BRIDGE_RESERVE_SEED = Buffer.from("bridge_reserve");

// Instruction discriminators
const IX_INITIALIZE = 0;
const IX_FUND_RESERVE = 1;

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function serializePubkey(pubkey: PublicKey): Buffer {
  return pubkey.toBuffer();
}

function serializeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

// ── Build Initialize Instruction ────────────────────────────────────────────

function buildInitializeIx(
  admin: PublicKey,
  relayer: PublicKey,
): TransactionInstruction {
  const [configPda] = PublicKey.findProgramAddressSync(
    [L2_BRIDGE_CONFIG_SEED],
    BRIDGE_L2_PROGRAM_ID
  );

  // Instruction data: [discriminator(1)] + [relayer_pubkey(32)]
  const data = Buffer.concat([
    Buffer.from([IX_INITIALIZE]),
    serializePubkey(relayer),
  ]);

  return new TransactionInstruction({
    programId: BRIDGE_L2_PROGRAM_ID,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },      // 0. admin (payer)
      { pubkey: configPda, isSigner: false, isWritable: true },  // 1. config PDA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 2. system_program
    ],
    data,
  });
}

// ── Build FundReserve Instruction ───────────────────────────────────────────

function buildFundReserveIx(
  funder: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const [configPda] = PublicKey.findProgramAddressSync(
    [L2_BRIDGE_CONFIG_SEED],
    BRIDGE_L2_PROGRAM_ID
  );
  const [reservePda] = PublicKey.findProgramAddressSync(
    [BRIDGE_RESERVE_SEED],
    BRIDGE_L2_PROGRAM_ID
  );

  // Instruction data: [discriminator(1)] + [amount(8)]
  const data = Buffer.concat([
    Buffer.from([IX_FUND_RESERVE]),
    serializeU64(amount),
  ]);

  return new TransactionInstruction({
    programId: BRIDGE_L2_PROGRAM_ID,
    keys: [
      { pubkey: funder, isSigner: true, isWritable: true },       // 0. funder
      { pubkey: reservePda, isSigner: false, isWritable: true },   // 1. bridge_reserve PDA
      { pubkey: configPda, isSigner: false, isWritable: false },   // 2. config PDA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 3. system_program
    ],
    data,
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(L2_RPC, "confirmed");
  
  // Load keypairs
  const deployer = loadKeypair("/tmp/l2-deployer.json");
  const foundation = loadKeypair("/tmp/l2-foundation.json");
  
  console.log("=== Mythic L2 Bridge Initialization ===");
  console.log(`Deployer:   ${deployer.publicKey.toBase58()}`);
  console.log(`Foundation: ${foundation.publicKey.toBase58()}`);
  console.log(`Program:    ${BRIDGE_L2_PROGRAM_ID.toBase58()}`);
  
  const [configPda] = PublicKey.findProgramAddressSync(
    [L2_BRIDGE_CONFIG_SEED],
    BRIDGE_L2_PROGRAM_ID
  );
  const [reservePda] = PublicKey.findProgramAddressSync(
    [BRIDGE_RESERVE_SEED],
    BRIDGE_L2_PROGRAM_ID
  );
  
  console.log(`Config PDA: ${configPda.toBase58()}`);
  console.log(`Reserve PDA: ${reservePda.toBase58()}`);
  console.log();
  
  // Step 1: Initialize the bridge
  console.log("Step 1: Initializing L2 Bridge...");
  const relayerPubkey = deployer.publicKey; // use deployer as relayer for now
  
  try {
    const initIx = buildInitializeIx(deployer.publicKey, relayerPubkey);
    const initTx = new Transaction().add(initIx);
    const initSig = await sendAndConfirmTransaction(connection, initTx, [deployer]);
    console.log(`  ✓ Bridge initialized: ${initSig}`);
  } catch (e: any) {
    if (e.message?.includes("already in use") || e.message?.includes("AlreadyInitialized")) {
      console.log("  ⚠ Bridge already initialized, skipping...");
    } else {
      console.error(`  ✗ Init failed: ${e.message}`);
      return;
    }
  }

  // Step 2: Fund the reserve with Foundation's MYTH
  // Foundation has 500M MYTH. We'll deposit 499M to the reserve
  // (keeping 1M for Foundation operational costs)
  const LAMPORTS_PER_MYTH = 1_000_000_000n;
  const FUND_AMOUNT = 499_000_000n * LAMPORTS_PER_MYTH; // 499M MYTH
  
  console.log();
  console.log(`Step 2: Funding bridge reserve with 499M MYTH...`);
  
  const foundationBalance = await connection.getBalance(foundation.publicKey);
  console.log(`  Foundation balance: ${(Number(foundationBalance) / 1e9).toFixed(4)} MYTH`);
  
  if (BigInt(foundationBalance) < FUND_AMOUNT) {
    console.error(`  ✗ Foundation balance too low! Need ${Number(FUND_AMOUNT) / 1e9} MYTH`);
    return;
  }
  
  try {
    const fundIx = buildFundReserveIx(foundation.publicKey, FUND_AMOUNT);
    const fundTx = new Transaction().add(fundIx);
    const fundSig = await sendAndConfirmTransaction(connection, fundTx, [foundation]);
    console.log(`  ✓ Reserve funded: ${fundSig}`);
  } catch (e: any) {
    console.error(`  ✗ Fund failed: ${e.message}`);
    return;
  }
  
  // Verify
  const reserveBalance = await connection.getBalance(reservePda);
  const remainingFoundation = await connection.getBalance(foundation.publicKey);
  console.log();
  console.log("=== Final State ===");
  console.log(`Reserve PDA balance:   ${(Number(reserveBalance) / 1e9).toFixed(4)} MYTH`);
  console.log(`Foundation remaining:  ${(Number(remainingFoundation) / 1e9).toFixed(4)} MYTH`);
  console.log();
  console.log("Bridge is ready! Users can now bridge MYTH from L1 to L2.");
}

main().catch(console.error);
