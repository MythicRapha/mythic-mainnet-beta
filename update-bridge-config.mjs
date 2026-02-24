import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";

const RPC_URL = process.argv[2] || "https://api.mainnet-beta.solana.com";

const deployerSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/deployer.json", "utf8"));
const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerSecret));

const sequencerSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/sequencer-identity.json", "utf8"));
const sequencer = Keypair.fromSecretKey(Uint8Array.from(sequencerSecret));

const bridgeSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json", "utf8"));
const bridgeKeypair = Keypair.fromSecretKey(Uint8Array.from(bridgeSecret));
const BRIDGE_PROGRAM_ID = bridgeKeypair.publicKey;

const [configPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("bridge_config")],
  BRIDGE_PROGRAM_ID
);

console.log("=== Mythic Bridge L1 - Update Config ===");
console.log("Program ID:", BRIDGE_PROGRAM_ID.toBase58());
console.log("Config PDA:", configPDA.toBase58());
console.log("Admin:", deployer.publicKey.toBase58());
console.log("New Sequencer:", sequencer.publicKey.toBase58());
console.log("New Challenge Period: 151200 seconds");
console.log("");

// UpdateConfigParams borsh:
// Option<Pubkey> = 1 byte (Some=1) + 32 bytes pubkey  (or 1 byte None=0)
// Option<i64>    = 1 byte (Some=1) + 8 bytes i64      (or 1 byte None=0)
// Total: 1 + 32 + 1 + 8 = 42 bytes

const data = Buffer.alloc(1 + 1 + 32 + 1 + 8);
let offset = 0;

// IX_UPDATE_CONFIG = 6
data[offset] = 6;
offset += 1;

// Some(new_sequencer)
data[offset] = 1; // Some
offset += 1;
Buffer.from(sequencer.publicKey.toBytes()).copy(data, offset);
offset += 32;

// Some(new_challenge_period)
data[offset] = 1; // Some
offset += 1;
data.writeBigInt64LE(BigInt(151200), offset);
offset += 8;

const connection = new Connection(RPC_URL, "confirmed");

const instruction = new TransactionInstruction({
  keys: [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
  ],
  programId: BRIDGE_PROGRAM_ID,
  data: data.slice(0, offset),
});

const tx = new Transaction().add(instruction);
console.log("Sending update config transaction...");

try {
  const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { commitment: "confirmed" });
  console.log("SUCCESS! Tx signature:", sig);
  console.log("Explorer: https://explorer.solana.com/tx/" + sig);
} catch (err) {
  console.error("FAILED:", err.message);
  if (err.logs) console.error("Logs:", err.logs.join("\n  "));
  process.exit(1);
}

console.log("\n=== Config updated successfully ===");
