import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

const RPC_URL = process.argv[2] || "https://api.mainnet-beta.solana.com";

const bridgeSecret = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/target/deploy/mythic_bridge-keypair.json", "utf8"));
const bridgeKeypair = Keypair.fromSecretKey(Uint8Array.from(bridgeSecret));
const BRIDGE_PROGRAM_ID = bridgeKeypair.publicKey;

const [configPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("bridge_config")],
  BRIDGE_PROGRAM_ID
);

const connection = new Connection(RPC_URL, "confirmed");
const account = await connection.getAccountInfo(configPDA);

if (!account) {
  console.log("Config PDA not found");
  process.exit(1);
}

const data = account.data;
console.log("Config PDA:", configPDA.toBase58());
console.log("Data length:", data.length, "bytes");
console.log("Owner:", account.owner.toBase58());
console.log("");

// Decode BridgeConfig: admin(32) + sequencer(32) + challenge_period(i64) + deposit_nonce(u64) + is_initialized(bool) + bump(u8) + paused(bool) + min_deposit(u64) + max_deposit(u64) + daily_limit(u64) + daily_volume(u64) + last_reset_slot(u64)
let offset = 0;

const admin = new PublicKey(data.slice(offset, offset + 32));
offset += 32;
console.log("Admin:", admin.toBase58());

const sequencer = new PublicKey(data.slice(offset, offset + 32));
offset += 32;
console.log("Sequencer:", sequencer.toBase58());

const challengePeriod = data.readBigInt64LE(offset);
offset += 8;
console.log("Challenge Period:", challengePeriod.toString(), "seconds (~" + (Number(challengePeriod) / 3600).toFixed(1) + " hours)");

const depositNonce = data.readBigUInt64LE(offset);
offset += 8;
console.log("Deposit Nonce:", depositNonce.toString());

const isInitialized = data[offset] === 1;
offset += 1;
console.log("Is Initialized:", isInitialized);

const bump = data[offset];
offset += 1;
console.log("Bump:", bump);

const paused = data[offset] === 1;
offset += 1;
console.log("Paused:", paused);

const minDeposit = data.readBigUInt64LE(offset);
offset += 8;
console.log("Min Deposit:", (Number(minDeposit) / 1e9).toFixed(4), "SOL (" + minDeposit.toString() + " lamports)");

const maxDeposit = data.readBigUInt64LE(offset);
offset += 8;
console.log("Max Deposit:", (Number(maxDeposit) / 1e9).toFixed(4), "SOL (" + maxDeposit.toString() + " lamports)");

const dailyLimit = data.readBigUInt64LE(offset);
offset += 8;
console.log("Daily Limit:", (Number(dailyLimit) / 1e9).toFixed(4), "SOL (" + dailyLimit.toString() + " lamports)");

const dailyVolume = data.readBigUInt64LE(offset);
offset += 8;
console.log("Daily Volume:", (Number(dailyVolume) / 1e9).toFixed(4), "SOL (" + dailyVolume.toString() + " lamports)");

const lastResetSlot = data.readBigUInt64LE(offset);
offset += 8;
console.log("Last Reset Slot:", lastResetSlot.toString());

console.log("\nTotal bytes read:", offset);
