#!/usr/bin/env node
/**
 * Seed retroactive points for all existing launchpad creators.
 * Fetches all token launches from both V1 and V2 programs on L2,
 * awards points per launch (500) and per graduation (5000).
 */

import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://rpc.mythic.sh";
const POINTS_API = "https://mythic.fun/api/points/track";

const LAUNCHPAD_V1 = new PublicKey("AdECU7ZgAxeknz5MDXTyERuoXivU2jjKnPVegEmFMn6K");
const LAUNCHPAD_V2 = new PublicKey("CLBeDnHqa55wcgYeQwYdFyaG7WXoBdSrJwijA7DUgNy1");

const V1_SIZE = 719;
const V2_SIZE = 919;

function readPubkey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU8(data, offset) {
  return data[offset];
}

function readFixedString(data, offset, len) {
  const slice = data.subarray(offset, offset + len);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(slice.subarray(0, end === -1 ? len : end));
}

function parseLaunch(data, pubkey) {
  const isInit = data[0] !== 0;
  if (!isInit) return null;
  const creator = readPubkey(data, 1);
  const mint = readPubkey(data, 33);
  const tokenName = readFixedString(data, 65, 32);
  const tokenSymbol = readFixedString(data, 97, 10);
  // status byte at offset: 1+32+32+32+10+200+256+32+1+8+8+8+8+8 = 636
  const status = readU8(data, 636);
  return {
    pubkey: pubkey.toBase58(),
    creator: creator.toBase58(),
    mint: mint.toBase58(),
    tokenName,
    tokenSymbol,
    graduated: status === 1,
  };
}

async function trackPoints(wallet, event, tokenAddress) {
  try {
    const res = await fetch(POINTS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, event, tokenAddress }),
    });
    const data = await res.json();
    return data;
  } catch (e) {
    console.error(`  Failed to track ${event} for ${wallet}: ${e.message}`);
    return null;
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");

  console.log("Fetching all launchpad accounts...");

  const [v1Accounts, v2Accounts] = await Promise.all([
    conn.getProgramAccounts(LAUNCHPAD_V1, { filters: [{ dataSize: V1_SIZE }] }),
    conn.getProgramAccounts(LAUNCHPAD_V2, { filters: [{ dataSize: V2_SIZE }] }),
  ]);

  console.log(`Found ${v1Accounts.length} V1 launches, ${v2Accounts.length} V2 launches`);

  const allLaunches = [];

  for (const { pubkey, account } of [...v1Accounts, ...v2Accounts]) {
    try {
      const launch = parseLaunch(Buffer.from(account.data), pubkey);
      if (launch) allLaunches.push(launch);
    } catch {
      // skip malformed
    }
  }

  console.log(`Parsed ${allLaunches.length} valid launches\n`);

  let totalAwarded = 0;

  for (const launch of allLaunches) {
    console.log(`${launch.tokenSymbol} (${launch.tokenName}) by ${launch.creator.slice(0, 8)}...`);

    // Award launch points
    const launchResult = await trackPoints(launch.creator, "launch", launch.mint);
    if (launchResult) {
      console.log(`  +500 launch pts (total: ${launchResult.total})`);
      totalAwarded += 500;
    }

    // Award graduation points if graduated
    if (launch.graduated) {
      const gradResult = await trackPoints(launch.creator, "graduation", launch.mint);
      if (gradResult) {
        console.log(`  +5000 graduation pts (total: ${gradResult.total})`);
        totalAwarded += 5000;
      }
    }
  }

  console.log(`\nDone! Awarded ${totalAwarded} total retroactive points to ${allLaunches.length} launches.`);
}

main().catch(console.error);
