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

// Graduation threshold in SOL (matches MythicPad partner config: 20 SOL)
const GRADUATION_THRESHOLD_SOL = 20;

// Polling interval for getSignaturesForAddress fallback (ms)
const POLL_INTERVAL = 5_000;

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

    // Find token mint that isn't SOL (the launched token)
    let tokenMint = null;
    let tokenChange = 0;
    let solChange = 0;

    for (const post of postTokenBalances) {
      const mint = post.mint;
      if (mint === SOL_MINT) continue;

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
      // Subtract estimated tx fee (~0.000005 SOL)
      solChange = Math.max(0, solChange - 0.00001);
    }

    // Determine trade type
    let tradeType = 'buy';
    if (tokenChange < 0) {
      tradeType = 'sell';
      solChange = Math.abs(solChange);
      tokenChange = Math.abs(tokenChange);
    }

    // Calculate price (SOL per token)
    const price = tokenChange > 0 ? Math.abs(solChange) / tokenChange : 0;

    // Find pool address (look for Meteora DBC account in the tx)
    let poolAddress = null;
    for (let i = 1; i < accountKeys.length; i++) {
      if (accountKeys[i] !== METEORA_DBC_PROGRAM.toBase58() && accountKeys[i] !== trader) {
        // Heuristic: pool is usually one of the first few accounts
        if (i <= 5) {
          poolAddress = accountKeys[i];
          break;
        }
      }
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

function processPoolCreated(db, parsed) {
  if (!parsed.tokenMint) return;

  stmts.upsertToken.run({
    mint: parsed.tokenMint,
    name: null,
    symbol: null,
    uri: null,
    image_url: null,
    creator: parsed.trader,
    pool_address: parsed.poolAddress,
    config_address: null,
    created_at: parsed.blockTime,
  });

  console.log(`[${ts()}] New token: ${parsed.tokenMint} by ${parsed.trader}`);
  broadcastWs({ type: 'new_token', mint: parsed.tokenMint, creator: parsed.trader, timestamp: parsed.blockTime });
}

function processTrade(db, parsed, tradeType) {
  if (!parsed.tokenMint) return;

  const type = tradeType || parsed.tradeType;

  // Ensure token exists
  const existing = stmts.getToken.get(parsed.tokenMint);
  if (!existing) {
    stmts.upsertToken.run({
      mint: parsed.tokenMint,
      name: null, symbol: null, uri: null, image_url: null,
      creator: null,
      pool_address: parsed.poolAddress,
      config_address: null,
      created_at: parsed.blockTime,
    });
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
    console.log(`[${ts()}] Subscribing to Meteora DBC logs via WebSocket...`);

    wsSubscriptionId = conn.onLogs(
      METEORA_DBC_PROGRAM,
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
                processPoolCreated(db, parsed);
                break;
              case 'swap':
              case 'buy':
              case 'sell':
                processTrade(db, parsed, event.type === 'swap' ? undefined : event.type);
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

    const signatures = await conn.getSignaturesForAddress(METEORA_DBC_PROGRAM, opts);

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
            processPoolCreated(db, tx);
            break;
          case 'swap':
          case 'buy':
          case 'sell':
            processTrade(db, tx, event.type === 'swap' ? undefined : event.type);
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

  // GET /api/launches — all tokens, filterable by status
  app.get('/api/launches', (req, res) => {
    const { status, limit, offset } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;

    let rows;
    if (status) {
      rows = db.prepare('SELECT * FROM tokens WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, lim, off);
    } else {
      rows = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC LIMIT ? OFFSET ?').all(lim, off);
    }
    res.json({ tokens: rows, count: rows.length });
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
    const lastTrade = db.prepare('SELECT * FROM trades WHERE mint = ? ORDER BY timestamp DESC LIMIT 1')
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
    if (!token || token.name) return; // Already has metadata

    // Try to get token metadata from Metaplex
    const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
      METADATA_PROGRAM
    );

    const metaInfo = await conn.getAccountInfo(metadataPDA);
    if (!metaInfo) return;

    // Parse Metaplex metadata (simplified)
    const data = metaInfo.data;
    // Skip: key(1) + update_authority(32) + mint(32) = 65
    // name: 4-byte length prefix + string (max 32 chars)
    const nameLen = data.readUInt32LE(65);
    const name = data.subarray(69, 69 + Math.min(nameLen, 32)).toString('utf8').replace(/\0/g, '').trim();

    // symbol: after name (padded to 36 bytes from offset 69)
    const symbolStart = 69 + 36; // 105
    const symbolLen = data.readUInt32LE(symbolStart);
    const symbol = data.subarray(symbolStart + 4, symbolStart + 4 + Math.min(symbolLen, 10)).toString('utf8').replace(/\0/g, '').trim();

    // uri: after symbol (padded to 14 bytes from symbolStart+4)
    const uriStart = symbolStart + 4 + 14; // 123
    const uriLen = data.readUInt32LE(uriStart);
    const uri = data.subarray(uriStart + 4, uriStart + 4 + Math.min(uriLen, 200)).toString('utf8').replace(/\0/g, '').trim();

    let imageUrl = null;
    if (uri && (uri.startsWith('http') || uri.startsWith('ipfs'))) {
      try {
        const fetchUrl = uri.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(timeout);
        const json = await resp.json();
        imageUrl = json.image || null;
      } catch (_) { /* ignore metadata fetch failures */ }
    }

    db.prepare('UPDATE tokens SET name = ?, symbol = ?, uri = ?, image_url = ? WHERE mint = ?')
      .run(name || null, symbol || null, uri || null, imageUrl, mint);

    if (name) {
      console.log(`[${ts()}] Metadata: ${mint.slice(0, 8)}.. = ${name} (${symbol})`);
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

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[${ts()}] WS client connected from ${ip} (total: ${wss.clients.size})`);

    ws.on('close', () => {
      console.log(`[${ts()}] WS client disconnected (total: ${wss.clients.size})`);
    });

    // Send current stats on connect
    const stats = stmts.getGlobalStats.get();
    ws.send(JSON.stringify({ type: 'stats', ...stats }));
  });

  server.listen(API_PORT, '0.0.0.0', () => {
    console.log(`[${ts()}] API server listening on port ${API_PORT}`);
    console.log(`[${ts()}] WebSocket available at ws://0.0.0.0:${API_PORT}/ws`);
  });

  // Connect to Solana L1
  const conn = new Connection(HELIUS_RPC, {
    commitment: 'confirmed',
    wsEndpoint: HELIUS_WS,
  });

  // Try WebSocket subscription first
  const wsOk = await startWebSocketSubscription(conn, db);

  // Always run polling as well (catches missed events, backfills)
  console.log(`[${ts()}] Starting poll loop (every ${POLL_INTERVAL / 1000}s)...`);

  async function pollLoop() {
    await pollForTransactions(conn, db);

    // Fetch metadata for tokens missing name/symbol
    const missingMeta = db.prepare("SELECT mint FROM tokens WHERE name IS NULL LIMIT 5").all();
    for (const { mint } of missingMeta) {
      await fetchTokenMetadata(conn, db, mint);
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
