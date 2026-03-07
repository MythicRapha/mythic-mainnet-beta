#!/usr/bin/env node
/**
 * MythicPad — Test Token Launch on Meteora DBC (Mainnet)
 *
 * Launches a test token using our test PoolConfig (0.03 SOL graduation)
 * then buys enough to trigger graduation.
 *
 * Usage:
 *   DRY RUN:  node scripts/meteora-test-launch.mjs
 *   EXECUTE:  node scripts/meteora-test-launch.mjs --execute
 *   BUY ONLY: node scripts/meteora-test-launch.mjs --execute --buy-only <poolAddress>
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { readFileSync } from 'fs';

const sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk');

// ── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = 'https://beta.helius-rpc.com/?api-key=60aa17ec-d160-4cd9-8a51-e74f693bc403';
const EXECUTE = process.argv.includes('--execute');
const BUY_ONLY = process.argv.includes('--buy-only');
const POOL_ARG = process.argv[process.argv.indexOf('--buy-only') + 1];

// Load test config address
let POOL_CONFIG;
try {
  const configKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync('/Users/raphaelcardona/mythic-l2/keys/meteora-pool-config-test.json', 'utf8')))
  );
  POOL_CONFIG = configKp.publicKey;
} catch {
  POOL_CONFIG = new PublicKey('3w7MK2q4rB93sv1qAN6HaLZFpXXJzsYaZHDbFbpwSGVW');
}

const QUOTE_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ── Keypair ─────────────────────────────────────────────────────────────────

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

let deployer;
try { deployer = loadKeypair('/Users/raphaelcardona/mythic-l2/keys/deployer.json'); }
catch { deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json'); }

console.log('=== MythicPad Test Token Launch ===');
console.log(`  Deployer: ${deployer.publicKey.toBase58()}`);
console.log(`  PoolConfig: ${POOL_CONFIG.toBase58()}`);
console.log(`  Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
console.log('');

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`  Balance: ${balance / 1e9} SOL`);
  console.log('');

  if (BUY_ONLY && POOL_ARG) {
    // Just buy on an existing pool
    await buyOnPool(connection, new PublicKey(POOL_ARG));
    return;
  }

  // Step 1: Create a test token pool
  console.log('=== Step 1: Create Test Token Pool ===');

  const baseMint = Keypair.generate();
  console.log(`  Base mint (new token): ${baseMint.publicKey.toBase58()}`);

  const poolService = new sdk.PoolService(connection, 'confirmed');

  const createTx = await poolService.createPool({
    config: POOL_CONFIG,
    baseMint: baseMint.publicKey,
    name: 'MythicPad Test Token',
    symbol: 'MTEST',
    uri: 'https://mythic.fun/test-token.json',
    payer: deployer.publicKey,
    poolCreator: deployer.publicKey,
  });

  console.log(`  Instructions: ${createTx.instructions.length}`);

  // Derive the pool address
  const stateService = new sdk.StateService(connection, 'confirmed');

  if (!EXECUTE) {
    console.log('');
    console.log('DRY RUN — transaction NOT sent.');
    console.log('Run with --execute to create the test token.');
    return;
  }

  // Send create transaction
  console.log('  Sending create transaction...');
  createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  createTx.feePayer = deployer.publicKey;
  createTx.sign(deployer, baseMint);

  const createSig = await connection.sendRawTransaction(createTx.serialize(), { skipPreflight: true });
  console.log(`  TX: ${createSig}`);
  console.log('  Confirming...');
  await connection.confirmTransaction(createSig, 'confirmed');
  console.log('  CONFIRMED');
  console.log('');

  // Find the pool
  console.log('  Finding pool...');
  await new Promise(r => setTimeout(r, 3000)); // wait for indexing

  const pools = await stateService.getPoolsByConfig(POOL_CONFIG);
  const pool = pools.find(p => p.baseMint?.equals(baseMint.publicKey));

  if (!pool) {
    console.log('  WARNING: Could not find pool automatically. Check Solscan for the token.');
    console.log(`  Base mint: ${baseMint.publicKey.toBase58()}`);
    console.log(`  Try: node scripts/meteora-test-launch.mjs --execute --buy-only <poolAddress>`);
    return;
  }

  console.log(`  Pool found: ${pool.pool.toBase58()}`);
  console.log('');

  // Step 2: Buy enough to graduate (0.03 SOL + buffer)
  await buyOnPool(connection, pool.pool);
}

async function buyOnPool(connection, poolAddress) {
  console.log(`=== Step 2: Buy to Graduation (0.035 SOL) ===`);
  console.log(`  Pool: ${poolAddress.toBase58()}`);

  const poolService = new sdk.PoolService(connection, 'confirmed');

  // Buy 0.035 SOL worth (threshold is 0.03, extra for fees)
  const buyAmountLamports = 35_000_000; // 0.035 SOL

  const swapTx = await poolService.swap({
    pool: poolAddress,
    owner: deployer.publicKey,
    inputAmount: buyAmountLamports,
    minimumOutputAmount: 0, // no slippage protection for test
    swapBaseForQuote: false, // buying base (token) with quote (SOL)
    referralTokenAccount: null,
  });

  console.log(`  Buy amount: ${buyAmountLamports / 1e9} SOL`);
  console.log(`  Instructions: ${swapTx.instructions.length}`);

  if (!EXECUTE) {
    console.log('');
    console.log('DRY RUN — buy NOT executed.');
    return;
  }

  console.log('  Sending buy transaction...');
  swapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  swapTx.feePayer = deployer.publicKey;
  swapTx.sign(deployer);

  const buySig = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: true });
  console.log(`  TX: ${buySig}`);
  console.log('  Confirming...');
  await connection.confirmTransaction(buySig, 'confirmed');
  console.log('  CONFIRMED');
  console.log('');

  // Check if graduated
  console.log('=== Checking Graduation Status ===');
  await new Promise(r => setTimeout(r, 2000));

  const stateService = new sdk.StateService(connection, 'confirmed');
  try {
    const poolState = await stateService.getPool(poolAddress);
    console.log(`  Pool status: ${JSON.stringify({
      migrated: poolState.migrated,
      migrationProgress: poolState.migrationProgress,
    })}`);

    if (poolState.migrated) {
      console.log('');
      console.log('  TOKEN GRADUATED! Migration should be triggered by the cranker.');
      console.log('  The cranker will: claim LP → remove liquidity → swap SOL→MYTH → bridge → create L2 pool');
    } else {
      console.log('  Not yet graduated. May need more SOL or migration needs to be triggered.');
      console.log('  Meteora keepers auto-trigger migration when threshold is met.');
    }
  } catch (e) {
    console.log(`  Could not read pool state: ${e.message}`);
  }

  console.log('');
  console.log('=== Test Complete ===');
  console.log(`  Pool: ${poolAddress.toBase58()}`);
  console.log(`  Explorer: https://solscan.io/tx/${buySig}`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  if (err.logs) console.error('Program logs:', err.logs);
  process.exit(1);
});
