#!/usr/bin/env node
// MythicPad L1 Launchpad Indexer + API
// Monitors Meteora DBC events on Solana L1, stores in SQLite, serves via Express + WebSocket
// PM2: pm2 start scripts/l1-launchpad-indexer.mjs --name mythicpad-indexer

import { Connection, PublicKey } from '@solana/web3.js';
import Database from 'better-sqlite3';
import express from 'express';
import ws from 'ws';
const WebSocketServer = ws.Server;
import { createServer } from 'http';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

const HELIUS_RPC = process.env.HELIUS_RPC || 'https://beta.helius-rpc.com/?api-key=60aa17ec-d160-4cd9-8a51-e74f693bc403';
const HELIUS_WS = HELIUS_RPC.replace('https://', 'wss://').replace('http://', 'ws://');
const API_PORT = parseInt(process.env.INDEXER_PORT || '4003', 10);
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'launchpad.db');

const METEORA_DBC_PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// MythicPad config account — monitor ONLY our launchpad's transactions
const MYTHICPAD_CONFIG = new PublicKey('3qmRYAJycnRJEVtinC687CXbqTBZTUkPCcsNQzwUhx7K');

// Graduation threshold in SOL (matches MythicPad partner config: 20 SOL)
const GRADUATION_THRESHOLD_SOL = 20;

// Known tokens that should NEVER be indexed as launchpad tokens
const EXCLUDED_MINTS = new Set([
  SOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'So11111111111111111111111111111111111111112',      // Wrapped SOL
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',   // JUP
  '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump',  // MYTH L1
]);

// Polling interval for getSignaturesForAddress fallback (ms)
const POLL_INTERVAL = 15_000;

// On-chain sync runs every N poll cycles (quoteReserve reads)
const SYNC_EVERY_N_POLLS = 3;
let pollCycleCount = 0;

// ═══════════════════════════════════════════════════════════════
// Database Setup
// ═══════════════════════════════════════════════════════════════

function initDatabase() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      mint TEXT PRIMARY KEY,
      name TEXT,
      symbol TEXT,
      uri TEXT,
      image_url TEXT,
      creator TEXT,
      pool_address TEXT,
      config_address TEXT,
      created_at INTEGER,
      status TEXT DEFAULT 'active',
      sol_raised REAL DEFAULT 0,
      graduation_threshold REAL DEFAULT ${GRADUATION_THRESHOLD_SOL},
      l1_damm_pool TEXT,
      l2_pool_address TEXT,
      l2_mint TEXT,
      migrated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT,
      tx_sig TEXT UNIQUE,
      type TEXT,
      sol_amount REAL,
      token_amount REAL,
      price REAL,
      trader TEXT,
      timestamp INTEGER,
      FOREIGN KEY (mint) REFERENCES tokens(mint)
    );

    CREATE TABLE IF NOT EXISTS holders (
      mint TEXT,
      wallet TEXT,
      balance REAL,
      l2_airdropped INTEGER DEFAULT 0,
      PRIMARY KEY (mint, wallet)
    );

    CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(mint);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_mint_ts ON trades(mint, timestamp);
    CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
    CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at);
    CREATE INDEX IF NOT EXISTS idx_holders_mint ON holders(mint);
  `);

  return db;
}

// ═══════════════════════════════════════════════════════════════
// Prepared Statements
// ═══════════════════════════════════════════════════════════════

let stmts;

function prepareStatements(db) {
  stmts = {
    upsertToken: db.prepare(`
      INSERT INTO tokens (mint, name, symbol, uri, image_url, creator, pool_address, config_address, created_at, status, sol_raised, graduation_threshold)
      VALUES (@mint, @name, @symbol, @uri, @image_url, @creator, @pool_address, @config_address, @created_at, 'active', 0, ${GRADUATION_THRESHOLD_SOL})
      ON CONFLICT(mint) DO UPDATE SET
        name = COALESCE(@name, tokens.name),
        symbol = COALESCE(@symbol, tokens.symbol),
        uri = COALESCE(@uri, tokens.uri),
        image_url = COALESCE(@image_url, tokens.image_url),
        pool_address = COALESCE(@pool_address, tokens.pool_address),
        config_address = COALESCE(@config_address, tokens.config_address)
    `),

    insertTrade: db.prepare(`
      INSERT OR IGNORE INTO trades (mint, tx_sig, type, sol_amount, token_amount, price, trader, timestamp)
      VALUES (@mint, @tx_sig, @type, @sol_amount, @token_amount, @price, @trader, @timestamp)
    `),

    updateSolRaised: db.prepare(`
      UPDATE tokens SET sol_raised = (
        SELECT COALESCE(SUM(CASE WHEN type = 'buy' THEN sol_amount ELSE -sol_amount END), 0)
        FROM trades WHERE mint = @mint
      ) WHERE mint = @mint
    `),

    graduateToken: db.prepare(`
      UPDATE tokens SET status = 'graduated', l1_damm_pool = @l1_damm_pool WHERE mint = @mint
    `),

    migrateToken: db.prepare(`
      UPDATE tokens SET status = 'migrated', l2_pool_address = @l2_pool_address, l2_mint = @l2_mint, migrated_at = @migrated_at
      WHERE mint = @mint
    `),

    upsertHolder: db.prepare(`
      INSERT INTO holders (mint, wallet, balance)
      VALUES (@mint, @wallet, @balance)
      ON CONFLICT(mint, wallet) DO UPDATE SET balance = MAX(0, holders.balance + @balance)
    `),

    getToken: db.prepare('SELECT * FROM tokens WHERE mint = ?'),
    getTokens: db.prepare('SELECT * FROM tokens WHERE status = ? ORDER BY created_at DESC'),
    getAllTokens: db.prepare('SELECT * FROM tokens ORDER BY created_at DESC'),
    getGraduated: db.prepare("SELECT * FROM tokens WHERE status IN ('graduated', 'migrated') ORDER BY created_at DESC LIMIT ?"),

    getTrades: db.prepare('SELECT * FROM trades WHERE mint = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'),
    getTradeCount: db.prepare('SELECT COUNT(*) as count FROM trades WHERE mint = ?'),

    getHolders: db.prepare('SELECT * FROM holders WHERE mint = ? ORDER BY balance DESC'),

    getTrending: db.prepare(`
      SELECT t.*, COALESCE(s.vol24h, 0) as volume_24h, COALESCE(s.trades24h, 0) as trades_24h
      FROM tokens t
      LEFT JOIN (
        SELECT mint, SUM(sol_amount) as vol24h, COUNT(*) as trades24h
        FROM trades
        WHERE timestamp > ?
        GROUP BY mint
      ) s ON t.mint = s.mint
      WHERE t.status = 'active'
      ORDER BY vol24h DESC
      LIMIT ?
    `),

    getGlobalStats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tokens) as total_tokens,
        (SELECT COUNT(*) FROM tokens WHERE status = 'active') as active_tokens,
        (SELECT COUNT(*) FROM tokens WHERE status = 'graduated') as graduated_tokens,
        (SELECT COUNT(*) FROM tokens WHERE status = 'migrated') as migrated_tokens,
        (SELECT COALESCE(SUM(sol_raised), 0) FROM tokens) as total_sol_raised,
        (SELECT COUNT(*) FROM trades) as total_trades,
        (SELECT COALESCE(SUM(sol_amount), 0) FROM trades) as total_volume
    `),

    getCandles: db.prepare(`
      SELECT
        (timestamp / @interval) * @interval as time,
        MIN(price) as low,
        MAX(price) as high,
        (SELECT price FROM trades t2 WHERE t2.mint = trades.mint AND (t2.timestamp / @interval) = (trades.timestamp / @interval) ORDER BY t2.timestamp ASC LIMIT 1) as open,
        (SELECT price FROM trades t2 WHERE t2.mint = trades.mint AND (t2.timestamp / @interval) = (trades.timestamp / @interval) ORDER BY t2.timestamp DESC LIMIT 1) as close,
        SUM(sol_amount) as volume,
        COUNT(*) as trade_count
      FROM trades
      WHERE mint = @mint AND timestamp >= @since
      GROUP BY (timestamp / @interval)
      ORDER BY time ASC
    `),

    getLatestSig: db.prepare('SELECT tx_sig FROM trades ORDER BY timestamp DESC LIMIT 1'),
  };
}

// ═══════════════════════════════════════════════════════════════
// Meteora DBC Log Parsing
// ═══════════════════════════════════════════════════════════════

// Meteora DBC uses Anchor-style event logs with base64 data.
// We parse log messages to identify event types.

function parseTransactionLogs(logs, signature, slot, blockTime) {
  const events = [];

  // Look for Meteora DBC program invocations
  let inDBC = false;
  for (const log of logs) {
    if (log.includes(METEORA_DBC_PROGRAM.toBase58())) {
      inDBC = true;
    }

    // Pool initialization (initializeVirtualPool)
    if (inDBC && log.includes('Instruction: InitializeVirtualPool')) {
      events.push({ type: 'pool_created', signature, slot, blockTime });
    }

    // Swap/trade events
    if (inDBC && log.includes('Instruction: Swap')) {
      events.push({ type: 'swap', signature, slot, blockTime });
    }
    if (inDBC && log.includes('Instruction: Buy')) {
      events.push({ type: 'buy', signature, slot, blockTime });
    }
    if (inDBC && log.includes('Instruction: Sell')) {
      events.push({ type: 'sell', signature, slot, blockTime });
    }

    // Graduation (migration to DAMM)
    if (inDBC && log.includes('Instruction: MigrateMeteoraDamm')) {
      events.push({ type: 'graduated', signature, slot, blockTime });
    }
    if (inDBC && log.includes('Instruction: MigrateMeteoraDAMM')) {
      events.push({ type: 'graduated', signature, slot, blockTime });
    }

    // Program return resets context
    if (log.includes('Program return:') || log.includes('success')) {
      // keep going, don't reset inDBC too aggressively
    }
  }

  return events;
}

// ═══════════════════════════════════════════════════════════════
// Transaction Parser — extract accounts + amounts from tx data
// ═══════════════════════════════════════════════════════════════

async function parseTransaction(conn, signature) {
  try {
    const tx = await conn.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return null;

    const meta = tx.meta;
    const msg = tx.transaction.message;

    // Get account keys (handle both legacy and v0)
    let accountKeys;
    if (msg.getAccountKeys) {
      const keys = msg.getAccountKeys({ accountKeysFromLookups: meta?.loadedAddresses });
      accountKeys = keys.staticAccountKeys?.map(k => k.toBase58()) || [];
      if (keys.accountKeysFromLookups) {
        const writable = keys.accountKeysFromLookups.writable?.map(k => k.toBase58()) || [];
        const readonly = keys.accountKeysFromLookups.readonly?.map(k => k.toBase58()) || [];
        accountKeys = [...accountKeys, ...writable, ...readonly];
      }
    } else if (msg.accountKeys) {
      accountKeys = msg.accountKeys.map(k => k.toBase58());
    } else {
      accountKeys = msg.staticAccountKeys?.map(k => k.toBase58()) || [];
      if (meta?.loadedAddresses) {
        accountKeys = [
          ...accountKeys,
          ...(meta.loadedAddresses.writable || []).map(k => typeof k === 'string' ? k : k.toBase58()),
          ...(meta.loadedAddresses.readonly || []).map(k => typeof k === 'string' ? k : k.toBase58()),
        ];
      }
    }

    const logs = meta?.logMessages || [];
    const blockTime = tx.blockTime || Math.floor(Date.now() / 1000);

    // Parse pre/post token balances to determine trade details
    const preTokenBalances = meta?.preTokenBalances || [];
    const postTokenBalances = meta?.postTokenBalances || [];

    // Find SOL balance changes
    const preBalances = meta?.preBalances || [];
    const postBalances = meta?.postBalances || [];

    // Signer is the trader
    const trader = accountKeys[0] || 'unknown';

    // Find DBC instruction account indices to identify which tokens are from our launchpad
    const dbcProgramId = METEORA_DBC_PROGRAM.toBase58();
    const dbcAccountIndices = new Set();
    const compiledIxs = msg.compiledInstructions || msg.instructions || [];
    for (const ix of compiledIxs) {
      const progIdx = ix.programIdIndex;
      if (accountKeys[progIdx] === dbcProgramId) {
        // All accounts referenced by this DBC instruction
        const ixAccounts = ix.accountKeyIndexes || ix.accounts || [];
        for (const idx of ixAccounts) {
          dbcAccountIndices.add(idx);
        }
      }
    }

    // Collect token mints that appear in DBC instruction accounts
    const dbcMints = new Set();
    for (const post of postTokenBalances) {
      if (dbcAccountIndices.has(post.accountIndex)) {
        dbcMints.add(post.mint);
      }
    }

    // Find token mint that isn't SOL and IS part of a DBC instruction
    let tokenMint = null;
    let tokenChange = 0;
    let solChange = 0;

    // Require at least one DBC instruction found — if none, this tx isn't relevant
    if (dbcMints.size === 0) {
      return null;
    }

    for (const post of postTokenBalances) {
      const mint = post.mint;
      if (mint === SOL_MINT) continue;
      if (EXCLUDED_MINTS.has(mint)) continue;
      // Only consider mints involved in DBC instructions (skip unrelated swaps in same tx)
      if (!dbcMints.has(mint)) continue;

      const pre = preTokenBalances.find(p => p.accountIndex === post.accountIndex);
      const preAmount = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || '0') : 0;
      const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
      const change = postAmount - preAmount;

      // If the change is for the trader's account
      if (post.owner === trader && Math.abs(change) > 0) {
        tokenMint = mint;
        tokenChange = change;
      }
    }

    // Calculate SOL change for trader (index 0)
    if (preBalances.length > 0 && postBalances.length > 0) {
      solChange = (preBalances[0] - postBalances[0]) / 1e9; // lamports to SOL
    }

    // Determine trade type from token balance change direction
    let tradeType = 'buy';
    if (tokenChange < 0) {
      tradeType = 'sell';
      // For sells: trader gained SOL (solChange is negative = post > pre), flip to positive
      solChange = Math.abs(solChange);
      tokenChange = Math.abs(tokenChange);
    } else {
      // For buys: trader spent SOL (solChange is positive = pre > post), subtract tx fee estimate
      solChange = Math.max(0, solChange - 0.00001);
    }

    // Calculate price (SOL per token)
    const price = tokenChange > 0 ? Math.abs(solChange) / tokenChange : 0;

    // Find pool address from DBC instruction accounts
    // The pool is the first writable account in a DBC instruction (not the program, config, or system accounts)
    let poolAddress = null;
    const skipSet = new Set([
      METEORA_DBC_PROGRAM.toBase58(), MYTHICPAD_CONFIG.toBase58(), trader,
      '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'SysvarRent111111111111111111111111111111111',
      'ComputeBudget111111111111111111111111111111', SOL_MINT,
    ]);
    // Check writable accounts in DBC instructions
    for (const idx of dbcAccountIndices) {
      const key = accountKeys[idx];
      if (!key || skipSet.has(key)) continue;
      // Skip token mints and known non-pool accounts
      if (key === tokenMint) continue;
      if (!poolAddress) poolAddress = key;
    }

    return {
      signature,
      blockTime,
      logs,
      trader,
      tokenMint,
      tokenChange: Math.abs(tokenChange),
      solChange: Math.abs(solChange),
      tradeType,
      price,
      poolAddress,
      accountKeys,
    };
  } catch (err) {
    console.error(`[${ts()}] Error parsing tx ${signature}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Event Processing
// ═══════════════════════════════════════════════════════════════

// Known invalid config addresses to filter out
const INVALID_CONFIGS = new Set([
  '11111111111111111111111111111111',  // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // ATA Program
]);

// Known MythicPad pool configs — check transaction account keys for these FIRST (no RPC needed)
const KNOWN_CONFIGS = new Set([
  '3qmRYAJycnRJEVtinC687CXbqTBZTUkPCcsNQzwUhx7K', // MythicPad production
]);

// Resolve config_address for a pool — fast path checks account keys first, slow path reads on-chain
async function resolveConfigAddress(conn, poolAddress, accountKeys, skipRpc = false) {
  let configAddress = null;

  // Method 1 (FAST): Check known configs in transaction account keys — no RPC call needed
  if (accountKeys) {
    for (const key of accountKeys) {
      if (KNOWN_CONFIGS.has(key)) {
        configAddress = key;
        return configAddress;
      }
    }
  }

  // Method 2 (SLOW): Read on-chain pool account data (config pubkey at offset 8 after discriminator)
  if (!skipRpc && poolAddress) {
    try {
      const poolPk = new PublicKey(poolAddress);
      const acct = await conn.getAccountInfo(poolPk);
      if (acct && acct.data.length >= 40 && acct.owner.toBase58() === METEORA_DBC_PROGRAM.toBase58()) {
        const candidate = new PublicKey(acct.data.subarray(8, 40)).toBase58();
        if (!INVALID_CONFIGS.has(candidate)) {
          configAddress = candidate;
        }
      }
    } catch (e) {
      // Fall through — rate limited or network error
    }
  }

  return configAddress;
}

async function processPoolCreated(db, parsed, conn) {
  if (!parsed.tokenMint) return;

  // We only monitor our config account, so all events are MythicPad
  const configAddress = MYTHICPAD_CONFIG.toBase58();

  stmts.upsertToken.run({
    mint: parsed.tokenMint,
    name: null,
    symbol: null,
    uri: null,
    image_url: null,
    creator: parsed.trader,
    pool_address: parsed.poolAddress,
    config_address: configAddress,
    created_at: parsed.blockTime,
  });

  console.log(`[${ts()}] New token: ${parsed.tokenMint} by ${parsed.trader} config=${configAddress}`);
  broadcastWs({ type: 'new_token', mint: parsed.tokenMint, creator: parsed.trader, timestamp: parsed.blockTime });
}

async function processTrade(db, parsed, tradeType, conn) {
  if (!parsed.tokenMint) return;

  const type = tradeType || parsed.tradeType;

  // Ensure token exists — we only monitor our config, so all events are MythicPad
  const configAddress = MYTHICPAD_CONFIG.toBase58();
  const existing = stmts.getToken.get(parsed.tokenMint);
  if (!existing) {
    stmts.upsertToken.run({
      mint: parsed.tokenMint,
      name: null, symbol: null, uri: null, image_url: null,
      creator: null,
      pool_address: parsed.poolAddress,
      config_address: configAddress,
      created_at: parsed.blockTime,
    });
  } else if (!existing.config_address) {
    db.prepare('UPDATE tokens SET config_address = ? WHERE mint = ? AND config_address IS NULL')
      .run(configAddress, parsed.tokenMint);
  }

  const result = stmts.insertTrade.run({
    mint: parsed.tokenMint,
    tx_sig: parsed.signature,
    type,
    sol_amount: parsed.solChange,
    token_amount: parsed.tokenChange,
    price: parsed.price,
    trader: parsed.trader,
    timestamp: parsed.blockTime,
  });

  if (result.changes > 0) {
    stmts.updateSolRaised.run({ mint: parsed.tokenMint });

    // Update holder balance (delta: positive for buy, negative for sell)
    if (parsed.tokenChange > 0) {
      const balanceDelta = type === 'buy' ? parsed.tokenChange : -parsed.tokenChange;
      stmts.upsertHolder.run({ mint: parsed.tokenMint, wallet: parsed.trader, balance: balanceDelta });
    }

    const token = stmts.getToken.get(parsed.tokenMint);
    const progress = token ? (token.sol_raised / token.graduation_threshold * 100).toFixed(1) : '0';

    console.log(`[${ts()}] ${type.toUpperCase()} ${parsed.tokenMint.slice(0, 8)}.. | ${parsed.solChange.toFixed(4)} SOL | ${parsed.tokenChange.toFixed(2)} tokens | price=${parsed.price.toFixed(10)} | progress=${progress}%`);

    broadcastWs({
      type: 'trade',
      mint: parsed.tokenMint,
      tradeType: type,
      solAmount: parsed.solChange,
      tokenAmount: parsed.tokenChange,
      price: parsed.price,
      trader: parsed.trader,
      timestamp: parsed.blockTime,
      progress: parseFloat(progress),
    });
  }
}

function processGraduation(db, parsed) {
  if (!parsed.tokenMint) return;

  stmts.graduateToken.run({
    mint: parsed.tokenMint,
    l1_damm_pool: parsed.poolAddress,
  });

  console.log(`[${ts()}] GRADUATED: ${parsed.tokenMint}`);
  broadcastWs({ type: 'graduated', mint: parsed.tokenMint, timestamp: parsed.blockTime });
}

// ═══════════════════════════════════════════════════════════════
// L1 Indexer — WebSocket subscription + polling fallback
// ═══════════════════════════════════════════════════════════════

let wsConnection = null;
let wsSubscriptionId = null;
let lastProcessedSignature = null;

async function startWebSocketSubscription(conn, db) {
  try {
    console.log(`[${ts()}] Subscribing to MythicPad config logs via WebSocket...`);

    wsSubscriptionId = conn.onLogs(
      MYTHICPAD_CONFIG,
      async (logInfo) => {
        try {
          const { signature, logs } = logInfo;
          const events = parseTransactionLogs(logs, signature, 0, Math.floor(Date.now() / 1000));

          if (events.length === 0) return;

          const parsed = await parseTransaction(conn, signature);
          if (!parsed) return;

          for (const event of events) {
            switch (event.type) {
              case 'pool_created':
                await processPoolCreated(db, parsed, conn);
                break;
              case 'swap':
              case 'buy':
              case 'sell':
                await processTrade(db, parsed, event.type === 'swap' ? undefined : event.type, conn);
                break;
              case 'graduated':
                processGraduation(db, parsed);
                break;
            }
          }

          lastProcessedSignature = signature;
        } catch (err) {
          console.error(`[${ts()}] WS event error:`, err.message);
        }
      },
      'confirmed'
    );

    console.log(`[${ts()}] WebSocket subscription active (id: ${wsSubscriptionId})`);
    return true;
  } catch (err) {
    console.error(`[${ts()}] WebSocket subscription failed:`, err.message);
    return false;
  }
}

async function pollForTransactions(conn, db) {
  try {
    const opts = {
      limit: 50,
      commitment: 'confirmed',
    };

    // Use last known signature as cursor
    if (lastProcessedSignature) {
      opts.until = lastProcessedSignature;
    }

    const signatures = await conn.getSignaturesForAddress(MYTHICPAD_CONFIG, opts);

    if (signatures.length === 0) return;

    // Process in chronological order (oldest first)
    const chronological = signatures.reverse();

    for (const sigInfo of chronological) {
      if (sigInfo.err) continue; // Skip failed txs

      // Check if already processed
      const existing = db.prepare('SELECT 1 FROM trades WHERE tx_sig = ?').get(sigInfo.signature);
      if (existing) continue;

      const tx = await parseTransaction(conn, sigInfo.signature);
      if (!tx) continue;

      const events = parseTransactionLogs(tx.logs, sigInfo.signature, 0, tx.blockTime);

      for (const event of events) {
        switch (event.type) {
          case 'pool_created':
            await processPoolCreated(db, tx, conn);
            break;
          case 'swap':
          case 'buy':
          case 'sell':
            await processTrade(db, tx, event.type === 'swap' ? undefined : event.type, conn);
            break;
          case 'graduated':
            processGraduation(db, tx);
            break;
        }
      }

      lastProcessedSignature = sigInfo.signature;
    }
  } catch (err) {
    console.error(`[${ts()}] Poll error:`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// WebSocket Broadcast (real-time trade feed)
// ═══════════════════════════════════════════════════════════════

let wss = null;

function broadcastWs(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(msg);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Express API
// ═══════════════════════════════════════════════════════════════

function createAPI(db) {
  const app = express();

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // GET /api/launches — all tokens, filterable by status and config
  app.get('/api/launches', (req, res) => {
    const { status, config, limit, offset } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;

    let rows;
    if (config && status) {
      rows = db.prepare('SELECT * FROM tokens WHERE config_address = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(config, status, lim, off);
    } else if (config) {
      rows = db.prepare('SELECT * FROM tokens WHERE config_address = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(config, lim, off);
    } else if (status) {
      rows = db.prepare('SELECT * FROM tokens WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, lim, off);
    } else {
      rows = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC LIMIT ? OFFSET ?').all(lim, off);
    }
    // Enrich each token with current_price from latest trade
    const enriched = rows.map(t => {
      const lastTrade = db.prepare('SELECT price FROM trades WHERE mint = ? AND price > 0 ORDER BY timestamp DESC LIMIT 1').get(t.mint);
      const tradeCount = db.prepare('SELECT COUNT(*) as count FROM trades WHERE mint = ?').get(t.mint);
      return { ...t, current_price: lastTrade?.price || 0, total_trades: tradeCount?.count || 0 };
    });
    res.json({ tokens: enriched, count: enriched.length });
  });

  // GET /api/launches/trending — sorted by 24h volume
  app.get('/api/launches/trending', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const since = Math.floor(Date.now() / 1000) - 86400;
    const rows = stmts.getTrending.all(since, limit);
    res.json({ tokens: rows });
  });

  // GET /api/launches/:mint — single token with stats
  app.get('/api/launches/:mint', (req, res) => {
    const token = stmts.getToken.get(req.params.mint);
    if (!token) return res.status(404).json({ error: 'Token not found' });

    // Get additional stats
    const tradeCount = stmts.getTradeCount.get(req.params.mint);
    const since24h = Math.floor(Date.now() / 1000) - 86400;
    const vol24h = db.prepare('SELECT COALESCE(SUM(sol_amount), 0) as vol FROM trades WHERE mint = ? AND timestamp > ?')
      .get(req.params.mint, since24h);
    const lastTrade = db.prepare('SELECT * FROM trades WHERE mint = ? AND price > 0 ORDER BY timestamp DESC LIMIT 1')
      .get(req.params.mint);

    res.json({
      ...token,
      total_trades: tradeCount.count,
      volume_24h: vol24h.vol,
      current_price: lastTrade?.price || 0,
      progress_pct: token.graduation_threshold > 0
        ? Math.min(100, (token.sol_raised / token.graduation_threshold) * 100)
        : 0,
    });
  });

  // GET /api/launches/:mint/trades — paginated trade history
  app.get('/api/launches/:mint/trades', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const trades = stmts.getTrades.all(req.params.mint, limit, offset);
    const total = stmts.getTradeCount.get(req.params.mint);

    res.json({
      trades,
      page,
      limit,
      total: total.count,
      pages: Math.ceil(total.count / limit),
    });
  });

  // GET /api/launches/:mint/chart — OHLCV candle data
  app.get('/api/launches/:mint/chart', (req, res) => {
    const intervalStr = req.query.interval || '5m';
    const intervalMap = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
    };
    const interval = intervalMap[intervalStr] || 300;
    const since = parseInt(req.query.since) || (Math.floor(Date.now() / 1000) - 86400);

    const candles = stmts.getCandles.all({
      mint: req.params.mint,
      interval,
      since,
    });

    res.json({ candles, interval: intervalStr });
  });

  // GET /api/launches/:mint/holders — holder list
  app.get('/api/launches/:mint/holders', (req, res) => {
    const holders = stmts.getHolders.all(req.params.mint);
    res.json({ holders, count: holders.length });
  });

  // GET /api/graduated — recently graduated tokens
  app.get('/api/graduated', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows = stmts.getGraduated.all(limit);
    res.json({ tokens: rows });
  });

  // GET /api/stats — global statistics
  app.get('/api/stats', (req, res) => {
    const stats = stmts.getGlobalStats.get();
    const since24h = Math.floor(Date.now() / 1000) - 86400;
    const vol24h = db.prepare('SELECT COALESCE(SUM(sol_amount), 0) as vol FROM trades WHERE timestamp > ?')
      .get(since24h);
    const launches24h = db.prepare('SELECT COUNT(*) as count FROM tokens WHERE created_at > ?')
      .get(since24h);

    res.json({
      ...stats,
      volume_24h: vol24h.vol,
      launches_24h: launches24h.count,
    });
  });

  // POST /api/launches/:mint/migrate — cranker updates migration status
  app.post('/api/launches/:mint/migrate', express.json(), (req, res) => {
    const { l2_pool_address, l2_mint } = req.body;
    if (!l2_pool_address || !l2_mint) {
      return res.status(400).json({ error: 'l2_pool_address and l2_mint required' });
    }
    stmts.migrateToken.run({
      mint: req.params.mint,
      l2_pool_address,
      l2_mint,
      migrated_at: Math.floor(Date.now() / 1000),
    });

    broadcastWs({ type: 'migrated', mint: req.params.mint, l2_pool_address, l2_mint });
    res.json({ ok: true });
  });

  // POST /api/update-metadata — manually set token metadata (for fixes)
  app.post('/api/update-metadata', express.json(), (req, res) => {
    const { mint, name, symbol, image_url, uri } = req.body;
    if (!mint) return res.status(400).json({ error: 'mint required' });
    const token = stmts.getToken.get(mint);
    if (!token) return res.status(404).json({ error: 'Token not found' });

    db.prepare('UPDATE tokens SET name = COALESCE(?, name), symbol = COALESCE(?, symbol), image_url = COALESCE(?, image_url), uri = COALESCE(?, uri) WHERE mint = ?')
      .run(name || null, symbol || null, image_url || null, uri || null, mint);

    console.log(`[${ts()}] Manual metadata update: ${mint.slice(0, 8)}.. name=${name} symbol=${symbol}`);
    broadcastWs({ type: 'metadata_updated', mint, name, symbol, image_url });
    res.json({ ok: true });
  });

  // Health check
  app.get('/health', (req, res) => {
    const stats = stmts.getGlobalStats.get();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      tokens: stats.total_tokens,
      trades: stats.total_trades,
      wsClients: wss ? wss.clients.size : 0,
      lastSignature: lastProcessedSignature,
    });
  });

  return app;
}

// ═══════════════════════════════════════════════════════════════
// Token Metadata Fetcher — resolve name/symbol/image from URI
// ═══════════════════════════════════════════════════════════════

async function fetchTokenMetadata(conn, db, mint) {
  try {
    const token = stmts.getToken.get(mint);
    if (!token) return;
    // Skip if we already have complete metadata (name + image)
    if (token.name && token.image_url) return;

    // Use Helius DAS API (getAsset) for reliable metadata resolution
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'meta-' + mint.slice(0, 8),
        method: 'getAsset',
        params: { id: mint },
      }),
    });

    if (!response.ok) return;
    const json = await response.json();
    const asset = json.result;
    if (!asset) return;

    const name = asset.content?.metadata?.name || null;
    const symbol = asset.content?.metadata?.symbol || null;
    const uri = asset.content?.json_uri || null;
    let imageUrl = asset.content?.links?.image || null;

    // Try to get image from files array if links.image is missing
    if (!imageUrl && asset.content?.files?.length > 0) {
      imageUrl = asset.content.files[0].uri || asset.content.files[0].cdn_uri || null;
    }

    // If we have a URI but no image, fetch the JSON metadata to get image
    if (!imageUrl && uri && (uri.startsWith('http') || uri.startsWith('ipfs'))) {
      try {
        const fetchUrl = uri.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const meta = await resp.json();
          imageUrl = meta.image || null;
        }
      } catch (_) { /* ignore */ }
    }

    if (name || symbol || uri || imageUrl) {
      db.prepare('UPDATE tokens SET name = ?, symbol = ?, uri = ?, image_url = ? WHERE mint = ?')
        .run(name, symbol, uri, imageUrl, mint);

      if (name) {
        console.log(`[${ts()}] Metadata: ${mint.slice(0, 8)}.. = ${name} (${symbol}) img=${imageUrl ? 'yes' : 'no'}`);
      }
    }
  } catch (err) {
    // Non-critical, silently ignore
  }
}

// ═══════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════

function ts() { return new Date().toISOString(); }

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  MythicPad L1 Launchpad Indexer + API');
  console.log(`  RPC: ${HELIUS_RPC.split('?')[0]}...`);
  console.log(`  DB: ${DB_PATH}`);
  console.log(`  API: http://0.0.0.0:${API_PORT}`);
  console.log('═══════════════════════════════════════════════════');

  // Initialize database
  const db = initDatabase();
  prepareStatements(db);
  console.log(`[${ts()}] Database initialized at ${DB_PATH}`);

  // Load last processed signature from DB
  const latest = stmts.getLatestSig.get();
  if (latest) {
    lastProcessedSignature = latest.tx_sig;
    console.log(`[${ts()}] Resuming from signature: ${lastProcessedSignature}`);
  }

  // Create HTTP server + Express API
  const app = createAPI(db);
  const server = createServer(app);

  // WebSocket server on same port
  wss = new WebSocketServer({ server, path: '/ws' });

  // Per-IP connection tracking to prevent ghost storms
  const ipConnections = new Map(); // ip -> count
  const MAX_CONNECTIONS_PER_IP = 5;

  wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

    // Rate limit per IP
    const count = ipConnections.get(ip) || 0;
    if (count >= MAX_CONNECTIONS_PER_IP) {
      ws.close(4429, 'Too many connections');
      return;
    }
    ipConnections.set(ip, count + 1);

    ws.isAlive = true;
    ws.clientIp = ip;
    console.log(`[${ts()}] WS client connected from ${ip} (total: ${wss.clients.size})`);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
      const c = ipConnections.get(ip) || 1;
      if (c <= 1) ipConnections.delete(ip);
      else ipConnections.set(ip, c - 1);
      console.log(`[${ts()}] WS client disconnected (total: ${wss.clients.size})`);
    });

    // Send current stats on connect
    try {
      const stats = stmts.getGlobalStats.get();
      ws.send(JSON.stringify({ type: 'stats', ...stats }));
    } catch (e) { /* ignore */ }
  });

  // Heartbeat — kill stale connections every 30s
  setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);

  server.listen(API_PORT, '0.0.0.0', () => {
    console.log(`[${ts()}] API server listening on port ${API_PORT}`);
    console.log(`[${ts()}] WebSocket available at ws://0.0.0.0:${API_PORT}/ws`);
  });

  // Connect to Solana L1
  const conn = new Connection(HELIUS_RPC, {
    commitment: 'confirmed',
    wsEndpoint: HELIUS_WS,
  });

  // Skip Helius WS subscription — causes 429 rate-limit storms
  // Polling fallback (every 15s) is reliable and sufficient
  const wsOk = false;

  // Poll loop: fetches new trades + syncs on-chain state
  console.log(`[${ts()}] Starting poll loop (every ${POLL_INTERVAL / 1000}s)...`);

  async function pollLoop() {
    pollCycleCount++;
    await pollForTransactions(conn, db);

    // Fetch metadata for tokens missing name/symbol (limit to 2 per cycle)
    const missingMeta = db.prepare("SELECT mint FROM tokens WHERE name IS NULL LIMIT 2").all();
    for (const { mint } of missingMeta) {
      await fetchTokenMetadata(conn, db, mint);
    }

    // Sync sol_raised from on-chain pool quoteReserve every Nth cycle (reduce RPC calls)
    if (pollCycleCount % SYNC_EVERY_N_POLLS === 0) {
      const activeTokens = db.prepare("SELECT mint, pool_address, creator FROM tokens WHERE status = 'active' AND pool_address IS NOT NULL").all();
      // Batch read pool accounts in one RPC call
      const poolKeys = activeTokens.map(t => new PublicKey(t.pool_address));
      if (poolKeys.length > 0) {
        try {
          const accounts = await conn.getMultipleAccountsInfo(poolKeys);
          for (let i = 0; i < accounts.length; i++) {
            const acct = accounts[i];
            if (acct && acct.data.length >= 248 && acct.owner.toBase58() === METEORA_DBC_PROGRAM.toBase58()) {
              const quoteReserveLamports = Number(acct.data.readBigUInt64LE(240));
              const solCollected = quoteReserveLamports / 1e9;
              db.prepare('UPDATE tokens SET sol_raised = ? WHERE mint = ?').run(solCollected, activeTokens[i].mint);
              // Backfill creator from on-chain pool data if missing (creator pubkey at offset 104)
              if (!activeTokens[i].creator && acct.data.length >= 136) {
                try {
                  const creatorPk = new PublicKey(acct.data.subarray(104, 136)).toBase58();
                  if (creatorPk !== PublicKey.default.toBase58()) {
                    db.prepare('UPDATE tokens SET creator = ? WHERE mint = ? AND creator IS NULL').run(creatorPk, activeTokens[i].mint);
                    console.log(`[${ts()}] Backfilled creator for ${activeTokens[i].mint}: ${creatorPk}`);
                  }
                } catch { /* ignore parse errors */ }
              }
            }
          }
        } catch (e) {
          // Rate limited or RPC error — skip this sync cycle
        }
      }
    }
  }

  // Initial backfill
  await pollLoop();

  // Continuous polling
  setInterval(pollLoop, POLL_INTERVAL);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n[${ts()}] Shutting down...`);
    if (wsSubscriptionId !== null) {
      conn.removeOnLogsListener(wsSubscriptionId);
    }
    wss.close();
    server.close();
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ts()}] SIGTERM received, shutting down...`);
    if (wsSubscriptionId !== null) {
      conn.removeOnLogsListener(wsSubscriptionId);
    }
    wss.close();
    server.close();
    db.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
