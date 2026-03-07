#!/usr/bin/env node
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://rpc.mythic.sh";
const POINTS_API = "https://mythic.fun/api/points/track";

const LAUNCHPAD_V1 = new PublicKey("AdECU7ZgAxeknz5MDXTyERuoXivU2jjKnPVegEmFMn6K");
const LAUNCHPAD_V2 = new PublicKey("CLBeDnHqa55wcgYeQwYdFyaG7WXoBdSrJwijA7DUgNy1");

async function trackPoints(wallet, event, tokenAddress) {
  try {
    const res = await fetch(POINTS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, event, tokenAddress }),
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");

  console.log("Scanning launchpad transaction history...");

  const [v1Sigs, v2Sigs] = await Promise.all([
    conn.getSignaturesForAddress(LAUNCHPAD_V1, { limit: 1000 }),
    conn.getSignaturesForAddress(LAUNCHPAD_V2, { limit: 1000 }),
  ]);

  console.log(`V1: ${v1Sigs.length} txs, V2: ${v2Sigs.length} txs`);

  const allSigs = [...v1Sigs, ...v2Sigs];
  let buys = 0, sells = 0, creatorTrades = 0, skipped = 0;

  // Collect creator addresses from TokenCreated events
  const tokenCreators = new Map(); // mint -> creator

  for (const sigInfo of allSigs) {
    if (sigInfo.err) { skipped++; continue; }

    const tx = await conn.getTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) { skipped++; continue; }

    const logs = tx.meta?.logMessages || [];

    // Parse EVENT:TokenCreated to build creator map
    for (const log of logs) {
      const createMatch = log.match(/EVENT:TokenCreated:(\{.*\})/);
      if (createMatch) {
        try {
          const evt = JSON.parse(createMatch[1]);
          tokenCreators.set(evt.mint, evt.creator);
        } catch {}
      }
    }

    // Parse EVENT:Trade
    for (const log of logs) {
      const tradeMatch = log.match(/EVENT:Trade:(\{.*\})/);
      if (tradeMatch) {
        try {
          const evt = JSON.parse(tradeMatch[1]);
          const event = evt.side === "Buy" ? "buy" : "sell";
          const r = await trackPoints(evt.trader, event, evt.mint);
          if (r) {
            if (event === "buy") buys++;
            else sells++;
            console.log(`  ${evt.side.toUpperCase().padEnd(4)} ${evt.trader.slice(0,8)}... (+${event === "buy" ? 10 : 3} pts, total: ${r.total})`);
          }

          // Also award creator_trade points to the token creator
          const creator = tokenCreators.get(evt.mint);
          if (creator && creator !== evt.trader) {
            const cr = await trackPoints(creator, "creator_trade", evt.mint);
            if (cr) {
              creatorTrades++;
              console.log(`  CRTR ${creator.slice(0,8)}... (+5 pts, total: ${cr.total})`);
            }
          }
        } catch {}
      }
    }
  }

  console.log(`\nDone! ${buys} buys, ${sells} sells, ${creatorTrades} creator_trades, ${skipped} skipped`);
}

main().catch(console.error);
