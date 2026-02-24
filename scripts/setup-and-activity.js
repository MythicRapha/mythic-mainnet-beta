const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createMintToInstruction, createTransferInstruction, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const fs = require("fs");

const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/mnt/data/mythic-l2/keys/deployer.json", "utf-8"))));

// New token mints (just created)
const MYTH = { mint: new PublicKey("HYeqETf8dAndu6KUfipDt7Ah7KZfQ4G8d9quBofi7LcJ"), decimals: 6, symbol: "MYTH" };
const WSOL = { mint: new PublicKey("8zQMRu5hDrBAVhFdkWLFzyLJ4bKWbLiH3qa76aHJcGx3"), decimals: 9, symbol: "wSOL" };
const USDC = { mint: new PublicKey("Hs9cmgJWJJq29Tjxzv2e3G1EpzbKYKT1EXHVCh1yH5Na"), decimals: 6, symbol: "USDC" };
const WBTC = { mint: new PublicKey("2AjMd8PP1wfVvsNXFzpxMGHzdfpbQSyxFzxeVA7odsb3"), decimals: 8, symbol: "wBTC" };
const WETH = { mint: new PublicKey("3XtvX1qJA27UEoreVrxuPmv9zDY9xYRbmZiRJxJxQuUF"), decimals: 8, symbol: "wETH" };
const ALL_TOKENS = [MYTH, WSOL, USDC, WBTC, WETH];

const SWAP_PROGRAM = new PublicKey("E5KLCYQ9MoUQhHvHNvHbKK8YjWEp5y2eqpW84UHVj4iu");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Borsh helpers
function u8(n) { return Buffer.from([n & 0xff]); }
function u16LE(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u64LE(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function boolB(v) { return Buffer.from([v ? 1 : 0]); }

async function mintTokens() {
  console.log("=== Minting tokens to deployer ===");
  for (const t of ALL_TOKENS) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, deployer, t.mint, deployer.publicKey);
    const amount = t.symbol === "MYTH" ? 10_000_000 * (10 ** t.decimals)
      : t.symbol === "wSOL" ? 50_000 * (10 ** t.decimals)
      : t.symbol === "USDC" ? 25_000_000 * (10 ** t.decimals)
      : t.symbol === "wBTC" ? 500 * (10 ** t.decimals)
      : 5_000 * (10 ** t.decimals); // wETH
    const tx = new Transaction().add(createMintToInstruction(t.mint, ata.address, deployer.publicKey, BigInt(amount)));
    await sendAndConfirmTransaction(conn, tx, [deployer]);
    console.log("  " + t.symbol + ": minted " + (amount / (10 ** t.decimals)) + " tokens");
  }
}

async function initSwapConfig() {
  console.log("=== Initializing swap config ===");
  const [configPda, configBump] = PublicKey.findProgramAddressSync([Buffer.from("swap_config")], SWAP_PROGRAM);
  const [protocolVault, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_vault")], SWAP_PROGRAM);

  // InitializeArgs: protocol_fee_bps(u16) + lp_fee_bps(u16) + pool_creation_fee(u64) = 12 bytes
  const data = Buffer.concat([u8(0), u16LE(3), u16LE(22), u64LE(0)]);
  // Accounts: authority(signer), config_pda, system_program (3 accounts only)
  const keys = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add({ keys, programId: SWAP_PROGRAM, data });
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, [deployer]);
    console.log("  Config PDA: " + configPda.toBase58());
    console.log("  Protocol Vault: " + protocolVault.toBase58());
    console.log("  Sig: " + sig);
  } catch (e) {
    if (e.message && e.message.includes("already in use")) {
      console.log("  Config already initialized");
    } else {
      console.log("  Init failed: " + (e.logs ? e.logs.join("\n") : e.message));
    }
  }
  return { configPda, protocolVault };
}

async function createPool(tokenA, tokenB, amountA, amountB, config) {
  const label = tokenA.symbol + "/" + tokenB.symbol;
  console.log("  Creating pool " + label + "...");

  const [mintLow, mintHigh] = tokenA.mint.toBase58() < tokenB.mint.toBase58()
    ? [tokenA.mint, tokenB.mint] : [tokenB.mint, tokenA.mint];

  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mintLow.toBuffer(), mintHigh.toBuffer()], SWAP_PROGRAM);
  const [vaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_a"), poolPda.toBuffer()], SWAP_PROGRAM);
  const [vaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_b"), poolPda.toBuffer()], SWAP_PROGRAM);
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), poolPda.toBuffer()], SWAP_PROGRAM);

  // Creator ATAs
  const creatorAtaA = await getOrCreateAssociatedTokenAccount(conn, deployer, tokenA.mint, deployer.publicKey);
  const creatorAtaB = await getOrCreateAssociatedTokenAccount(conn, deployer, tokenB.mint, deployer.publicKey);

  // LP ATA will be created inline by program
  const [creatorLpAta] = PublicKey.findProgramAddressSync(
    [deployer.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), lpMint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID);

  // CreatePoolArgs: initial_amount_a(u64) + initial_amount_b(u64) = 16 bytes
  const data = Buffer.concat([u8(1), u64LE(amountA), u64LE(amountB)]);

  // Account order from source: creator, config, pool, mint_a, mint_b, vault_a, vault_b,
  // lp_mint, creator_ata_a, creator_ata_b, creator_lp_ata, protocol_vault,
  // token_program, system_program, rent_sysvar, ata_program(optional)
  const keys = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: config.configPda, isSigner: false, isWritable: true },
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: tokenA.mint, isSigner: false, isWritable: false },
    { pubkey: tokenB.mint, isSigner: false, isWritable: false },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: creatorAtaA.address, isSigner: false, isWritable: true },
    { pubkey: creatorAtaB.address, isSigner: false, isWritable: true },
    { pubkey: creatorLpAta, isSigner: false, isWritable: true },
    { pubkey: config.protocolVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  try {
    const tx = new Transaction().add({ keys, programId: SWAP_PROGRAM, data });
    const sig = await sendAndConfirmTransaction(conn, tx, [deployer]);
    console.log("    Pool: " + poolPda.toBase58() + " (" + label + ")");
    return { pool: poolPda, vaultA, vaultB, lpMint, mintA: tokenA, mintB: tokenB };
  } catch (e) {
    console.log("    FAILED: " + (e.logs ? e.logs.slice(-3).join("\n") : e.message.slice(0, 120)));
    return null;
  }
}

// Cache for protocol fee ATAs
const protocolFeeATAs = {};

async function getProtocolFeeATA(mint) {
  const key = mint.toBase58();
  if (protocolFeeATAs[key]) return protocolFeeATAs[key];
  // Create an ATA owned by the deployer as fee destination
  const ata = await getOrCreateAssociatedTokenAccount(conn, deployer, mint, deployer.publicKey);
  protocolFeeATAs[key] = ata.address;
  return ata.address;
}

async function executeSwap(pool, amountIn, aToB) {
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("swap_config")], SWAP_PROGRAM);

  const traderAtaA = await getOrCreateAssociatedTokenAccount(conn, deployer, pool.mintA.mint, deployer.publicKey);
  const traderAtaB = await getOrCreateAssociatedTokenAccount(conn, deployer, pool.mintB.mint, deployer.publicKey);

  // Determine which is token_in and token_out based on direction
  const traderTokenIn = aToB ? traderAtaA.address : traderAtaB.address;
  const traderTokenOut = aToB ? traderAtaB.address : traderAtaA.address;

  // Protocol fee vault is a token account for the INPUT token
  const inputMint = aToB ? pool.mintA.mint : pool.mintB.mint;
  const protocolFeeVault = await getProtocolFeeATA(inputMint);

  // SwapArgs: amount_in(u64) + min_amount_out(u64) + a_to_b(bool) = 17 bytes
  const data = Buffer.concat([u8(4), u64LE(amountIn), u64LE(0), boolB(aToB)]);

  // Accounts: trader, config, pool, vault_a, vault_b, trader_token_in, trader_token_out, protocol_fee_vault, token_program
  const keys = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: pool.pool, isSigner: false, isWritable: true },
    { pubkey: pool.vaultA, isSigner: false, isWritable: true },
    { pubkey: pool.vaultB, isSigner: false, isWritable: true },
    { pubkey: traderTokenIn, isSigner: false, isWritable: true },
    { pubkey: traderTokenOut, isSigner: false, isWritable: true },
    { pubkey: protocolFeeVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const tx = new Transaction().add({ keys, programId: SWAP_PROGRAM, data });
  await sendAndConfirmTransaction(conn, tx, [deployer]);
}

async function generateSwapActivity(pools, count) {
  console.log("=== Generating " + count + " swap transactions ===");
  let success = 0;
  for (let i = 0; i < count; i++) {
    const pool = pools[Math.floor(Math.random() * pools.length)];
    if (!pool) continue;
    const aToB = Math.random() > 0.5;
    const amount = Math.floor(1000 + Math.random() * 50000);
    try {
      await executeSwap(pool, amount, aToB);
      success++;
      if (success % 20 === 0) console.log("  " + success + "/" + count + " swaps done");
    } catch (e) {
      // Skip failures
    }
  }
  console.log("  Completed " + success + "/" + count + " swaps");
  return success;
}

async function generateSOLTransfers(count) {
  console.log("=== Generating " + count + " SOL transfers ===");
  const wallets = [];
  for (let i = 0; i < 20; i++) wallets.push(Keypair.generate());

  // Fund wallets
  for (let i = 0; i < wallets.length; i += 5) {
    const tx = new Transaction();
    for (const w of wallets.slice(i, i + 5)) {
      tx.add(SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: w.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      }));
    }
    await sendAndConfirmTransaction(conn, tx, [deployer]);
  }

  let success = 0;
  for (let i = 0; i < count; i++) {
    const from = wallets[Math.floor(Math.random() * wallets.length)];
    const to = wallets[Math.floor(Math.random() * wallets.length)];
    if (from.publicKey.equals(to.publicKey)) continue;
    try {
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: to.publicKey,
        lamports: Math.floor((0.001 + Math.random() * 0.05) * LAMPORTS_PER_SOL),
      }));
      await sendAndConfirmTransaction(conn, tx, [from]);
      success++;
      if (success % 50 === 0) console.log("  " + success + "/" + count + " transfers done");
    } catch (e) {}
  }
  console.log("  Completed " + success + "/" + count + " SOL transfers");
  return success;
}

async function generateTokenTransfers(count) {
  console.log("=== Generating " + count + " MYTH token transfers ===");
  const wallets = [];
  for (let i = 0; i < 10; i++) wallets.push(Keypair.generate());

  // Fund with SOL for fees
  for (let i = 0; i < wallets.length; i += 5) {
    const tx = new Transaction();
    for (const w of wallets.slice(i, i + 5)) {
      tx.add(SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: w.publicKey,
        lamports: LAMPORTS_PER_SOL,
      }));
    }
    await sendAndConfirmTransaction(conn, tx, [deployer]);
  }

  // Create ATAs and mint MYTH to each wallet
  const deployerAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH.mint, deployer.publicKey);
  for (const w of wallets) {
    try {
      const ata = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH.mint, w.publicKey);
      const tx = new Transaction().add(createTransferInstruction(
        deployerAta.address, ata.address, deployer.publicKey, BigInt(100000 * (10 ** MYTH.decimals))
      ));
      await sendAndConfirmTransaction(conn, tx, [deployer]);
    } catch (e) {}
  }

  // Transfer between wallets
  let success = 0;
  for (let i = 0; i < count; i++) {
    const from = wallets[Math.floor(Math.random() * wallets.length)];
    const to = wallets[Math.floor(Math.random() * wallets.length)];
    if (from.publicKey.equals(to.publicKey)) continue;
    try {
      const fromAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH.mint, from.publicKey);
      const toAta = await getOrCreateAssociatedTokenAccount(conn, deployer, MYTH.mint, to.publicKey);
      const bal = Number(fromAta.amount);
      if (bal < 1000) continue;
      const amount = Math.floor(bal * 0.05 + Math.random() * bal * 0.1);
      if (amount <= 0) continue;
      const tx = new Transaction().add(createTransferInstruction(fromAta.address, toAta.address, from.publicKey, BigInt(amount)));
      await sendAndConfirmTransaction(conn, tx, [from]);
      success++;
      if (success % 20 === 0) console.log("  " + success + "/" + count + " token transfers done");
    } catch (e) {}
  }
  console.log("  Completed " + success + "/" + count + " MYTH transfers");
  return success;
}

async function main() {
  console.log("=== Mythic L2 Full Setup & Activity Generator ===\n");
  const startSlot = await conn.getSlot();
  console.log("Starting at slot " + startSlot);

  // Step 1: Mint tokens
  await mintTokens();
  await sleep(500);

  // Step 2: Initialize swap config
  const config = await initSwapConfig();
  await sleep(500);

  // Step 3: Create pools
  console.log("=== Creating pools ===");
  const pools = [];
  const poolConfigs = [
    { a: MYTH, b: WSOL, amtA: 5_000_000 * (10 ** MYTH.decimals), amtB: 25_000 * (10 ** WSOL.decimals) },
    { a: MYTH, b: USDC, amtA: 5_000_000 * (10 ** MYTH.decimals), amtB: 125_000 * (10 ** USDC.decimals) },
    { a: MYTH, b: WBTC, amtA: 2_000_000 * (10 ** MYTH.decimals), amtB: 5 * (10 ** WBTC.decimals) },
    { a: WETH, b: MYTH, amtA: 50 * (10 ** WETH.decimals), amtB: 2_000_000 * (10 ** MYTH.decimals) },
  ];

  for (const pc of poolConfigs) {
    const pool = await createPool(pc.a, pc.b, pc.amtA, pc.amtB, config);
    if (pool) pools.push(pool);
    await sleep(500);
  }

  if (pools.length === 0) {
    console.log("No pools created, exiting");
    return;
  }

  // Save pool setup results
  const result = {
    swapProgramId: SWAP_PROGRAM.toBase58(),
    configPDA: config.configPda.toBase58(),
    tokens: {},
    pools: pools.map(p => ({
      address: p.pool.toBase58(),
      mintA: p.mintA.mint.toBase58(),
      mintB: p.mintB.mint.toBase58(),
      symbolA: p.mintA.symbol,
      symbolB: p.mintB.symbol,
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      lpMint: p.lpMint.toBase58(),
    })),
  };
  for (const t of ALL_TOKENS) {
    result.tokens[t.symbol] = { mint: t.mint.toBase58(), decimals: t.decimals };
  }
  fs.writeFileSync("/mnt/data/mythic-dex-api/swap-setup-result.json", JSON.stringify(result, null, 2));
  console.log("  Saved swap-setup-result.json");

  // Step 4: Generate swap activity
  await sleep(1000);
  const swapCount = await generateSwapActivity(pools, 100);
  await sleep(500);

  // Step 5: Generate SOL transfers
  const solCount = await generateSOLTransfers(200);
  await sleep(500);

  // Step 6: Generate MYTH token transfers
  const tokenCount = await generateTokenTransfers(100);

  const endSlot = await conn.getSlot();
  const total = swapCount + solCount + tokenCount;
  console.log("\n=== Summary ===");
  console.log("Slots: " + startSlot + " -> " + endSlot + " (" + (endSlot - startSlot) + " slots)");
  console.log("Swaps: " + swapCount);
  console.log("SOL transfers: " + solCount);
  console.log("MYTH transfers: " + tokenCount);
  console.log("Total: " + total);
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
