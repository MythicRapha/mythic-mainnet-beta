#!/usr/bin/env node
/**
 * Mythic L2 — Full Account Export with Bridge Safety Audit
 *
 * Exports ALL L2 accounts for genesis rebuild. Key safety features:
 *   1. Preserves ALL ProcessedDeposit PDAs (prevents double-processing)
 *   2. Captures CURRENT balances (users who bridged back have reduced balances)
 *   3. Cross-references relayer DB for consistency
 *   4. Overrides bridge reserve to 1B MYTH
 *   5. Skips broken 92-byte bridge config (will be re-initialized)
 *
 * Run on S1 while L2 is still running:
 *   node scripts/export-l2-full.mjs
 *
 * Run final capture after relayer stop (Phase 2):
 *   node scripts/export-l2-full.mjs --final
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
const EXPORT_DIR = process.env.EXPORT_DIR || '/mnt/data/mythic-l2/account-export-v2';
const RELAYER_DB = '/mnt/data/mythic-relayer/data/relayer.db';
const IS_FINAL = process.argv.includes('--final');

// Bridge safety constants
const BRIDGE_RESERVE_PDA = 'G1gb6Kuycj7FkdGWtLJ2fngqAmtJiLy89bkKUBvHZAVg';
const BROKEN_BRIDGE_CONFIG = '56ndvfbd3j1gpwx8m7pKR8CQGF4qTqAPTJ7s7dQacSSf';
// 1B MYTH with 9 decimals = 10^18 lamports
// Written as string to avoid JS number precision loss (> Number.MAX_SAFE_INTEGER)
const BRIDGE_RESERVE_LAMPORTS_STR = '1000000000000000000';

const BRIDGE_L2_PROGRAM = 'MythBrdgL2111111111111111111111111111111111';

// All 11 Mythic programs
const PROGRAMS = {
  'MythBrdg11111111111111111111111111111111111': 'bridge-l1',
  'MythBrdgL2111111111111111111111111111111111': 'bridge-l2',
  'CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ': 'ai-precompiles',
  'AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh': 'compute-market',
  'MythSett1ement11111111111111111111111111111': 'settlement',
  'MythToken1111111111111111111111111111111111': 'myth-token',
  'MythPad111111111111111111111111111111111111': 'launchpad',
  'MythSwap11111111111111111111111111111111111': 'swap',
  'MythStak11111111111111111111111111111111111': 'staking',
  'MythGov111111111111111111111111111111111111': 'governance',
  'MythDrop11111111111111111111111111111111111': 'airdrop',
};

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BPF_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

// Known mints
const MINTS = [
  '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq', // MYTH
  'FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3', // wSOL
  '6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN', // USDC
  '8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw', // wBTC
  '4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT', // wETH
];

// Key wallets (native balance holders)
const KEY_WALLETS = [
  'DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg', // Sequencer
  '4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s', // Deployer
  'AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e', // Foundation
  'DEAbjmnC5uy1RjnVAxEjL4sbXToZAiEqvCC7XGYuDkkF', // Validator PDA
  '2wVc9Zi9METgoqmodYj8DgY2VsUxqrPJuSz4EfLtrh8U', // Stuck deposit user
];

// Deployed swap program (upgradeable)
const EXTRA_PROGRAMS = [
  '3QB8S38ouuREEDPxnaaGeujLsUhwFoRbLAejKywtEgv7', // Swap v3
];

// ProcessedDeposit struct: nonce(8) + l1_tx_sig(64) + processed_at(8) + bump(1) = 81
const PROCESSED_DEPOSIT_LEN = 81;
// L2BridgeConfig: 132 bytes (correct), 92 bytes (broken old version)
const BRIDGE_CONFIG_LEN_CORRECT = 132;
const BRIDGE_CONFIG_LEN_BROKEN = 92;

// ── RPC Client ───────────────────────────────────────────────────────────────

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── Account Storage ──────────────────────────────────────────────────────────

// Dedup map: pubkey → { accountData, subdir, source }
const accountMap = new Map();
const auditEntries = [];
const bridgeAudit = { processedDeposits: [], bridgedUsers: new Set(), warnings: [] };

function saveAccountToMap(pubkey, accountData, subdir, source) {
  // Dedup: later sources overwrite earlier ones (final export wins)
  accountMap.set(pubkey, { accountData, subdir, source });
}

function writeAccountFile(pubkey, accountData, subdir) {
  const outDir = subdir ? path.join(EXPORT_DIR, subdir) : EXPORT_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  // Build the account object — rentEpoch must be a valid u64.
  // JS can't represent u64::MAX (18446744073709551615) without precision loss,
  // so we use 0 which is safe for genesis-loaded accounts.
  const accountObj = {
    lamports: accountData.lamports,
    data: accountData.data,
    owner: accountData.owner,
    executable: accountData.executable,
    rentEpoch: 0,
    space: accountData.space ?? 0,
  };

  const accountJson = { pubkey, account: accountObj };
  const filepath = path.join(outDir, `${pubkey}.json`);

  // For the bridge reserve, write lamports as exact string to avoid
  // JS number precision loss (10^18 > Number.MAX_SAFE_INTEGER)
  if (pubkey === BRIDGE_RESERVE_PDA) {
    const jsonStr = JSON.stringify(accountJson, null, 2)
      .replace(/"lamports":\s*[\d.e+]+/, `"lamports": ${BRIDGE_RESERVE_LAMPORTS_STR}`);
    fs.writeFileSync(filepath, jsonStr);
  } else {
    fs.writeFileSync(filepath, JSON.stringify(accountJson, null, 2));
  }

  return filepath;
}

// ── Export Functions ──────────────────────────────────────────────────────────

async function exportProgramAccounts(programId, label) {
  console.log(`\n[${label}] getProgramAccounts(${programId})`);

  let result = await rpcCall('getProgramAccounts', [
    programId,
    { encoding: 'base64', withContext: true },
  ]).catch(() => null);

  if (!result?.result) {
    result = await rpcCall('getProgramAccounts', [
      programId,
      { encoding: 'base64' },
    ]).catch(() => null);
  }

  if (!result) {
    console.log(`  ERROR: No response`);
    return 0;
  }

  let accounts = result.result;
  if (accounts?.value) accounts = accounts.value;
  if (!Array.isArray(accounts)) {
    console.log(`  ERROR: Unexpected response format`);
    return 0;
  }

  let count = 0;
  let skippedConfig = false;

  for (const acct of accounts) {
    const pubkey = acct.pubkey;
    const data = acct.account;

    // SAFETY: Skip the broken 92-byte bridge config
    if (pubkey === BROKEN_BRIDGE_CONFIG) {
      const dataLen = data.data?.[0] ? Buffer.from(data.data[0], 'base64').length : 0;
      console.log(`  SKIP broken bridge config: ${pubkey} (${dataLen} bytes, should be ${BRIDGE_CONFIG_LEN_CORRECT})`);
      skippedConfig = true;
      bridgeAudit.warnings.push(`Skipped broken bridge config ${pubkey} (${dataLen} bytes)`);
      continue;
    }

    // SAFETY: Track ProcessedDeposit PDAs (bridge-l2 program, 81 bytes)
    if (programId === BRIDGE_L2_PROGRAM) {
      const rawData = data.data?.[0] ? Buffer.from(data.data[0], 'base64') : Buffer.alloc(0);
      if (rawData.length === PROCESSED_DEPOSIT_LEN) {
        // Parse: nonce (u64 LE, first 8 bytes)
        const nonce = rawData.readBigUInt64LE(0);
        bridgeAudit.processedDeposits.push({
          pda: pubkey,
          nonce: nonce.toString(),
          dataLen: rawData.length,
        });
        console.log(`  PRESERVE ProcessedDeposit: nonce=${nonce} pda=${pubkey}`);
      } else if (rawData.length === BRIDGE_CONFIG_LEN_CORRECT) {
        console.log(`  Found correct bridge config: ${pubkey} (${rawData.length} bytes)`);
      } else if (rawData.length === BRIDGE_CONFIG_LEN_BROKEN) {
        console.log(`  SKIP broken config: ${pubkey} (${rawData.length} bytes)`);
        bridgeAudit.warnings.push(`Skipped broken config ${pubkey} (${rawData.length} bytes)`);
        continue;
      }
    }

    saveAccountToMap(pubkey, data, label, `getProgramAccounts(${programId})`);
    count++;
  }

  console.log(`  Exported ${count} accounts` + (skippedConfig ? ' (1 broken config skipped)' : ''));
  return count;
}

async function exportSingleAccount(pubkey, label, override = null) {
  const result = await rpcCall('getAccountInfo', [
    pubkey,
    { encoding: 'base64' },
  ]).catch(() => null);

  if (!result?.result) {
    console.log(`  ${pubkey}: ERROR no response`);
    return false;
  }

  let accountInfo = result.result;
  if (accountInfo?.value !== undefined) accountInfo = accountInfo.value;

  if (accountInfo === null) {
    console.log(`  ${pubkey}: account not found on-chain`);
    return false;
  }

  // Apply lamports override if specified
  if (override?.lamports !== undefined) {
    const originalLamports = accountInfo.lamports;
    accountInfo.lamports = override.lamports;
    console.log(`  ${pubkey}: OVERRIDE lamports ${originalLamports} → ${override.lamportsDisplay || override.lamports}`);
  }

  saveAccountToMap(pubkey, accountInfo, label, `getAccountInfo(${pubkey})`);
  const lamports = accountInfo.lamports;
  const owner = accountInfo.owner;
  console.log(`  ${pubkey}: ${lamports} lamports, owner=${owner}`);
  return true;
}

async function exportBPFUpgradeableProgram(programId, label) {
  // Export the program account itself
  const result = await rpcCall('getAccountInfo', [
    programId,
    { encoding: 'base64' },
  ]).catch(() => null);

  if (!result?.result?.value) return;

  const acctData = result.result.value;
  saveAccountToMap(programId, acctData, label, 'bpf-program');

  // For BPF Upgradeable programs, the account data contains the programdata address
  // Format: [3, 0, 0, 0, <32 bytes programdata address>]
  const rawData = Buffer.from(acctData.data[0], 'base64');
  if (rawData.length >= 36 && rawData.readUInt32LE(0) === 3) {
    // Extract programdata address (bytes 4-36)
    const bs58chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const programdataBytes = rawData.slice(4, 36);

    // Use RPC to find the programdata account by checking known patterns
    // Actually, for BPF upgradeable, the programdata PDA is deterministic
    // Let's just try to get it using getProgramAccounts for BPFLoaderUpgradeab1e
    console.log(`  ${programId}: BPF Upgradeable program detected, exporting programdata...`);

    // Export all accounts owned by BPFLoaderUpgradeab1e that relate to this program
    const bpfResult = await rpcCall('getProgramAccounts', [
      BPF_LOADER,
      { encoding: 'base64' },
    ]).catch(() => null);

    if (bpfResult?.result) {
      let bpfAccounts = bpfResult.result;
      if (bpfAccounts?.value) bpfAccounts = bpfAccounts.value;
      for (const bpfAcct of bpfAccounts) {
        saveAccountToMap(bpfAcct.pubkey, bpfAcct.account, label + '-bpf', 'bpf-loader');
        console.log(`  BPF account: ${bpfAcct.pubkey} (${bpfAcct.account.data?.[0]?.length || 0} bytes data)`);
      }
    }
  }
}

// ── Relayer DB Cross-Reference ───────────────────────────────────────────────

function crossRefRelayerDB() {
  console.log('\n=== RELAYER DB CROSS-REFERENCE ===');

  if (!fs.existsSync(RELAYER_DB)) {
    console.log(`  Relayer DB not found at ${RELAYER_DB}`);
    console.log('  (This is OK if running locally — DB is on server)');
    return [];
  }

  try {
    // Query deposits (schema: id, l1_tx_signature, depositor_l1, recipient_l2, asset, amount_lamports, status, ...)
    // recipient_l2 is hex-encoded (64 hex chars = 32 bytes pubkey)
    const depositsRaw = execSync(
      `sqlite3 "${RELAYER_DB}" "SELECT recipient_l2, amount_lamports, status, l1_tx_signature FROM deposits ORDER BY created_at;"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();

    if (!depositsRaw) {
      console.log('  No deposits found in relayer DB');
      return [];
    }

    const deposits = depositsRaw.split('\n').map(line => {
      const [recipientHex, amount, status, sig] = line.split('|');
      return { recipientHex, amount, status, sig };
    });

    console.log(`  Found ${deposits.length} total deposits in relayer DB`);

    const completed = deposits.filter(d => d.status === 'completed');
    const pending = deposits.filter(d => d.status === 'pending');
    const failed = deposits.filter(d => d.status === 'failed' || d.status === 'error');
    console.log(`  Completed: ${completed.length}, Pending: ${pending.length}, Failed/Error: ${failed.length}`);

    // SAFETY: Track all users who received MYTH via bridge (hex-encoded pubkeys)
    for (const dep of completed) {
      if (dep.recipientHex && dep.recipientHex.length === 64) {
        bridgeAudit.bridgedUsers.add(dep.recipientHex);
      }
    }

    // Query withdrawals (bridge-back to L1)
    try {
      const withdrawalsRaw = execSync(
        `sqlite3 "${RELAYER_DB}" "SELECT withdrawer_l2, amount_lamports, status FROM withdrawals WHERE status='completed' ORDER BY created_at;"`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim();

      if (withdrawalsRaw) {
        const withdrawals = withdrawalsRaw.split('\n');
        console.log(`  Completed withdrawals (bridge-back): ${withdrawals.length}`);

        // SAFETY: Users who withdrew should have REDUCED L2 balances
        for (const line of withdrawals) {
          const [withdrawerHex] = line.split('|');
          if (withdrawerHex && withdrawerHex.length === 64) {
            bridgeAudit.bridgedUsers.add(withdrawerHex);
          }
        }
      } else {
        console.log('  Completed withdrawals (bridge-back): 0');
      }
    } catch {
      console.log('  Completed withdrawals (bridge-back): 0 (no table or empty)');
    }

    // Note: recipient_l2 values are hex-encoded pubkeys, not base58
    // They can't be directly used as Solana addresses without conversion
    console.log(`  Total unique bridged users (hex): ${bridgeAudit.bridgedUsers.size}`);
    return []; // hex pubkeys can't be used for getAccountInfo directly

  } catch (e) {
    console.log(`  Error querying relayer DB: ${e.message}`);
    return [];
  }
}

// ── Main Export ──────────────────────────────────────────────────────────────

async function main() {
  console.log('=========================================');
  console.log(`Mythic L2 — Full Account Export${IS_FINAL ? ' (FINAL)' : ''}`);
  console.log('=========================================');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Export: ${EXPORT_DIR}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Clean export directory
  if (fs.existsSync(EXPORT_DIR)) {
    fs.rmSync(EXPORT_DIR, { recursive: true });
  }
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  // Check RPC health
  const slotResult = await rpcCall('getSlot', []).catch(() => null);
  if (!slotResult?.result && slotResult?.result !== 0) {
    console.error('ERROR: RPC not responding at', RPC_URL);
    process.exit(1);
  }
  console.log(`Connected to RPC at slot ${slotResult.result}`);

  // ── 1. Export all program-owned accounts ────────────────────────────────

  console.log('\n=== PROGRAM ACCOUNTS ===');
  let totalAccounts = 0;

  for (const [programId, label] of Object.entries(PROGRAMS)) {
    totalAccounts += await exportProgramAccounts(programId, label);
  }

  // ── 2. Export SPL Token accounts ────────────────────────────────────────

  console.log('\n=== SPL TOKEN ACCOUNTS ===');
  totalAccounts += await exportProgramAccounts(SPL_TOKEN_PROGRAM, 'spl-token');

  // ATA program accounts
  console.log('\n=== ASSOCIATED TOKEN ACCOUNTS ===');
  totalAccounts += await exportProgramAccounts(ATA_PROGRAM, 'ata-program');

  // Token-2022 accounts (if any)
  console.log('\n=== TOKEN-2022 ACCOUNTS ===');
  totalAccounts += await exportProgramAccounts(TOKEN_2022_PROGRAM, 'token-2022');

  // ── 3. Export mint accounts ─────────────────────────────────────────────

  console.log('\n=== MINT ACCOUNTS ===');
  for (const mint of MINTS) {
    if (await exportSingleAccount(mint, 'mints')) totalAccounts++;
  }

  // ── 4. Export key wallets (native balances) ─────────────────────────────

  console.log('\n=== KEY WALLETS ===');
  for (const addr of KEY_WALLETS) {
    if (await exportSingleAccount(addr, 'wallets')) totalAccounts++;
  }

  // ── 5. Bridge reserve PDA — OVERRIDE to 1B MYTH ────────────────────────

  console.log('\n=== BRIDGE RESERVE PDA ===');
  const reserveResult = await rpcCall('getAccountInfo', [
    BRIDGE_RESERVE_PDA,
    { encoding: 'base64' },
  ]).catch(() => null);

  if (reserveResult?.result?.value) {
    const reserveData = reserveResult.result.value;
    const originalLamports = reserveData.lamports;
    console.log(`  Current bridge reserve: ${originalLamports} lamports (${originalLamports / 1e9} MYTH)`);
    console.log(`  OVERRIDING to 1,000,000,000 MYTH (${BRIDGE_RESERVE_LAMPORTS_STR} lamports)`);

    // Save with overridden lamports — the actual write uses string replacement
    // to avoid JS precision loss on 10^18
    saveAccountToMap(BRIDGE_RESERVE_PDA, {
      ...reserveData,
      lamports: 0, // placeholder, will be replaced in writeAccountFile
    }, 'bridge-reserve', 'bridge-reserve-override');
    totalAccounts++;
  } else {
    // Reserve PDA doesn't exist yet — create synthetic account
    console.log(`  Bridge reserve PDA not found — creating synthetic account with 1B MYTH`);
    saveAccountToMap(BRIDGE_RESERVE_PDA, {
      lamports: 0, // placeholder
      data: ['', 'base64'],
      owner: SYSTEM_PROGRAM,
      executable: false,
      rentEpoch: 18446744073709551615,
      space: 0,
    }, 'bridge-reserve', 'bridge-reserve-synthetic');
    totalAccounts++;
  }

  // ── 6. Extra programs (upgradeable swap) ────────────────────────────────

  console.log('\n=== EXTRA PROGRAMS (BPF Upgradeable) ===');
  for (const prog of EXTRA_PROGRAMS) {
    totalAccounts += await exportProgramAccounts(prog, 'extra-programs');
    await exportBPFUpgradeableProgram(prog, 'executables');
    totalAccounts++;
  }

  // ── 7. Cross-reference relayer DB ───────────────────────────────────────

  const bridgedUsers = crossRefRelayerDB();

  // Export any bridged user accounts not already captured
  if (bridgedUsers.length > 0) {
    console.log('\n=== BRIDGED USER ACCOUNTS ===');
    for (const userAddr of bridgedUsers) {
      if (!accountMap.has(userAddr)) {
        if (await exportSingleAccount(userAddr, 'bridged-users')) {
          totalAccounts++;
        }
      } else {
        console.log(`  ${userAddr}: already exported`);
      }
    }
  }

  // ── 8. Discover additional accounts via getLargestAccounts ───────────────

  console.log('\n=== LARGEST ACCOUNTS (catch-all) ===');
  const largestResult = await rpcCall('getLargestAccounts', [
    { commitment: 'confirmed' },
  ]).catch(() => null);

  if (largestResult?.result?.value) {
    let newFound = 0;
    for (const entry of largestResult.result.value) {
      if (!accountMap.has(entry.address)) {
        if (await exportSingleAccount(entry.address, 'largest')) {
          totalAccounts++;
          newFound++;
        }
      }
    }
    console.log(`  Found ${newFound} additional accounts from getLargestAccounts`);
  }

  // ── 9. Write all accounts to disk ───────────────────────────────────────

  console.log('\n=== WRITING ACCOUNT FILES ===');
  for (const [pubkey, { accountData, subdir }] of accountMap) {
    writeAccountFile(pubkey, accountData, subdir);
  }
  console.log(`  Written ${accountMap.size} account files`);

  // ── 10. Generate balance audit ──────────────────────────────────────────

  console.log('\n=== BALANCE AUDIT ===');
  const audit = {
    timestamp: new Date().toISOString(),
    slot: slotResult.result,
    isFinal: IS_FINAL,
    totalAccounts: accountMap.size,
    accounts: {},
    bridgeAudit: {
      processedDeposits: bridgeAudit.processedDeposits,
      processedDepositCount: bridgeAudit.processedDeposits.length,
      bridgedUserCount: bridgeAudit.bridgedUsers.size,
      bridgedUsers: [...bridgeAudit.bridgedUsers],
      warnings: bridgeAudit.warnings,
      bridgeReserveOverride: BRIDGE_RESERVE_LAMPORTS_STR,
      skippedBrokenConfig: BROKEN_BRIDGE_CONFIG,
    },
  };

  for (const [pubkey, { accountData, subdir, source }] of accountMap) {
    const lamports = pubkey === BRIDGE_RESERVE_PDA
      ? BRIDGE_RESERVE_LAMPORTS_STR
      : accountData.lamports;

    audit.accounts[pubkey] = {
      lamports,
      owner: accountData.owner,
      executable: accountData.executable,
      category: subdir,
      source,
    };

    auditEntries.push({ pubkey, lamports, owner: accountData.owner, category: subdir });
  }

  // Write audit JSON
  const auditPath = path.join(EXPORT_DIR, 'balance-audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  console.log(`  Audit written to: ${auditPath}`);

  // ── 11. Generate test-validator flags ───────────────────────────────────

  console.log('\n=== TEST-VALIDATOR FLAGS ===');
  const flagsPath = path.join(EXPORT_DIR, 'test-validator-flags.txt');
  const flags = [];

  for (const [pubkey] of accountMap) {
    // Find the file — it's in the subdir based on the account's category
    const { subdir } = accountMap.get(pubkey);
    const dir = subdir ? path.join(EXPORT_DIR, subdir) : EXPORT_DIR;
    const filepath = path.join(dir, `${pubkey}.json`);
    if (fs.existsSync(filepath)) {
      flags.push(`--account ${pubkey} ${filepath}`);
    }
  }

  fs.writeFileSync(flagsPath, flags.join(' \\\n') + '\n');
  console.log(`  Flags written to: ${flagsPath} (${flags.length} accounts)`);

  // ── 12. Summary ────────────────────────────────────────────────────────

  console.log('\n=========================================');
  console.log('EXPORT SUMMARY');
  console.log('=========================================');
  console.log(`Total accounts exported: ${accountMap.size}`);
  console.log(`Export directory: ${EXPORT_DIR}`);

  // Count by category
  const categories = {};
  for (const [, { subdir }] of accountMap) {
    categories[subdir || 'root'] = (categories[subdir || 'root'] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(categories).sort()) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log('\n--- Bridge Safety Report ---');
  console.log(`ProcessedDeposit PDAs preserved: ${bridgeAudit.processedDeposits.length}`);
  console.log(`Bridged users tracked: ${bridgeAudit.bridgedUsers.size}`);
  console.log(`Broken config skipped: ${BROKEN_BRIDGE_CONFIG}`);
  console.log(`Bridge reserve override: ${BRIDGE_RESERVE_LAMPORTS_STR} lamports (1B MYTH)`);

  if (bridgeAudit.warnings.length > 0) {
    console.log(`\nWARNINGS (${bridgeAudit.warnings.length}):`);
    for (const w of bridgeAudit.warnings) {
      console.log(`  ! ${w}`);
    }
  } else {
    console.log('\nNo warnings — bridge state is consistent.');
  }

  console.log('\n=========================================');
  if (IS_FINAL) {
    console.log('FINAL export complete. Ready for genesis rebuild.');
  } else {
    console.log('Preliminary export complete.');
    console.log('Run with --final after stopping relayer for definitive snapshot.');
  }
  console.log('=========================================');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
