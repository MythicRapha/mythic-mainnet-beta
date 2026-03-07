#!/usr/bin/env node
/**
 * MythicPad — Meteora DBC Partner Registration
 *
 * Registers a reusable PoolConfig on-chain via the Meteora Dynamic Bonding Curve
 * program. Any creator can launch a token through mythic.fun using this config.
 *
 * Config summary:
 *   - 20 SOL graduation threshold
 *   - 1% base fee (decaying to 0.25% over 2h)
 *   - LP split: 70% partner unlocked / 25% partner locked / 5% creator unlocked
 *   - Fee split: 50% platform / 50% creator
 *   - SPL Token, 6 decimals, DAMM v1 migration
 *
 * Usage:
 *   DRY RUN (default):  node scripts/meteora-partner-setup.mjs
 *   EXECUTE ON MAINNET: node scripts/meteora-partner-setup.mjs --execute
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';
import BN from 'bn.js';

// Dynamic import for the SDK (ESM)
const sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk');

// ── Configuration ───────────────────────────────────────────────────────────

const HELIUS_RPC = 'https://beta.helius-rpc.com/?api-key=60aa17ec-d160-4cd9-8a51-e74f693bc403';
const DEPLOYER_KEY_PATH = '/Users/raphaelcardona/mythic-l2/keys/deployer.json';
const SERVER_KEY_PATH = '/mnt/data/mythic-l2/keys/deployer.json';

const EXECUTE = process.argv.includes('--execute');

// SOL quote mint
const QUOTE_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ── Keypair Loading ─────────────────────────────────────────────────────────

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

let deployer;
try {
  deployer = loadKeypair(DEPLOYER_KEY_PATH);
} catch {
  deployer = loadKeypair(SERVER_KEY_PATH);
}

console.log('Deployer (feeClaimer):', deployer.publicKey.toBase58());
console.log('Mode:', EXECUTE ? 'EXECUTE ON MAINNET' : 'DRY RUN (pass --execute to send)');
console.log('');

// ── Build Curve Params ──────────────────────────────────────────────────────

// Use buildCurve helper to construct the full config with proper math
const curveParams = sdk.buildCurve({
  token: {
    tokenType: sdk.TokenType.SPL,
    tokenBaseDecimal: sdk.TokenDecimal.SIX,
    tokenQuoteDecimal: sdk.TokenDecimal.NINE, // SOL = 9 decimals
    tokenUpdateAuthority: sdk.TokenUpdateAuthorityOption.CreatorUpdateAuthority,
    totalTokenSupply: 1_000_000_000, // 1B tokens
    leftover: 0,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: sdk.BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: 100,    // 1% at launch (anti-snipe)
        endingFeeBps: 25,       // 0.25% steady state
        numberOfPeriod: 8,      // 8 decay periods
        totalDuration: 7200,    // 2 hours to reach ending fee
      },
    },
    dynamicFeeEnabled: false,
    collectFeeMode: sdk.CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: 50,  // 50% of trading fees to creator
    poolCreationFee: 0,               // Free pool creation
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: sdk.MigrationOption.MET_DAMM,  // DAMM v1 (SPL Token)
    migrationFeeOption: sdk.MigrationFeeOption.FixedBps25, // 0.25% migration fee (DAMM config option 0)
    migrationFee: {
      feePercentage: 1, // whole number required
      creatorFeePercentage: 0, // all migration fee to partner
    },
    migratedPoolFee: null,
  },
  liquidityDistribution: {
    partnerLiquidityPercentage: 70,                      // 70% unlocked LP for us
    partnerPermanentLockedLiquidityPercentage: 25,       // 25% locked LP (earns fees forever)
    creatorLiquidityPercentage: 5,                       // 5% unlocked for creator
    creatorPermanentLockedLiquidityPercentage: 0,        // 0% locked for creator
    partnerLiquidityVestingInfoParams: null,
    creatorLiquidityVestingInfoParams: null,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0,
    numberOfVestingPeriod: 0,
    cliffUnlockAmount: 0,
    totalVestingDuration: 0,
    cliffDurationFromMigrationTime: 0,
  },
  activationType: sdk.ActivationType.Timestamp,
  percentageSupplyOnMigration: 20,      // 20% of supply goes to LP on migration (pump.fun standard)
  migrationQuoteThreshold: 20,          // 20 SOL to graduate (human units)
});

console.log('=== Config Parameters (from buildCurve) ===');
console.log('  migrationOption:', curveParams.migrationOption, '(DAMM v1)');
console.log('  tokenType:', curveParams.tokenType, '(SPL)');
console.log('  tokenDecimal:', curveParams.tokenDecimal);
console.log('  activationType:', curveParams.activationType);
console.log('  collectFeeMode:', curveParams.collectFeeMode);
console.log('  creatorTradingFeePercentage:', curveParams.creatorTradingFeePercentage);
console.log('  migrationQuoteThreshold:', curveParams.migrationQuoteThreshold?.toString());
console.log('  sqrtStartPrice:', curveParams.sqrtStartPrice?.toString());
console.log('  partnerLiquidityPercentage:', curveParams.partnerLiquidityPercentage);
console.log('  partnerPermanentLockedLiquidityPercentage:', curveParams.partnerPermanentLockedLiquidityPercentage);
console.log('  creatorLiquidityPercentage:', curveParams.creatorLiquidityPercentage);
console.log('  creatorPermanentLockedLiquidityPercentage:', curveParams.creatorPermanentLockedLiquidityPercentage);
console.log('  poolCreationFee:', curveParams.poolCreationFee?.toString());
console.log('  curve points:', curveParams.curve?.length);
console.log('  poolFees.baseFee:', JSON.stringify(curveParams.poolFees?.baseFee, (k, v) =>
  typeof v === 'object' && v !== null && v.constructor?.name === 'BN' ? v.toString() : v
));
console.log('');

// ── Build Transaction ───────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(HELIUS_RPC, 'confirmed');

  // Generate a fresh keypair for the config account
  const configKeypair = Keypair.generate();
  console.log('Config Account (new):', configKeypair.publicKey.toBase58());
  console.log('feeClaimer:', deployer.publicKey.toBase58());
  console.log('leftoverReceiver:', deployer.publicKey.toBase58());
  console.log('quoteMint:', QUOTE_MINT.toBase58());
  console.log('');

  // Create PartnerService
  const partnerService = new sdk.PartnerService(connection, 'confirmed');

  // Build the createConfig transaction
  const tx = await partnerService.createConfig({
    ...curveParams,
    config: configKeypair.publicKey,
    feeClaimer: new PublicKey('6SrpJsrLHFAs6iPHFRNYmtEHUVnXyd1Q3iSqcVp8myth'),
    leftoverReceiver: new PublicKey('6SrpJsrLHFAs6iPHFRNYmtEHUVnXyd1Q3iSqcVp8myth'),
    quoteMint: QUOTE_MINT,
    payer: deployer.publicKey,
  });

  console.log('=== Transaction Built ===');
  console.log('  Instructions:', tx.instructions.length);
  console.log('  Config keypair saved — DO NOT LOSE this keypair if executing.');
  console.log('  Config pubkey:', configKeypair.publicKey.toBase58());
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN complete. Transaction NOT sent.');
    console.log('');
    console.log('To execute on Solana mainnet:');
    console.log('  node scripts/meteora-partner-setup.mjs --execute');
    console.log('');
    console.log('Config keypair (save this):');
    console.log(JSON.stringify(Array.from(configKeypair.secretKey)));
    return;
  }

  // Execute
  console.log('Sending transaction to Solana mainnet...');
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = deployer.publicKey;
  tx.sign(deployer, configKeypair);

  const rawTx = tx.serialize();
  const sig = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  console.log('  TX Signature:', sig);
  console.log('  Confirming...');

  await connection.confirmTransaction(sig, 'confirmed');
  console.log('  CONFIRMED');
  console.log('');
  console.log('=== MythicPad Partner Config Registered ===');
  console.log('  PoolConfig address:', configKeypair.publicKey.toBase58());
  console.log('  feeClaimer:', deployer.publicKey.toBase58());
  console.log('  Program: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
  console.log('');
  console.log('Save this config address — it is reusable for all future token launches.');

  // Save config keypair to file for backup (try server path first, fallback to local)
  const { writeFileSync, existsSync } = await import('fs');
  const savePath = existsSync('/mnt/data/mythic-l2/keys/')
    ? '/mnt/data/mythic-l2/keys/meteora-pool-config.json'
    : '/Users/raphaelcardona/mythic-l2/keys/meteora-pool-config.json';
  writeFileSync(savePath, JSON.stringify(Array.from(configKeypair.secretKey)));
  console.log(`Config keypair saved to ${savePath}`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  if (err.logs) console.error('Program logs:', err.logs);
  process.exit(1);
});
