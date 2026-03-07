import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";

const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/deployer.json", "utf8"))));

const SWAP_PROGRAM = new PublicKey("E3yp3LNjZkM1ayMhHX1ikH1TMFABYFrDpZVkW5GpkU8t");
const MYTH_MINT = new PublicKey("7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq");
const MYTHMAKER_MINT = new PublicKey("E6RiZAe1wC1YYvjrbCjFVm6ocdgQku2NdDoJZg5MaJ56");

// PDAs
const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("swap_config")], SWAP_PROGRAM);
const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from("pool"), MYTH_MINT.toBuffer(), MYTHMAKER_MINT.toBuffer()], SWAP_PROGRAM);
const [vaultA] = PublicKey.findProgramAddressSync([Buffer.from("vault_a"), poolPDA.toBuffer()], SWAP_PROGRAM);
const [vaultB] = PublicKey.findProgramAddressSync([Buffer.from("vault_b"), poolPDA.toBuffer()], SWAP_PROGRAM);
const [protocolVault] = PublicKey.findProgramAddressSync([Buffer.from("protocol_vault")], SWAP_PROGRAM);
const protocolFeeVaultToken = getAssociatedTokenAddressSync(MYTH_MINT, protocolVault, true);

// Read current pool reserves
function readU64(buf, offset) {
  let val = 0n;
  for (let i = 0; i < 8; i++) val |= BigInt(buf[offset + i]) << BigInt(8 * i);
  return val;
}

async function main() {
  console.log("Deployer:", deployer.publicKey.toBase58());
  console.log("Pool:", poolPDA.toBase58());

  // Read current reserves
  const poolInfo = await conn.getAccountInfo(poolPDA);
  const reserveA = readU64(poolInfo.data, 162); // MYTH
  const reserveB = readU64(poolInfo.data, 170); // MYTHMAKER
  const mythHuman = Number(reserveA) / 1e6;
  const makerHuman = Number(reserveB) / 1e6;
  const currentPrice = mythHuman / makerHuman;
  console.log("Current MYTH reserve:", mythHuman.toFixed(2));
  console.log("Current MYTHMAKER reserve:", makerHuman.toFixed(2));
  console.log("Current price:", currentPrice.toFixed(6), "MYTH/MYTHMAKER");

  // Target price from old launchpad
  const TARGET_PRICE = 0.067228;
  const k = mythHuman * makerHuman;
  const targetMyth = Math.sqrt(k * TARGET_PRICE);
  const mythNeeded = targetMyth - mythHuman;
  // Account for 25bps fee
  const mythToSend = Math.ceil(mythNeeded / 0.9975);
  const mythToSendRaw = BigInt(Math.ceil(mythToSend * 1e6));

  console.log("\nTarget price:", TARGET_PRICE, "MYTH/MYTHMAKER");
  console.log("MYTH to swap in:", mythToSend.toFixed(0));
  console.log("Raw amount:", mythToSendRaw.toString());

  // Step 1: Ensure deployer has enough MYTH
  const deployerMythAta = getAssociatedTokenAddressSync(MYTH_MINT, deployer.publicKey);
  const mythBal = await conn.getTokenAccountBalance(deployerMythAta);
  console.log("\nDeployer MYTH balance:", mythBal.value.uiAmountString);

  if (BigInt(mythBal.value.amount) < mythToSendRaw) {
    const toMint = mythToSendRaw - BigInt(mythBal.value.amount) + 1000000n;
    console.log("Minting", (Number(toMint)/1e6).toFixed(2), "MYTH...");
    const mintTx = new Transaction().add(
      createMintToInstruction(MYTH_MINT, deployerMythAta, deployer.publicKey, toMint)
    );
    mintTx.feePayer = deployer.publicKey;
    mintTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    mintTx.sign(deployer);
    const sig = await conn.sendRawTransaction(mintTx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, "confirmed");
    console.log("Minted:", sig);
  }

  // Step 2: Ensure deployer MYTHMAKER ATA exists
  const deployerMakerAta = getAssociatedTokenAddressSync(MYTHMAKER_MINT, deployer.publicKey);
  const makerAtaInfo = await conn.getAccountInfo(deployerMakerAta);

  const swapTx = new Transaction();
  if (!makerAtaInfo) {
    swapTx.add(createAssociatedTokenAccountIdempotentInstruction(
      deployer.publicKey, deployerMakerAta, deployer.publicKey, MYTHMAKER_MINT
    ));
    console.log("Creating MYTHMAKER ATA for deployer");
  }

  // Step 3: Swap MYTH → MYTHMAKER (a_to_b = true since MYTH is mintA)
  const data = Buffer.alloc(18);
  data[0] = 4; // Swap discriminator
  data.writeBigUInt64LE(mythToSendRaw, 1); // amount_in
  data.writeBigUInt64LE(0n, 9); // min_amount_out
  data[17] = 1; // a_to_b = true (MYTH→MYTHMAKER)

  swapTx.add(new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: deployerMythAta, isSigner: false, isWritable: true },
      { pubkey: deployerMakerAta, isSigner: false, isWritable: true },
      { pubkey: protocolFeeVaultToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  }));

  swapTx.feePayer = deployer.publicKey;
  swapTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  swapTx.sign(deployer);
  const sig = await conn.sendRawTransaction(swapTx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  await conn.confirmTransaction(sig, "confirmed");
  console.log("\nSwap confirmed:", sig);

  // Verify new price
  const poolAfter = await conn.getAccountInfo(poolPDA);
  const newA = readU64(poolAfter.data, 162);
  const newB = readU64(poolAfter.data, 170);
  const newMythH = Number(newA) / 1e6;
  const newMakerH = Number(newB) / 1e6;
  const newPrice = newMythH / newMakerH;
  const mythUsd = 0.0001448;
  const mc = newPrice * mythUsd * 1e9;
  console.log("\n=== Result ===");
  console.log("New MYTH reserve:", newMythH.toFixed(2));
  console.log("New MYTHMAKER reserve:", newMakerH.toFixed(2));
  console.log("New price:", newPrice.toFixed(6), "MYTH/MYTHMAKER");
  console.log("New MC:", "$" + mc.toFixed(2));
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
