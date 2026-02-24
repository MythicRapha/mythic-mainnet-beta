import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";

const RPC_URL = process.argv[2] || "https://api.mainnet-beta.solana.com";
const CHALLENGE_PERIOD = 151200;

const deployerSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/deployer.json", "utf8"));
const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerSecret));

const sequencerSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/sequencer-identity.json", "utf8"));
const sequencer = Keypair.fromSecretKey(Uint8Array.from(sequencerSecret));

const bridgeSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json", "utf8"));
const bridgeKeypair = Keypair.fromSecretKey(Uint8Array.from(bridgeSecret));
const BRIDGE_PROGRAM_ID = bridgeKeypair.publicKey;

console.log("=== Mythic Bridge L1 - Initialize Config ===");
console.log("RPC:", RPC_URL);
console.log("Deployer:", deployer.publicKey.toBase58());
console.log("Sequencer:", sequencer.publicKey.toBase58());
console.log("Program ID:", BRIDGE_PROGRAM_ID.toBase58());
console.log("Challenge Period:", CHALLENGE_PERIOD);

const [configPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("bridge_config")],
  BRIDGE_PROGRAM_ID
);
console.log("Config PDA:", configPDA.toBase58());

const connection = new Connection(RPC_URL, "confirmed");

const existing = await connection.getAccountInfo(configPDA);
if (existing !== null) {
  console.log("WARNING: Config PDA already exists (" + existing.data.length + " bytes). Already initialized.");
  process.exit(0);
}

// Build instruction data: [0] ++ sequencer_pubkey(32) ++ challenge_period(i64 LE)
const data = Buffer.alloc(1 + 32 + 8);
data[0] = 0; // IX_INITIALIZE
Buffer.from(sequencer.publicKey.toBytes()).copy(data, 1);
data.writeBigInt64LE(BigInt(CHALLENGE_PERIOD), 33);

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
console.log("\nSending initialize transaction...");

try {
  const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { commitment: "confirmed" });
  console.log("SUCCESS! Tx signature:", sig);
  console.log("Explorer: https://explorer.solana.com/tx/" + sig);
} catch (err) {
  console.error("FAILED:", err.message);
  if (err.logs) console.error("Logs:", err.logs.join("\n  "));
  process.exit(1);
}

const account = await connection.getAccountInfo(configPDA);
if (account) {
  console.log("\nConfig PDA verified:", account.data.length, "bytes");
  console.log("Owner:", account.owner.toBase58());
}
console.log("\n=== Bridge initialized successfully ===");
