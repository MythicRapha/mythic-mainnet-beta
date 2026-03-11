const { Connection, PublicKey } = require("@solana/web3.js");
async function main() {
  const conn = new Connection("http://localhost:8899", "confirmed");
  const programs = [
    ["Bridge L1",    "MythBrdg11111111111111111111111111111111111", "bridge_config"],
    ["Bridge L2",    "MythBrdgL2111111111111111111111111111111111", "l2_bridge_config"],
    ["Swap v2",      "E5KLCYQ9MoUQhHvHNvHbKK8YjWEp5y2eqpW84UHVj4iu", "swap_config"],
    ["Launchpad v2", "62dVNKTPhChmGVzQu7YzK19vVtTk371Zg7iHfNzk635c", "launchpad_config"],
    ["Settlement",   "MythSett1ement11111111111111111111111111111", "settlement_config"],
    ["MYTH Token v2","7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf", "fee_config"],
    ["Governance",   "MythGov111111111111111111111111111111111111", "governance_config"],
    ["Staking v2",   "3J5rESPt79TyqkQ3cjBZCKNmVqBRYNHWEPKWg3dmW2wL", "staking_config"],
    ["Airdrop",      "MythDrop11111111111111111111111111111111111", "airdrop_config"],
    ["AI Precomp",   "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ", "ai_config"],
    ["Compute Mkt",  "AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh", "market_config"],
  ];
  let ok = 0;
  for (const [name, pid, seed] of programs) {
    const programId = new PublicKey(pid);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from(seed)], programId);
    const info = await conn.getAccountInfo(pda);
    const size = info ? info.data.length : 0;
    const status = info ? "OK" : "MISSING";
    if (info) ok++;
    console.log("[" + status + "] " + name + " => size=" + size + " bytes, pda=" + pda.toBase58());
  }
  console.log("\n" + ok + "/11 configs initialized" + (ok === 11 ? " - ALL GOOD" : " - SOME MISSING"));
}
main().catch(console.error);
