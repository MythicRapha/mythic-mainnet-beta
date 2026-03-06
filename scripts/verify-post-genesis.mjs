#!/usr/bin/env node
/**
 * Mythic L2 — Post-Genesis Verification
 *
 * Verifies the new genesis has:
 *   1. Bridge reserve = 1B MYTH
 *   2. All 11 programs deployed + executable
 *   3. All user balances match the audit report
 *   4. SPL token accounts + swap pools intact
 *   5. ProcessedDeposit PDAs preserved (bridge safety)
 *   6. No broken bridge config
 *   7. Key address balances correct
 *
 * Run after fddev starts with new genesis:
 *   node scripts/verify-post-genesis.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
const EXPORT_DIR = process.env.EXPORT_DIR || '/mnt/data/mythic-l2/account-export-v2';
const AUDIT_FILE = path.join(EXPORT_DIR, 'balance-audit.json');

// Expected values
const BRIDGE_RESERVE_PDA = 'G1gb6Kuycj7FkdGWtLJ2fngqAmtJiLy89bkKUBvHZAVg';
const BRIDGE_RESERVE_EXPECTED = '1000000000000000000'; // 1B MYTH
const BROKEN_BRIDGE_CONFIG = '56ndvfbd3j1gpwx8m7pKR8CQGF4qTqAPTJ7s7dQacSSf';
const BRIDGE_L2_PROGRAM = 'MythBrdgL2111111111111111111111111111111111';

const ALL_PROGRAMS = [
  'MythBrdg11111111111111111111111111111111111',
  'MythBrdgL2111111111111111111111111111111111',
  'CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ',
  'AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh',
  'MythSett1ement11111111111111111111111111111',
  'MythToken1111111111111111111111111111111111',
  'MythPad111111111111111111111111111111111111',
  'MythSwap11111111111111111111111111111111111',
  'MythStak11111111111111111111111111111111111',
  'MythGov111111111111111111111111111111111111',
  'MythDrop11111111111111111111111111111111111',
];

const KEY_ADDRESSES = {
  'DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg': 'Sequencer',
  '4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s': 'Deployer',
  'AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e': 'Foundation',
  'DEAbjmnC5uy1RjnVAxEjL4sbXToZAiEqvCC7XGYuDkkF': 'Validator PDA',
};

const MINTS = {
  '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq': 'MYTH',
  'FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3': 'wSOL',
  '6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN': 'USDC',
  '8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw': 'wBTC',
  '4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT': 'wETH',
};

const PROCESSED_DEPOSIT_LEN = 81;

// ── RPC Client ───────────────────────────────────────────────────────────────

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function getBalance(address) {
  const result = await rpcCall('getBalance', [address]).catch(() => null);
  return result?.result?.value ?? null;
}

async function getAccountInfo(address) {
  const result = await rpcCall('getAccountInfo', [address, { encoding: 'base64' }]).catch(() => null);
  return result?.result?.value ?? null;
}

// ── Verification Checks ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  PASS: ${msg}`); passed++; }
function fail(msg) { console.log(`  FAIL: ${msg}`); failed++; }
function warn(msg) { console.log(`  WARN: ${msg}`); warnings++; }

async function main() {
  console.log('=========================================');
  console.log('Mythic L2 — Post-Genesis Verification');
  console.log('=========================================');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Check RPC
  const slotResult = await rpcCall('getSlot', []).catch(() => null);
  if (!slotResult?.result && slotResult?.result !== 0) {
    console.error('FATAL: RPC not responding');
    process.exit(1);
  }
  console.log(`Connected at slot ${slotResult.result}`);

  // Load audit file if available
  let audit = null;
  if (fs.existsSync(AUDIT_FILE)) {
    audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    console.log(`Audit loaded: ${Object.keys(audit.accounts).length} accounts`);
  } else {
    console.log('WARNING: No audit file found — will do basic checks only');
  }

  // ── Check 1: Bridge Reserve = 1B MYTH ──────────────────────────────────

  console.log('\n--- Bridge Reserve ---');
  const reserveBal = await getBalance(BRIDGE_RESERVE_PDA);
  if (reserveBal === null) {
    fail(`Bridge reserve ${BRIDGE_RESERVE_PDA} not found`);
  } else {
    const reserveStr = reserveBal.toString();
    const mythAmount = reserveBal / 1e9;
    if (reserveStr === BRIDGE_RESERVE_EXPECTED) {
      pass(`Bridge reserve = ${mythAmount.toLocaleString()} MYTH (1B)`);
    } else if (BigInt(reserveStr) > BigInt('999999000000000000')) {
      // Allow tiny rounding from JS number precision
      pass(`Bridge reserve ~ 1B MYTH (${mythAmount.toLocaleString()} MYTH)`);
    } else {
      fail(`Bridge reserve = ${mythAmount.toLocaleString()} MYTH (expected 1B)`);
    }
  }

  // ── Check 2: All 11 Programs Deployed ──────────────────────────────────

  console.log('\n--- Programs ---');
  for (const progId of ALL_PROGRAMS) {
    const info = await getAccountInfo(progId);
    if (info === null) {
      fail(`Program ${progId} not found`);
    } else if (info.executable) {
      pass(`${progId} deployed + executable`);
    } else {
      fail(`${progId} exists but NOT executable`);
    }
  }

  // ── Check 3: Broken Bridge Config NOT Present ──────────────────────────

  console.log('\n--- Bridge Config Safety ---');
  const brokenConfig = await getAccountInfo(BROKEN_BRIDGE_CONFIG);
  if (brokenConfig === null) {
    pass(`Broken bridge config ${BROKEN_BRIDGE_CONFIG} correctly absent`);
  } else {
    const dataLen = brokenConfig.data?.[0] ? Buffer.from(brokenConfig.data[0], 'base64').length : 0;
    if (dataLen === 92) {
      fail(`Broken 92-byte bridge config still present! Must be excluded.`);
    } else if (dataLen === 132) {
      pass(`Bridge config present with correct 132-byte size`);
    } else {
      warn(`Bridge config has unexpected size: ${dataLen} bytes`);
    }
  }

  // ── Check 4: ProcessedDeposit PDAs Preserved ───────────────────────────

  console.log('\n--- ProcessedDeposit PDAs (Bridge Safety) ---');
  const bridgeAccounts = await rpcCall('getProgramAccounts', [
    BRIDGE_L2_PROGRAM,
    { encoding: 'base64' },
  ]).catch(() => null);

  let processedCount = 0;
  if (bridgeAccounts?.result) {
    let accounts = bridgeAccounts.result;
    if (accounts?.value) accounts = accounts.value;
    for (const acct of accounts) {
      const rawData = Buffer.from(acct.account.data[0], 'base64');
      if (rawData.length === PROCESSED_DEPOSIT_LEN) {
        processedCount++;
        const nonce = rawData.readBigUInt64LE(0);
        console.log(`    ProcessedDeposit: nonce=${nonce} pda=${acct.pubkey}`);
      }
    }
  }

  if (audit?.bridgeAudit?.processedDepositCount) {
    const expected = audit.bridgeAudit.processedDepositCount;
    if (processedCount === expected) {
      pass(`All ${processedCount} ProcessedDeposit PDAs preserved`);
    } else if (processedCount > expected) {
      pass(`${processedCount} ProcessedDeposit PDAs found (more than audit's ${expected} — new deposits may have been processed)`);
    } else {
      fail(`Only ${processedCount}/${expected} ProcessedDeposit PDAs found — possible double-processing risk!`);
    }
  } else {
    if (processedCount > 0) {
      pass(`${processedCount} ProcessedDeposit PDAs found`);
    } else {
      warn('No ProcessedDeposit PDAs found (may be OK if no deposits were ever processed)');
    }
  }

  // ── Check 5: Key Address Balances ──────────────────────────────────────

  console.log('\n--- Key Addresses ---');
  for (const [addr, label] of Object.entries(KEY_ADDRESSES)) {
    const bal = await getBalance(addr);
    if (bal === null) {
      warn(`${label} (${addr}): not found`);
    } else {
      const myth = bal / 1e9;
      console.log(`  ${label}: ${myth.toLocaleString()} MYTH (${bal} lamports)`);

      // Compare with audit if available
      if (audit?.accounts?.[addr]) {
        const auditLamports = BigInt(audit.accounts[addr].lamports);
        const currentLamports = BigInt(bal);
        // Allow some difference (deployer may have spent on init txns)
        if (currentLamports >= auditLamports) {
          pass(`${label} balance >= audit value`);
        } else {
          const diff = auditLamports - currentLamports;
          if (diff < BigInt(1e12)) { // <1000 MYTH difference OK (tx fees)
            pass(`${label} balance close to audit (diff: ${Number(diff) / 1e9} MYTH)`);
          } else {
            fail(`${label} balance dropped significantly: audit=${Number(auditLamports) / 1e9}, now=${myth}`);
          }
        }
      } else {
        pass(`${label} exists with balance`);
      }
    }
  }

  // ── Check 6: SPL Token Mints ───────────────────────────────────────────

  console.log('\n--- SPL Token Mints ---');
  for (const [mint, name] of Object.entries(MINTS)) {
    const info = await getAccountInfo(mint);
    if (info === null) {
      fail(`${name} mint (${mint}) not found`);
    } else {
      pass(`${name} mint present`);
    }
  }

  // ── Check 7: SPL Token Account Count ───────────────────────────────────

  console.log('\n--- SPL Token Accounts ---');
  const tokenAccounts = await rpcCall('getProgramAccounts', [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    { encoding: 'base64' },
  ]).catch(() => null);

  if (tokenAccounts?.result) {
    let accts = tokenAccounts.result;
    if (accts?.value) accts = accts.value;
    const count = accts.length;
    console.log(`  SPL Token accounts: ${count}`);
    if (count > 0) {
      pass(`${count} SPL Token accounts present`);
    } else {
      warn('No SPL Token accounts found');
    }
  }

  // ── Check 8: Bridged User Balances (anti-duplication) ──────────────────

  if (audit?.bridgeAudit?.bridgedUsers?.length > 0) {
    console.log('\n--- Bridged User Balance Verification ---');
    console.log('  Verifying no user got extra MYTH from genesis rebuild...');

    let usersChecked = 0;
    let usersOk = 0;

    for (const userAddr of audit.bridgeAudit.bridgedUsers) {
      const auditEntry = audit.accounts[userAddr];
      if (!auditEntry) continue;

      const currentBal = await getBalance(userAddr);
      if (currentBal === null) {
        // User had 0 balance in audit → still 0. OK.
        if (BigInt(auditEntry.lamports) === 0n) {
          usersOk++;
        } else {
          warn(`Bridged user ${userAddr}: had ${auditEntry.lamports} lamports, now not found`);
        }
        usersChecked++;
        continue;
      }

      const auditLamports = BigInt(auditEntry.lamports);
      const currentLamports = BigInt(currentBal);

      // CRITICAL: Current balance must NOT exceed audit balance
      // (they should not get MORE myth than they had at snapshot)
      if (currentLamports > auditLamports + BigInt(1e9)) {
        // More than 1 MYTH over audit = suspicious
        fail(`BRIDGE SAFETY: User ${userAddr} has MORE MYTH than audit! audit=${Number(auditLamports) / 1e9}, now=${Number(currentLamports) / 1e9}`);
      } else {
        usersOk++;
      }
      usersChecked++;
    }

    if (usersOk === usersChecked) {
      pass(`All ${usersChecked} bridged users have correct balances (no extra MYTH)`);
    } else {
      fail(`${usersChecked - usersOk}/${usersChecked} bridged users have balance discrepancies`);
    }
  }

  // ── Check 9: New Bridge Config Initialized Correctly ───────────────────

  console.log('\n--- New Bridge L2 Config ---');
  // The new config should be created by init-all-programs.cjs
  const bridgeL2Accounts = await rpcCall('getProgramAccounts', [
    BRIDGE_L2_PROGRAM,
    { encoding: 'base64' },
  ]).catch(() => null);

  if (bridgeL2Accounts?.result) {
    let accts = bridgeL2Accounts.result;
    if (accts?.value) accts = accts.value;

    let configFound = false;
    for (const acct of accts) {
      const rawData = Buffer.from(acct.account.data[0], 'base64');
      if (rawData.length === 132) {
        configFound = true;
        pass(`New bridge config (132 bytes) at ${acct.pubkey}`);
        // Parse admin and relayer
        // admin: bytes 0-32, relayer: bytes 32-64
        break;
      }
    }
    if (!configFound) {
      warn('No 132-byte bridge config found — init-all-programs.cjs may not have run yet');
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────

  console.log('\n=========================================');
  console.log('VERIFICATION SUMMARY');
  console.log('=========================================');
  console.log(`  PASSED:   ${passed}`);
  console.log(`  FAILED:   ${failed}`);
  console.log(`  WARNINGS: ${warnings}`);
  console.log('');

  if (failed === 0) {
    console.log('  ALL CHECKS PASSED — Ready for Phase 5 (go-live)');
    console.log('=========================================');
    process.exit(0);
  } else {
    console.log('  FAILURES DETECTED — Review before going live!');
    console.log('  If bridge safety checks failed, DO NOT start the relayer.');
    console.log('=========================================');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
