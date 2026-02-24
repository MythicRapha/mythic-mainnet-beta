const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createTransferInstruction, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const fs = require("fs");

const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");

const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/deployer.json", "utf-8"))));

const MYTH_MINT = new PublicKey("6LgkdgBwkkDJWsfmNzKNjnxGRLN5QW1Suy9G26kjSmEw");
const SWAP_PROGRAM = new PublicKey("9FsJuxQaFtXmfjxbUMBTcfFUnp7MJEij59cRrzWeoKuU");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function genWallets(n) {
  const wallets = [];
  for (let i = 0; i < n; i++) wallets.push(Keypair.generate());
  return wallets;
}

async function fundWallets(wallets, amount) {
  console.log("Funding " + wallets.length + " wallets with " + amount + " SOL each...");
  let funded = 0;
  for (let i = 0; i < wallets.length; i += 5) {
    const tx = new Transaction();
    const batch = wallets.slice(i, i + 5);
    for (const w of batch) {
      tx.add(SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: w.publicKey,
        lamports: Math.floor(amount * LAMPORTS_PER_SOL),
      }));
    }
    try {
      await sendAndConfirmTransaction(conn, tx, [deployer]);
      funded += batch.length;
    } catch (e) {
      console.log("  Fund batch failed: " + e.message.slice(0, 80));
    }
  }
  console.log("  Funded " + funded + " wallets");
}

async function solTransfers(wallets, count) {
  console.log("Generating " + count + " SOL transfers...");
  let success = 0;
  for (let i = 0; i < count; i++) {
    const from = wallets[Math.floor(Math.random() * wallets.length)];
    const to = wallets[Math.floor(Math.random() * wallets.length)];
    if (from.publicKey.equals(to.publicKey)) continue;
    const amount = 0.001 + Math.random() * 0.05;
    try {
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: to.publicKey,
        lamports: Math.floor(amount * LAMPORTS_PER_SOL),
      }));
      await sendAndConfirmTransaction(conn, tx, [from]);
      success++;
      if (success % 50 === 0) console.log("  " + success + "/" + count + " SOL transfers done");
    } catch (e) {
      // Skip failures
    }
  }
  console.log("  Completed " + success + "/" + count + " SOL transfers");
  return success;
}

async function tokenTransfers(wallets, count) {
  console.log("Setting up MYTH token accounts and transferring...");
  let success = 0;

  const deployerMythAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH_MINT, deployer.publicKey);
  const deployerBalance = Number(deployerMythAta.amount);
  console.log("  Deployer MYTH balance: " + deployerBalance);

  if (deployerBalance === 0) {
    console.log("  No MYTH tokens to transfer, skipping");
    return 0;
  }

  const mythWallets = wallets.slice(0, Math.min(10, wallets.length));
  for (const w of mythWallets) {
    try {
      const destAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH_MINT, w.publicKey);
      const amount = Math.floor(deployerBalance / 20);
      if (amount > 0) {
        const tx = new Transaction().add(createTransferInstruction(
          deployerMythAta.address, destAta.address, deployer.publicKey, amount
        ));
        await sendAndConfirmTransaction(conn, tx, [deployer]);
        success++;
      }
    } catch (e) {
      // Skip
    }
  }

  for (let i = 0; i < count && i < mythWallets.length - 1; i++) {
    const from = mythWallets[i];
    const to = mythWallets[(i + 1) % mythWallets.length];
    try {
      const fromAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH_MINT, from.publicKey);
      const toAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH_MINT, to.publicKey);
      const balance = Number(fromAta.amount);
      if (balance > 0) {
        const amount = Math.floor(balance * 0.1);
        if (amount > 0) {
          const tx = new Transaction().add(createTransferInstruction(
            fromAta.address, toAta.address, from.publicKey, amount
          ));
          await sendAndConfirmTransaction(conn, tx, [from]);
          success++;
        }
      }
    } catch (e) {
      // Skip
    }
  }

  console.log("  Completed " + success + " MYTH token transfers");
  return success;
}

async function executeSwaps(wallets, count) {
  console.log("Generating " + count + " swap transactions...");
  let success = 0;

  let pools;
  try {
    const result = JSON.parse(fs.readFileSync("/mnt/data/mythic-dex-api/swap-setup-result.json", "utf-8"));
    pools = result.pools;
  } catch (e) {
    console.log("  No swap-setup-result.json found, skipping swaps");
    return 0;
  }

  if (!pools || pools.length === 0) {
    console.log("  No pools found, skipping swaps");
    return 0;
  }

  function buildSwapIx(amountIn, minOut, aToB) {
    const buf = Buffer.alloc(18);
    buf.writeUInt8(4, 0);
    buf.writeBigUInt64LE(BigInt(amountIn), 1);
    buf.writeBigUInt64LE(BigInt(minOut), 9);
    buf.writeUInt8(aToB ? 1 : 0, 17);
    return buf;
  }

  const [swapConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_config")],
    SWAP_PROGRAM
  );

  const [protocolVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_vault")],
    SWAP_PROGRAM
  );

  for (let i = 0; i < count; i++) {
    const pool = pools[Math.floor(Math.random() * pools.length)];
    const aToB = Math.random() > 0.5;
    const amountIn = Math.floor(1000 + Math.random() * 100000);

    try {
      const trader = deployer;
      const mintA = new PublicKey(pool.mintA);
      const mintB = new PublicKey(pool.mintB);

      const traderAtaA = await getOrCreateAssociatedTokenAccount(conn, deployer, mintA, trader.publicKey);
      const traderAtaB = await getOrCreateAssociatedTokenAccount(conn, deployer, mintB, trader.publicKey);

      const balance = aToB ? Number(traderAtaA.amount) : Number(traderAtaB.amount);
      if (balance < amountIn) continue;

      const poolPda = new PublicKey(pool.address);
      const vaultA = new PublicKey(pool.vaultA);
      const vaultB = new PublicKey(pool.vaultB);
      const lpMint = new PublicKey(pool.lpMint);

      const data = buildSwapIx(amountIn, 0, aToB);

      const keys = [
        { pubkey: trader.publicKey, isSigner: true, isWritable: true },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: vaultA, isSigner: false, isWritable: true },
        { pubkey: vaultB, isSigner: false, isWritable: true },
        { pubkey: lpMint, isSigner: false, isWritable: true },
        { pubkey: traderAtaA.address, isSigner: false, isWritable: true },
        { pubkey: traderAtaB.address, isSigner: false, isWritable: true },
        { pubkey: swapConfigPda, isSigner: false, isWritable: true },
        { pubkey: protocolVaultPda, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      const tx = new Transaction().add({
        keys,
        programId: SWAP_PROGRAM,
        data,
      });

      await sendAndConfirmTransaction(conn, tx, [trader]);
      success++;
      if (success % 10 === 0) console.log("  " + success + "/" + count + " swaps done");
    } catch (e) {
      // Skip failed swaps
    }
  }

  console.log("  Completed " + success + "/" + count + " swap transactions");
  return success;
}

async function main() {
  console.log("=== Mythic L2 Testnet Activity Generator ===\n");

  const startSlot = await conn.getSlot();
  console.log("Starting at slot " + startSlot + "\n");

  const wallets = genWallets(20);

  await fundWallets(wallets, 2.0);
  await sleep(1000);

  const solTxCount = await solTransfers(wallets, 200);
  await sleep(1000);

  const mythTxCount = await tokenTransfers(wallets, 50);
  await sleep(1000);

  const swapTxCount = await executeSwaps(wallets, 100);

  const endSlot = await conn.getSlot();
  const totalTx = solTxCount + mythTxCount + swapTxCount;

  console.log("\n=== Summary ===");
  console.log("Slots: " + startSlot + " -> " + endSlot + " (" + (endSlot - startSlot) + " slots)");
  console.log("SOL transfers: " + solTxCount);
  console.log("MYTH transfers: " + mythTxCount);
  console.log("AMM swaps: " + swapTxCount);
  console.log("Total new transactions: " + totalTx);
  console.log("Done!");
}

main().catch(console.error);
