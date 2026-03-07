import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";

const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

const BRIDGE_PROGRAM = new PublicKey("oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ");
const SOL_VAULT_SEED = Buffer.from("sol_vault");
const BRIDGE_CONFIG_SEED = Buffer.from("bridge_config");
const IX_SEQUENCER_WITHDRAW_SOL = 12;

const RECIPIENT = new PublicKey("6SrpJsrLHFAs6iPHFRNYmtEHUVnXyd1Q3iSqcVp8myth");
const WITHDRAW_AMOUNT = 4_200_000_000n; // 4.2 SOL in lamports

// Load sequencer keypair
const seqRaw = JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/sequencer-identity.json", "utf-8"));
const sequencer = Keypair.fromSecretKey(Uint8Array.from(seqRaw));
console.log("Sequencer:", sequencer.publicKey.toBase58());

// Derive PDAs
const [solVault] = PublicKey.findProgramAddressSync([SOL_VAULT_SEED], BRIDGE_PROGRAM);
const [configPDA] = PublicKey.findProgramAddressSync([BRIDGE_CONFIG_SEED], BRIDGE_PROGRAM);
console.log("SOL Vault PDA:", solVault.toBase58());
console.log("Config PDA:", configPDA.toBase58());
console.log("Recipient:", RECIPIENT.toBase58());
console.log("Withdraw amount:", Number(WITHDRAW_AMOUNT) / 1e9, "SOL");

// Check vault balance
const vaultBal = await connection.getBalance(solVault);
console.log("Vault balance:", vaultBal / 1e9, "SOL");
if (BigInt(vaultBal) < WITHDRAW_AMOUNT) {
  console.error("Insufficient vault balance!");
  process.exit(1);
}

// Step 1: SequencerWithdrawSOL — vault -> sequencer
console.log("\n--- Step 1: Withdraw from vault to sequencer ---");
const data1 = Buffer.alloc(9);
data1[0] = IX_SEQUENCER_WITHDRAW_SOL;
data1.writeBigUInt64LE(WITHDRAW_AMOUNT, 1);

const ix1 = new TransactionInstruction({
  keys: [
    { pubkey: sequencer.publicKey, isSigner: true, isWritable: true },
    { pubkey: solVault, isSigner: false, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  programId: BRIDGE_PROGRAM,
  data: data1,
});

// Step 2: Transfer from sequencer to recipient
console.log("--- Step 2: Transfer from sequencer to recipient ---");
const ix2 = SystemProgram.transfer({
  fromPubkey: sequencer.publicKey,
  toPubkey: RECIPIENT,
  lamports: WITHDRAW_AMOUNT,
});

// Combine both in one transaction
const tx = new Transaction().add(ix1, ix2);

try {
  const sig = await sendAndConfirmTransaction(connection, tx, [sequencer], {
    commitment: "confirmed",
  });
  console.log("\nSuccess! TX:", sig);
  console.log("https://solscan.io/tx/" + sig);

  // Check final balances
  const recipientBal = await connection.getBalance(RECIPIENT);
  const vaultBalAfter = await connection.getBalance(solVault);
  console.log("\nRecipient balance:", recipientBal / 1e9, "SOL");
  console.log("Vault balance after:", vaultBalAfter / 1e9, "SOL");
} catch (err) {
  console.error("Transaction failed:", err.message);
  if (err.logs) console.error("Logs:", err.logs.join("\n"));
}
