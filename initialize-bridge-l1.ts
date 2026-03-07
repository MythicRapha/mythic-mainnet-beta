/**
 * Initialize Mythic Bridge Config on Solana L1 Mainnet
 *
 * Usage:
 *   npx ts-node initialize-bridge-l1.ts [RPC_URL]
 *
 * Prerequisites:
 *   - Bridge program already deployed
 *   - Deployer keypair at /mnt/data/mythic-l2/keys/deployer.json
 *   - Sequencer keypair at /mnt/data/mythic-l2/keys/sequencer-identity.json
 *   - npm install @solana/web3.js borsh
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as borsh from "borsh";

// ── Configuration ───────────────────────────────────────────────────────────

const RPC_URL = process.argv[2] || "http://20.81.176.84:8899";
const DEPLOYER_KEY_PATH = "/mnt/data/mythic-l2/keys/deployer.json";
const SEQUENCER_KEY_PATH = "/mnt/data/mythic-l2/keys/sequencer-identity.json";
const BRIDGE_KEYPAIR_PATH =
  "/mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json";

const BRIDGE_CONFIG_SEED = Buffer.from("bridge_config");
const IX_INITIALIZE = 0;
const CHALLENGE_PERIOD = 604_800; // 7 days in seconds

// ── Borsh Schema for InitializeParams ───────────────────────────────────────

class InitializeParams {
  sequencer: Uint8Array;
  challenge_period: bigint;

  constructor(fields: { sequencer: Uint8Array; challenge_period: bigint }) {
    this.sequencer = fields.sequencer;
    this.challenge_period = fields.challenge_period;
  }
}

function serializeInitializeParams(params: InitializeParams): Buffer {
  // Manual borsh: 32 bytes pubkey + 8 bytes i64
  const buf = Buffer.alloc(40);
  Buffer.from(params.sequencer).copy(buf, 0);
  buf.writeBigInt64LE(params.challenge_period, 32);
  return buf;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Mythic Bridge L1 — Initialize Config ===\n");

  // Load keypairs
  const deployerSecret = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH, "utf8"));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerSecret));

  const sequencerSecret = JSON.parse(
    fs.readFileSync(SEQUENCER_KEY_PATH, "utf8")
  );
  const sequencer = Keypair.fromSecretKey(Uint8Array.from(sequencerSecret));

  const bridgeSecret = JSON.parse(
    fs.readFileSync(BRIDGE_KEYPAIR_PATH, "utf8")
  );
  const bridgeKeypair = Keypair.fromSecretKey(Uint8Array.from(bridgeSecret));
  const BRIDGE_PROGRAM_ID = bridgeKeypair.publicKey;

  console.log(`  RPC:        ${RPC_URL}`);
  console.log(`  Deployer:   ${deployer.publicKey.toBase58()}`);
  console.log(`  Sequencer:  ${sequencer.publicKey.toBase58()}`);
  console.log(`  Program ID: ${BRIDGE_PROGRAM_ID.toBase58()}`);
  console.log("");

  // Derive config PDA
  const [configPDA] = PublicKey.findProgramAddressSync(
    [BRIDGE_CONFIG_SEED],
    BRIDGE_PROGRAM_ID
  );
  console.log(`  Config PDA: ${configPDA.toBase58()}`);

  const connection = new Connection(RPC_URL, "confirmed");

  // Check if already initialized
  const existingAccount = await connection.getAccountInfo(configPDA);
  if (existingAccount !== null) {
    console.log(
      "\n  WARNING: Config PDA already exists (" +
        existingAccount.data.length +
        " bytes)"
    );
    console.log("  The bridge has already been initialized.");
    console.log(
      "  If you need to re-initialize, close the account first.\n"
    );
    return;
  }

  // Build instruction
  const params = new InitializeParams({
    sequencer: sequencer.publicKey.toBytes(),
    challenge_period: BigInt(CHALLENGE_PERIOD),
  });

  const data = Buffer.concat([
    Buffer.from([IX_INITIALIZE]),
    serializeInitializeParams(params),
  ]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BRIDGE_PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(instruction);

  console.log("\n  Sending initialize transaction...");

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
      commitment: "confirmed",
    });
    console.log(`  SUCCESS! Tx signature: ${sig}`);
    console.log(
      `  Explorer: https://explorer.solana.com/tx/${sig}`
    );
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    if (err.logs) {
      console.error("  Logs:", err.logs.join("\n    "));
    }
    process.exit(1);
  }

  // Verify
  const account = await connection.getAccountInfo(configPDA);
  if (account) {
    console.log(`\n  Config PDA verified: ${account.data.length} bytes`);
    console.log(`  Owner: ${account.owner.toBase58()}`);
  }

  console.log("\n=== Bridge initialized successfully ===");
  console.log("\nNext steps:");
  console.log("  1. Update relayer L1_BRIDGE_PROGRAM_ID to:", BRIDGE_PROGRAM_ID.toBase58());
  console.log("  2. Update website bridge config");
  console.log("  3. Transfer admin to Ledger hardware wallet");
}

main().catch(console.error);
