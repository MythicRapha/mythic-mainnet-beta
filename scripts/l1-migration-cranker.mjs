#!/usr/bin/env node
/**
 * MythicPad L1 Migration Cranker
 *
 * Monitors graduated Meteora DBC pools and executes the full migration pipeline:
 *   1. Claim LP tokens from DBC (partner's 70% unlocked)
 *   2. Remove liquidity from Meteora DAMM v1 (receive TOKEN + SOL)
 *   3. Swap SOL -> MYTH via PumpSwap AMM (direct on-chain swap)
 *   4. Deposit MYTH into L1 bridge vault
 *   5. Wait for L2 bridge release
 *   6. Create TOKEN mint on L2
 *   7. Create TOKEN/MYTH pool on MythicSwap L2
 *   8. Airdrop TOKEN to L1 holders on L2
 *   9. Mark migration complete
 *
 * Run: node scripts/l1-migration-cranker.mjs
 * PM2: pm2 start scripts/l1-migration-cranker.mjs --name mythicpad-cranker
 */

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction, createMintToInstruction,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE, getMinimumBalanceForRentExemptMint, getAccount,
} from '@solana/spl-token';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import for Meteora SDK (Anchor-based)
const sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk');

// ── Configuration ───────────────────────────────────────────────────────────

const HELIUS_RPC = 'https://beta.helius-rpc.com/?api-key=60aa17ec-d160-4cd9-8a51-e74f693bc403';
const L2_RPC = process.env.L2_RPC || 'http://127.0.0.1:8899';
const POLL_INTERVAL_MS = 10_000;       // 10 seconds
const BRIDGE_TIMEOUT_MS = 30 * 60_000; // 30 minutes
const HEALTH_PORT = parseInt(process.env.CRANKER_PORT || '4004', 10);
const INDEXER_API = process.env.INDEXER_API || 'http://localhost:4003';

// Program addresses
const DBC_PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const DAMM_V1_PROGRAM = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const L1_BRIDGE_PROGRAM = new PublicKey('oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ');
const L2_BRIDGE_PROGRAM = new PublicKey('MythBrdgL2111111111111111111111111111111111');
const L2_SWAP_PROGRAM = new PublicKey('MythSwap11111111111111111111111111111111111');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const MYTH_L1_MINT = new PublicKey('5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump');
const MYTH_L2_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq');

// Official platform fee claim wallet
const PLATFORM_FEE_WALLET = new PublicKey('6SrpJsrLHFAs6iPHFRNYmtEHUVnXyd1Q3iSqcVp8myth');

// DAMM v1 config address (Meteora)
const DAMM_CONFIG = new PublicKey('8f848CEy8eY6PhJ3VcemtBDzPPSD4Vq7aJczLZ3o8MmX');

// Bridge PDA seeds
const BRIDGE_CONFIG_SEED = Buffer.from('bridge_config');
const VAULT_SEED = Buffer.from('vault');

// MythicSwap PDA seeds
const SWAP_CONFIG_SEED = Buffer.from('swap_config');
const POOL_SEED = Buffer.from('pool');
const LP_MINT_SEED = Buffer.from('lp_mint');
const VAULT_A_SEED = Buffer.from('vault_a');
const VAULT_B_SEED = Buffer.from('vault_b');
const PROTOCOL_VAULT_SEED = Buffer.from('protocol_vault');
const LP_POSITION_SEED = Buffer.from('lp_position');

// PumpSwap AMM (MYTH/SOL liquidity on Solana L1)
const PUMP_AMM_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMPSWAP_POOL = new PublicKey('Hg6fPz8zPQtrV7McXh7SxQndmd6zh4v8HSvQ6yYg3uuB');
const PUMPSWAP_POOL_BASE_TA = new PublicKey('iB28uxnFM6dA2fixVpX9KEthsRWeS2FWwmTXVxqnVyk');   // MYTH (Token-2022)
const PUMPSWAP_POOL_QUOTE_TA = new PublicKey('3dgiBGb3qgsJb3GrkN1ikQTLtZS67dUEmSN1fCE63DAe'); // wSOL (SPL Token)
const PUMPSWAP_PROTOCOL_FEE_RECIPIENT = new PublicKey('7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ');
const PUMPSWAP_COIN_CREATOR_VAULT_ATA = new PublicKey('7znmpogZJo5hjZHTXeLxnYAKT4zyt5LY9WzihCoXZCKS');
const PUMPSWAP_COIN_CREATOR_VAULT_AUTHORITY = new PublicKey('8JnoUKU8KDdxLXbvU5UL5KvgNFEr7vV4ZPQeEBFrY9Kz');
const PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw');
const PUMPSWAP_FEE_ACCOUNT = new PublicKey('5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx');
const PUMPSWAP_FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const PUMPSWAP_FEE_ACCOUNT_2 = new PublicKey('8wEC9pPDiaohSCEirz5ZDoHz5N7YsDxpvz9JBcqYqaoN');
const PUMPSWAP_BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const PUMPSWAP_SLIPPAGE_BPS = 300; // 3%

const [PUMPSWAP_GLOBAL_CONFIG] = PublicKey.findProgramAddressSync(
  [Buffer.from('global_config')], PUMP_AMM_PROGRAM
);
const [PUMPSWAP_EVENT_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')], PUMP_AMM_PROGRAM
);

// ── Keypair Loading ─────────────────────────────────────────────────────────

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

let deployer;
try {
  deployer = loadKeypair('/Users/raphaelcardona/mythic-l2/keys/deployer.json');
} catch {
  deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json');
}

console.log('Deployer:', deployer.publicKey.toBase58());

// ── Connections ─────────────────────────────────────────────────────────────

const l1Conn = new Connection(HELIUS_RPC, 'confirmed');
const l2Conn = new Connection(L2_RPC, 'confirmed');

// ── Database ────────────────────────────────────────────────────────────────

const DB_PATH = join(__dirname, '..', 'data', 'mythicpad-cranker.db');
// Ensure data directory
import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, '..', 'data'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    token_mint TEXT PRIMARY KEY,
    pool_config TEXT NOT NULL,
    virtual_pool TEXT NOT NULL,
    damm_pool TEXT,
    creator TEXT,
    token_name TEXT,
    token_symbol TEXT,
    token_uri TEXT,
    current_step INTEGER DEFAULT 0,
    lp_tokens_claimed INTEGER DEFAULT 0,
    sol_received TEXT DEFAULT '0',
    token_received TEXT DEFAULT '0',
    myth_received TEXT DEFAULT '0',
    bridge_deposit_nonce TEXT,
    l2_token_mint TEXT,
    l2_pool_address TEXT,
    airdrop_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS migration_txs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_mint TEXT NOT NULL,
    step INTEGER NOT NULL,
    chain TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const insertMigration = db.prepare(`
  INSERT OR IGNORE INTO migrations (token_mint, pool_config, virtual_pool, creator, token_name, token_symbol, token_uri)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateStep = db.prepare(`
  UPDATE migrations SET current_step = ?, updated_at = datetime('now') WHERE token_mint = ?
`);

const updateField = db.prepare(`
  UPDATE migrations SET updated_at = datetime('now') WHERE token_mint = ?
`);

const insertTx = db.prepare(`
  INSERT INTO migration_txs (token_mint, step, chain, signature) VALUES (?, ?, ?, ?)
`);

const getInProgress = db.prepare(`
  SELECT * FROM migrations WHERE current_step < 9 AND current_step >= 0
`);

const getMigration = db.prepare(`
  SELECT * FROM migrations WHERE token_mint = ?
`);

// ── Helper: u64 read/write ──────────────────────────────────────────────────

function writeU64LE(buf, offset, val) {
  const big = BigInt(val);
  for (let i = 0; i < 8; i++) buf[offset + i] = Number((big >> BigInt(8 * i)) & 0xFFn);
}

function readU64LE(buf, offset) {
  let val = 0n;
  for (let i = 0; i < 8; i++) val |= BigInt(buf[offset + i]) << BigInt(8 * i);
  return val;
}

// ── SDK Services ────────────────────────────────────────────────────────────

const stateService = new sdk.StateService(l1Conn, 'confirmed');
const migrationService = new sdk.MigrationService(l1Conn, 'confirmed');
const partnerService = new sdk.PartnerService(l1Conn, 'confirmed');
const dammProgram = sdk.createDammV1Program(l1Conn, 'confirmed');

// ── Pool Config PDA (set after partner registration — update this!) ─────────

let POOL_CONFIG = null;

// Try to load from saved config (check both local and server paths)
try {
  const configKey = loadKeypair(join(__dirname, '..', 'keys', 'meteora-pool-config.json'));
  POOL_CONFIG = configKey.publicKey;
  console.log('Pool Config:', POOL_CONFIG.toBase58());
} catch {
  try {
    const configKey = loadKeypair('/mnt/data/mythic-l2/keys/meteora-pool-config.json');
    POOL_CONFIG = configKey.publicKey;
    console.log('Pool Config (server):', POOL_CONFIG.toBase58());
  } catch {
    console.log('WARNING: No pool config keypair found at keys/meteora-pool-config.json');
    console.log('Set POOL_CONFIG_ADDRESS env var or run meteora-partner-setup.mjs first.');
  }
}

if (process.env.POOL_CONFIG_ADDRESS) {
  POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG_ADDRESS);
  console.log('Pool Config (from env):', POOL_CONFIG.toBase58());
}

// ── Step 1: Lock & Claim LP Tokens from DBC ─────────────────────────────────

async function step1ClaimLP(migration) {
  const { token_mint, virtual_pool } = migration;
  console.log(`  [Step 1] Locking & claiming LP tokens for ${token_mint}...`);

  const virtualPoolPk = new PublicKey(virtual_pool);
  const virtualPoolState = await stateService.getPool(virtualPoolPk);
  if (!virtualPoolState) throw new Error('Virtual pool not found');

  const poolConfigState = await stateService.getPoolConfig(virtualPoolState.config);
  if (!poolConfigState) throw new Error('Pool config not found');

  // Get DAMM migration metadata
  const migrationMetadata = await stateService.getDammV1MigrationMetadata(virtualPoolPk);
  if (!migrationMetadata) throw new Error('Migration metadata not found — pool may not have graduated yet');

  const dammPool = migrationMetadata.pool;

  // 1a. Lock LP tokens
  console.log(`    Locking LP tokens...`);
  const lockTx = await migrationService.lockDammV1LpToken({
    virtualPool: virtualPoolPk,
    dammConfig: DAMM_CONFIG,
    payer: deployer.publicKey,
    isPartner: true,
  });

  lockTx.recentBlockhash = (await l1Conn.getLatestBlockhash()).blockhash;
  lockTx.feePayer = deployer.publicKey;
  lockTx.sign(deployer);

  const lockSig = await sendAndConfirmTransaction(l1Conn, lockTx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: true,
  });
  console.log(`    Locked LP: ${lockSig}`);
  insertTx.run(token_mint, 1, 'l1', lockSig);

  // 1b. Claim partner LP (unlocked 70%)
  console.log(`    Claiming partner LP...`);
  const claimTx = await migrationService.claimDammV1LpToken({
    virtualPool: virtualPoolPk,
    dammConfig: DAMM_CONFIG,
    payer: deployer.publicKey,
    isPartner: true,
  });

  claimTx.recentBlockhash = (await l1Conn.getLatestBlockhash()).blockhash;
  claimTx.feePayer = deployer.publicKey;
  claimTx.sign(deployer);

  const claimSig = await sendAndConfirmTransaction(l1Conn, claimTx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: true,
  });
  console.log(`    Claimed partner LP: ${claimSig}`);
  insertTx.run(token_mint, 1, 'l1', claimSig);

  // 1c. Claim creator LP (unlocked 5%)
  console.log(`    Claiming creator LP...`);
  try {
    const creatorClaimTx = await migrationService.claimDammV1LpToken({
      virtualPool: virtualPoolPk,
      dammConfig: DAMM_CONFIG,
      payer: deployer.publicKey,
      isPartner: false,
    });

    creatorClaimTx.recentBlockhash = (await l1Conn.getLatestBlockhash()).blockhash;
    creatorClaimTx.feePayer = deployer.publicKey;
    creatorClaimTx.sign(deployer);

    const creatorSig = await sendAndConfirmTransaction(l1Conn, creatorClaimTx, [deployer], {
      commitment: 'confirmed',
      skipPreflight: true,
    });
    console.log(`    Claimed creator LP: ${creatorSig}`);
    insertTx.run(token_mint, 1, 'l1', creatorSig);
  } catch (err) {
    console.log(`    Creator LP claim skipped (non-fatal): ${err.message}`);
  }

  // Update DB
  db.prepare('UPDATE migrations SET damm_pool = ?, lp_tokens_claimed = 1, updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(dammPool.toBase58(), token_mint);
  updateStep.run(1, token_mint);
}

// ── Step 2: Remove Liquidity from DAMM v1 ──────────────────────────────────

async function step2RemoveLiquidity(migration) {
  const { token_mint, damm_pool } = migration;
  console.log(`  [Step 2] Removing liquidity from DAMM v1 for ${token_mint}...`);

  const dammPoolPk = new PublicKey(damm_pool);
  const tokenMintPk = new PublicKey(token_mint);

  // Get pool info to find LP mint and reserves
  const poolInfo = await l1Conn.getAccountInfo(dammPoolPk);
  if (!poolInfo) throw new Error('DAMM pool account not found');

  // Get LP mint for this DAMM pool
  const lpMint = sdk.deriveDammV1LpMintAddress(dammPoolPk);

  // Get our LP token balance
  const lpATA = getAssociatedTokenAddressSync(lpMint, deployer.publicKey, false, TOKEN_PROGRAM_ID);
  const lpBalance = await l1Conn.getTokenAccountBalance(lpATA).catch(() => null);
  if (!lpBalance || BigInt(lpBalance.value.amount) === 0n) {
    console.log('    No LP tokens to withdraw — may already be removed');
    updateStep.run(2, token_mint);
    return;
  }

  const lpAmount = BigInt(lpBalance.value.amount);
  console.log(`    LP balance: ${lpAmount}`);

  // Get TOKEN and SOL ATAs
  const tokenATA = getAssociatedTokenAddressSync(tokenMintPk, deployer.publicKey, false, TOKEN_PROGRAM_ID);

  // Derive vault PDAs for each token side (Meteora vault program)
  const aVaultPdas = sdk.deriveVaultPdas(tokenMintPk);
  const bVaultPdas = sdk.deriveVaultPdas(SOL_MINT);

  const BN = (await import('bn.js')).default;

  // Build removeBalanceLiquidity via DAMM program
  const tx = await dammProgram.methods
    .removeBalanceLiquidity(
      new BN(lpAmount.toString()),
      [new BN(0), new BN(0)] // min amounts
    )
    .accounts({
      pool: dammPoolPk,
      lpMint: lpMint,
      userPoolLp: lpATA,
      aTokenVault: sdk.deriveDammV1VaultLPAddress(dammPoolPk, true),
      bTokenVault: sdk.deriveDammV1VaultLPAddress(dammPoolPk, false),
      aVault: aVaultPdas.vaultPda,
      bVault: bVaultPdas.vaultPda,
      aVaultLp: aVaultPdas.lpMintPda,
      bVaultLp: bVaultPdas.lpMintPda,
      aVaultLpMint: aVaultPdas.lpMintPda,
      bVaultLpMint: bVaultPdas.lpMintPda,
      userAToken: tokenATA,
      userBToken: getAssociatedTokenAddressSync(SOL_MINT, deployer.publicKey),
      user: deployer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  tx.recentBlockhash = (await l1Conn.getLatestBlockhash()).blockhash;
  tx.feePayer = deployer.publicKey;

  const sig = await sendAndConfirmTransaction(l1Conn, tx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: true,
  });

  // Check resulting balances
  const tokenBal = await l1Conn.getTokenAccountBalance(tokenATA).catch(() => ({ value: { amount: '0' } }));
  const solBal = await l1Conn.getBalance(deployer.publicKey);

  console.log(`    Removed liquidity: ${sig}`);
  console.log(`    TOKEN received: ${tokenBal.value.amount}`);
  insertTx.run(token_mint, 2, 'l1', sig);

  db.prepare('UPDATE migrations SET sol_received = ?, token_received = ?, updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(solBal.toString(), tokenBal.value.amount, token_mint);
  updateStep.run(2, token_mint);
}

// ── Step 3: Swap SOL -> MYTH via PumpSwap AMM ──────────────────────────────

async function step3SwapSolToMyth(migration) {
  const { token_mint } = migration;
  console.log(`  [Step 3] Swapping SOL -> MYTH via PumpSwap for ${token_mint}...`);

  // Calculate SOL available for swap (keep 0.1 SOL for fees)
  const solBalance = await l1Conn.getBalance(deployer.publicKey);
  const reserveSol = 0.1 * LAMPORTS_PER_SOL;
  const swapAmount = BigInt(solBalance) - BigInt(Math.floor(reserveSol));

  if (swapAmount <= 0n) {
    throw new Error(`Insufficient SOL for swap. Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
  }

  console.log(`    Swapping ${Number(swapAmount) / LAMPORTS_PER_SOL} SOL -> MYTH`);

  // Read pool reserves to calculate expected output
  const baseAcct = await getAccount(l1Conn, PUMPSWAP_POOL_BASE_TA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const quoteAcctInfo = await l1Conn.getAccountInfo(PUMPSWAP_POOL_QUOTE_TA);
  const solReserve = quoteAcctInfo.data.readBigUInt64LE(64);
  const mythReserve = baseAcct.amount;

  // Constant product AMM math with ~2% estimated fees
  const feeEstBps = 200n;
  const solAfterFee = swapAmount * (10000n - feeEstBps) / 10000n;
  const product = solReserve * mythReserve;
  const newSolReserve = solReserve + solAfterFee;
  const expectedMythOut = mythReserve - (product / newSolReserve + 1n);
  const minMythOut = expectedMythOut * BigInt(10000 - PUMPSWAP_SLIPPAGE_BPS) / 10000n;

  console.log(`    Pool reserves: ${Number(mythReserve) / 1e6} MYTH / ${Number(solReserve) / 1e9} SOL`);
  console.log(`    Expected MYTH out: ~${Number(expectedMythOut) / 1e6}`);

  // Build PumpSwap buy instruction (24 accounts)
  const buyData = Buffer.alloc(8 + 8 + 8);
  PUMPSWAP_BUY_DISCRIMINATOR.copy(buyData, 0);
  buyData.writeBigUInt64LE(minMythOut, 8);
  buyData.writeBigUInt64LE(swapAmount, 16);

  const userMythATA = getAssociatedTokenAddressSync(MYTH_L1_MINT, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const userWsolATA = getAssociatedTokenAddressSync(SOL_MINT, deployer.publicKey, false, TOKEN_PROGRAM_ID);
  const protocolFeeRecipientTA = getAssociatedTokenAddressSync(
    SOL_MINT, PUMPSWAP_PROTOCOL_FEE_RECIPIENT, true, TOKEN_PROGRAM_ID
  );
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), deployer.publicKey.toBuffer()],
    PUMP_AMM_PROGRAM
  );

  const buyIx = new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM,
    keys: [
      { pubkey: PUMPSWAP_POOL, isSigner: false, isWritable: true },
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: PUMPSWAP_GLOBAL_CONFIG, isSigner: false, isWritable: false },
      { pubkey: MYTH_L1_MINT, isSigner: false, isWritable: false },
      { pubkey: SOL_MINT, isSigner: false, isWritable: false },
      { pubkey: userMythATA, isSigner: false, isWritable: true },
      { pubkey: userWsolATA, isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_POOL_BASE_TA, isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_POOL_QUOTE_TA, isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_PROTOCOL_FEE_RECIPIENT, isSigner: false, isWritable: false },
      { pubkey: protocolFeeRecipientTA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_AMM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_COIN_CREATOR_VAULT_ATA, isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_COIN_CREATOR_VAULT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: true },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_FEE_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_FEE_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_FEE_ACCOUNT_2, isSigner: false, isWritable: true },
    ],
    data: buyData,
  });

  // Build transaction
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }));

  // Create MYTH ATA (Token-2022) if needed
  tx.add(createAssociatedTokenAccountIdempotentInstruction(
    deployer.publicKey, userMythATA, deployer.publicKey, MYTH_L1_MINT, TOKEN_2022_PROGRAM_ID
  ));
  // Create wSOL ATA if needed
  tx.add(createAssociatedTokenAccountIdempotentInstruction(
    deployer.publicKey, userWsolATA, deployer.publicKey, SOL_MINT, TOKEN_PROGRAM_ID
  ));

  // Wrap SOL
  tx.add(SystemProgram.transfer({
    fromPubkey: deployer.publicKey,
    toPubkey: userWsolATA,
    lamports: Number(swapAmount),
  }));
  tx.add(new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: userWsolATA, isSigner: false, isWritable: true }],
    data: Buffer.from([17]), // SyncNative
  }));

  // PumpSwap Buy
  tx.add(buyIx);

  // Close wSOL account to recover remaining SOL
  tx.add(new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: userWsolATA, isSigner: false, isWritable: true },
      { pubkey: deployer.publicKey, isSigner: false, isWritable: true },
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]), // CloseAccount
  }));

  const sig = await sendAndConfirmTransaction(l1Conn, tx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: true,
  });

  // Check MYTH balance (MYTH is Token-2022 on L1)
  const mythBal = await l1Conn.getTokenAccountBalance(userMythATA).catch(() => ({ value: { amount: '0' } }));

  console.log(`    Swapped: ${sig}`);
  console.log(`    MYTH balance: ${mythBal.value.amount} (${Number(mythBal.value.amount) / 1e6} human)`);
  insertTx.run(token_mint, 3, 'l1', sig);

  db.prepare('UPDATE migrations SET myth_received = ?, updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(mythBal.value.amount, token_mint);
  updateStep.run(3, token_mint);
}

// ── Step 4: Deposit MYTH into L1 Bridge ─────────────────────────────────────

async function step4BridgeDeposit(migration) {
  const { token_mint } = migration;
  console.log(`  [Step 4] Depositing MYTH into L1 bridge for ${token_mint}...`);

  // Get MYTH balance on L1 (MYTH is Token-2022 on L1)
  const mythATA = getAssociatedTokenAddressSync(MYTH_L1_MINT, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const mythBal = await l1Conn.getTokenAccountBalance(mythATA);
  const depositAmount = BigInt(mythBal.value.amount);

  if (depositAmount === 0n) {
    throw new Error('No MYTH to deposit');
  }

  console.log(`    Depositing ${Number(depositAmount) / 1e6} MYTH into bridge`);

  // Bridge PDAs
  const [configPDA] = PublicKey.findProgramAddressSync([BRIDGE_CONFIG_SEED], L1_BRIDGE_PROGRAM);
  const [vaultPDA] = PublicKey.findProgramAddressSync([VAULT_SEED, MYTH_L1_MINT.toBuffer()], L1_BRIDGE_PROGRAM);

  // Build deposit instruction
  // Deposit = IX discriminator 1 + DepositParams { amount: u64, l2_recipient: [u8; 32] }
  const data = Buffer.alloc(1 + 8 + 32);
  data[0] = 1; // IX_DEPOSIT
  writeU64LE(data, 1, depositAmount);
  deployer.publicKey.toBuffer().copy(data, 9); // l2_recipient = deployer (same address on L2)

  const ix = new TransactionInstruction({
    programId: L1_BRIDGE_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },   // depositor
      { pubkey: mythATA, isSigner: false, isWritable: true },              // depositor_token
      { pubkey: vaultPDA, isSigner: false, isWritable: true },             // vault_token
      { pubkey: MYTH_L1_MINT, isSigner: false, isWritable: false },        // token_mint
      { pubkey: configPDA, isSigner: false, isWritable: true },            // config
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program (MYTH is Token-2022)
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(l1Conn, tx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: true,
  });

  // Read deposit nonce from config
  const configInfo = await l1Conn.getAccountInfo(configPDA);
  const depositNonce = readU64LE(configInfo.data, 128); // approximate offset for deposit_nonce

  console.log(`    Bridge deposit: ${sig}`);
  console.log(`    Deposit nonce: ${depositNonce}`);
  insertTx.run(token_mint, 4, 'l1', sig);

  db.prepare('UPDATE migrations SET bridge_deposit_nonce = ?, updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(depositNonce.toString(), token_mint);
  updateStep.run(4, token_mint);
}

// ── Step 5: Wait for L2 Bridge Release ──────────────────────────────────────

async function step5WaitBridgeRelease(migration) {
  const { token_mint, bridge_deposit_nonce, myth_received } = migration;
  console.log(`  [Step 5] Waiting for L2 bridge release (nonce ${bridge_deposit_nonce})...`);

  // Check deployer's MYTH balance on L2
  const mythL2ATA = getAssociatedTokenAddressSync(MYTH_L2_MINT, deployer.publicKey, false, TOKEN_PROGRAM_ID);

  const startTime = Date.now();
  while (Date.now() - startTime < BRIDGE_TIMEOUT_MS) {
    try {
      const bal = await l2Conn.getTokenAccountBalance(mythL2ATA);
      if (BigInt(bal.value.amount) > 0n) {
        console.log(`    L2 MYTH received: ${bal.value.amount} (${Number(bal.value.amount) / 1e6} human)`);
        updateStep.run(5, token_mint);
        return;
      }
    } catch {
      // ATA doesn't exist yet
    }

    console.log(`    Waiting... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    await new Promise(r => setTimeout(r, 15_000)); // Check every 15s
  }

  throw new Error(`Bridge release timed out after ${BRIDGE_TIMEOUT_MS / 60_000} minutes`);
}

// ── Step 6: Create TOKEN on L2 ──────────────────────────────────────────────

async function step6CreateL2Token(migration) {
  const { token_mint, token_name, token_symbol } = migration;
  console.log(`  [Step 6] Creating TOKEN on L2 for ${token_mint}...`);

  // Generate deterministic mint keypair from L1 token mint (so it's reproducible)
  const mintKeypair = Keypair.generate();
  const mintPk = mintKeypair.publicKey;

  console.log(`    L2 Token Mint: ${mintPk.toBase58()}`);

  // Create mint account
  const rentLamports = await getMinimumBalanceForRentExemptMint(l2Conn);

  const createMintIx = SystemProgram.createAccount({
    fromPubkey: deployer.publicKey,
    newAccountPubkey: mintPk,
    space: MINT_SIZE,
    lamports: rentLamports,
    programId: TOKEN_PROGRAM_ID,
  });

  const initMintIx = createInitializeMintInstruction(
    mintPk,
    6, // 6 decimals
    deployer.publicKey, // mint authority
    null, // no freeze authority
    TOKEN_PROGRAM_ID,
  );

  // Create deployer's ATA for this token
  const deployerATA = getAssociatedTokenAddressSync(mintPk, deployer.publicKey, false, TOKEN_PROGRAM_ID);
  const createATAIx = createAssociatedTokenAccountIdempotentInstruction(
    deployer.publicKey,
    deployerATA,
    deployer.publicKey,
    mintPk,
    TOKEN_PROGRAM_ID,
  );

  // Mint 1B tokens (total supply)
  const totalSupply = 1_000_000_000n * 1_000_000n; // 1B with 6 decimals
  const mintToIx = createMintToInstruction(
    mintPk,
    deployerATA,
    deployer.publicKey,
    totalSupply,
    [],
    TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction().add(createMintIx, initMintIx, createATAIx, mintToIx);
  const sig = await sendAndConfirmTransaction(l2Conn, tx, [deployer, mintKeypair], {
    commitment: 'confirmed',
    skipPreflight: true,
  });

  console.log(`    Created L2 token: ${sig}`);
  console.log(`    Mint: ${mintPk.toBase58()}`);
  console.log(`    Supply: 1,000,000,000 ${token_symbol || 'TOKEN'}`);
  insertTx.run(token_mint, 6, 'l2', sig);

  db.prepare('UPDATE migrations SET l2_token_mint = ?, updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(mintPk.toBase58(), token_mint);
  updateStep.run(6, token_mint);
}

// ── Step 7: Create TOKEN/MYTH Pool on MythicSwap L2 ─────────────────────────

async function step7CreatePool(migration) {
  const m = getMigration.get(migration.token_mint);
  const { token_mint, l2_token_mint, myth_received } = m;
  console.log(`  [Step 7] Creating TOKEN/MYTH pool on MythicSwap L2...`);

  const tokenMintPk = new PublicKey(l2_token_mint);

  // Get MYTH balance on L2 (amount received from bridge)
  const mythATA = getAssociatedTokenAddressSync(MYTH_L2_MINT, deployer.publicKey, false, TOKEN_PROGRAM_ID);
  const mythBal = await l2Conn.getTokenAccountBalance(mythATA);
  const mythAmount = BigInt(mythBal.value.amount);

  // Calculate TOKEN amount proportional to MYTH for initial liquidity
  // Use 20% of the token supply for LP (matching percentageSupplyOnMigration)
  const tokenLpAmount = 200_000_000n * 1_000_000n; // 200M tokens (20% of 1B) with 6 decimals

  // Sort mints for MythicSwap (mint_a < mint_b)
  const cmp = tokenMintPk.toBuffer().compare(MYTH_L2_MINT.toBuffer());
  const [mintA, mintB] = cmp < 0 ? [tokenMintPk, MYTH_L2_MINT] : [MYTH_L2_MINT, tokenMintPk];
  const [amountA, amountB] = cmp < 0 ? [tokenLpAmount, mythAmount] : [mythAmount, tokenLpAmount];

  // Derive PDAs
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [POOL_SEED, mintA.toBuffer(), mintB.toBuffer()], L2_SWAP_PROGRAM
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [LP_MINT_SEED, poolPDA.toBuffer()], L2_SWAP_PROGRAM
  );
  const [vaultAPDA] = PublicKey.findProgramAddressSync(
    [VAULT_A_SEED, poolPDA.toBuffer()], L2_SWAP_PROGRAM
  );
  const [vaultBPDA] = PublicKey.findProgramAddressSync(
    [VAULT_B_SEED, poolPDA.toBuffer()], L2_SWAP_PROGRAM
  );
  const [protocolVaultPDA] = PublicKey.findProgramAddressSync(
    [PROTOCOL_VAULT_SEED], L2_SWAP_PROGRAM
  );
  const [swapConfigPDA] = PublicKey.findProgramAddressSync(
    [SWAP_CONFIG_SEED], L2_SWAP_PROGRAM
  );

  // Get deployer ATAs
  const creatorTokenA = getAssociatedTokenAddressSync(mintA, deployer.publicKey, false, TOKEN_PROGRAM_ID);
  const creatorTokenB = getAssociatedTokenAddressSync(mintB, deployer.publicKey, false, TOKEN_PROGRAM_ID);
  const creatorLpATA = getAssociatedTokenAddressSync(lpMintPDA, deployer.publicKey, false, TOKEN_PROGRAM_ID);

  // Ensure ATAs exist
  const ensureATAs = new Transaction();
  ensureATAs.add(
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, creatorTokenA, deployer.publicKey, mintA, TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, creatorTokenB, deployer.publicKey, mintB, TOKEN_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(l2Conn, ensureATAs, [deployer], { skipPreflight: true, commitment: 'confirmed' });

  // CreatePool instruction: disc=1, initial_amount_a: u64, initial_amount_b: u64
  const data = Buffer.alloc(1 + 8 + 8);
  data[0] = 1; // CreatePool discriminator
  writeU64LE(data, 1, amountA);
  writeU64LE(data, 9, amountB);

  const ix = new TransactionInstruction({
    programId: L2_SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },     // creator
      { pubkey: swapConfigPDA, isSigner: false, isWritable: true },         // config
      { pubkey: poolPDA, isSigner: false, isWritable: true },               // pool
      { pubkey: mintA, isSigner: false, isWritable: false },                // mint_a
      { pubkey: mintB, isSigner: false, isWritable: false },                // mint_b
      { pubkey: vaultAPDA, isSigner: false, isWritable: true },             // vault_a
      { pubkey: vaultBPDA, isSigner: false, isWritable: true },             // vault_b
      { pubkey: lpMintPDA, isSigner: false, isWritable: true },             // lp_mint
      { pubkey: creatorTokenA, isSigner: false, isWritable: true },         // creator_token_a
      { pubkey: creatorTokenB, isSigner: false, isWritable: true },         // creator_token_b
      { pubkey: creatorLpATA, isSigner: false, isWritable: true },          // creator_lp_ata
      { pubkey: protocolVaultPDA, isSigner: false, isWritable: true },      // protocol_vault
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },     // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false }, // rent
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // ata_program
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(l2Conn, tx, [deployer], {
    commitment: 'confirmed',
    skipPreflight: true,
  });

  console.log(`    Pool created: ${sig}`);
  console.log(`    Pool PDA: ${poolPDA.toBase58()}`);
  console.log(`    Amount A: ${amountA} | Amount B: ${amountB}`);
  insertTx.run(token_mint, 7, 'l2', sig);

  db.prepare('UPDATE migrations SET l2_pool_address = ?, updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(poolPDA.toBase58(), token_mint);
  updateStep.run(7, token_mint);
}

// ── Step 8: Skip (holders migrate manually via website) ─────────────────────
// L1 holders keep their tokens on L1 (25% LP stays on Meteora DAMM).
// Users migrate to L2 manually via mythic.fun "Migrate to L2" flow.

async function step8Skip(migration) {
  const { token_mint } = getMigration.get(migration.token_mint);
  console.log(`  [Step 8] Skipped — L1 holders migrate manually via mythic.fun`);
  updateStep.run(8, token_mint);
}

// ── Step 9: Mark Complete ───────────────────────────────────────────────────

async function step9Complete(migration) {
  const m = getMigration.get(migration.token_mint);
  const { token_mint, l2_token_mint, l2_pool_address } = m;
  console.log(`  [Step 9] Finalizing migration for ${token_mint}...`);

  // Notify the indexer API
  if (l2_token_mint && l2_pool_address) {
    try {
      const resp = await fetch(`${INDEXER_API}/api/launches/${token_mint}/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          l2_pool_address,
          l2_mint: l2_token_mint,
        }),
      });
      const result = await resp.json();
      if (result.ok) {
        console.log(`    Indexer updated: migrated status set`);
      } else {
        console.log(`    Indexer update response: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.log(`    Indexer API call failed (non-fatal): ${err.message}`);
    }
  }

  db.prepare('UPDATE migrations SET current_step = 9, completed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE token_mint = ?')
    .run(token_mint);
  console.log(`  [Step 9] Migration COMPLETE for ${token_mint}`);
}

// ── Pipeline Runner ─────────────────────────────────────────────────────────

const STEPS = [
  null, // step 0 = not started
  step1ClaimLP,
  step2RemoveLiquidity,
  step3SwapSolToMyth,
  step4BridgeDeposit,
  step5WaitBridgeRelease,
  step6CreateL2Token,
  step7CreatePool,
  step8Skip,
  step9Complete,
];

async function runPipeline(migration) {
  const startStep = migration.current_step + 1;
  console.log(`\nProcessing ${migration.token_mint} (step ${startStep}/9)...`);

  for (let step = startStep; step <= 9; step++) {
    try {
      await STEPS[step](migration);
      // Refresh migration data from DB after each step
      migration = getMigration.get(migration.token_mint);
    } catch (e) {
      console.error(`  [Step ${step}] FAILED: ${e.message}`);
      db.prepare('UPDATE migrations SET error_message = ?, updated_at = datetime(\'now\') WHERE token_mint = ?')
        .run(e.message, migration.token_mint);
      return; // Stop pipeline, will retry on next poll
    }
  }
}

// ── Poll for Graduated Pools ────────────────────────────────────────────────

async function pollGraduatedPools() {
  if (!POOL_CONFIG) return;

  try {
    // Get all virtual pools under our config
    const pools = await stateService.getPoolsByConfig(POOL_CONFIG);
    if (!pools || pools.length === 0) return;

    for (const pool of pools) {
      // Check if pool has migrated (graduated)
      if (!pool.account.migrated) continue;

      const tokenMint = pool.account.baseMint.toBase58();

      // Check if already tracked
      const existing = getMigration.get(tokenMint);
      if (existing && existing.current_step >= 9) continue; // Already completed

      if (!existing) {
        // Get metadata for name/symbol
        let name = '', symbol = '', uri = '';
        try {
          const metadata = await stateService.getPoolMetadata(pool.publicKey);
          if (metadata) {
            name = metadata.name || '';
            symbol = metadata.symbol || '';
            uri = metadata.uri || '';
          }
        } catch {}

        console.log(`\nNew graduated pool: ${tokenMint} (${symbol || 'unknown'})`);
        insertMigration.run(
          tokenMint,
          POOL_CONFIG.toBase58(),
          pool.publicKey.toBase58(),
          pool.account.creator.toBase58(),
          name, symbol, uri
        );
      }

      // Run/resume pipeline
      const migration = getMigration.get(tokenMint);
      await runPipeline(migration);
    }
  } catch (e) {
    console.error('Poll error:', e.message);
  }
}

// Also check the indexer API for graduated tokens we might have missed
async function pollIndexerForGraduations() {
  try {
    const resp = await fetch(`${INDEXER_API}/api/graduated?limit=50`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data?.tokens) return;

    for (const token of data.tokens) {
      if (token.status !== 'graduated') continue;

      const existing = getMigration.get(token.mint);
      if (existing && existing.current_step >= 9) continue;

      if (!existing && POOL_CONFIG) {
        console.log(`\nNew graduation from indexer: ${token.mint} (${token.symbol || 'unknown'})`);
        insertMigration.run(
          token.mint,
          POOL_CONFIG.toBase58(),
          token.pool_address || '',
          token.creator || '',
          token.name || '', token.symbol || '', token.uri || ''
        );

        if (token.l1_damm_pool) {
          db.prepare('UPDATE migrations SET damm_pool = ? WHERE token_mint = ?')
            .run(token.l1_damm_pool, token.mint);
        }
      }
    }
  } catch {
    // Indexer may not be running yet — silent fail
  }
}

// Also resume any in-progress migrations
async function resumeInProgress() {
  const inProgress = getInProgress.all();
  for (const migration of inProgress) {
    await runPipeline(migration);
  }
}

// ── Health Endpoint ─────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const inProgress = getInProgress.all();
    const totalMigrations = db.prepare('SELECT COUNT(*) as c FROM migrations').get().c;
    const completed = db.prepare('SELECT COUNT(*) as c FROM migrations WHERE current_step = 9').get().c;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      poolConfig: POOL_CONFIG?.toBase58() || null,
      totalMigrations,
      completed,
      inProgress: inProgress.length,
      pending: inProgress.map(m => ({
        token: m.token_mint,
        step: m.current_step,
        error: m.error_message,
      })),
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(HEALTH_PORT, () => {
  console.log(`Health endpoint: http://localhost:${HEALTH_PORT}/health`);
});

// ── Main Loop ───────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('=== MythicPad L1 Migration Cranker ===');
  console.log(`  L1 RPC: ${HELIUS_RPC.replace(/api-key=.*/, 'api-key=***')}`);
  console.log(`  L2 RPC: ${L2_RPC}`);
  console.log(`  Pool Config: ${POOL_CONFIG?.toBase58() || 'NOT SET'}`);
  console.log(`  Deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  DB: ${DB_PATH}`);
  console.log('');

  if (!POOL_CONFIG) {
    console.log('WARNING: No pool config set. Cranker will only resume existing migrations.');
    console.log('Run meteora-partner-setup.mjs --execute first, then set POOL_CONFIG_ADDRESS.');
  }

  // Resume any in-progress migrations
  await resumeInProgress();

  // Main poll loop
  console.log('Starting poll loop...\n');
  while (true) {
    await pollGraduatedPools();
    await pollIndexerForGraduations();
    await resumeInProgress();
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
