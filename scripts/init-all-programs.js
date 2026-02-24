// init-all-programs.js — Initialize all 11 Mythic L2 program configs
// Run: node /mnt/data/mythic-l2/scripts/init-all-programs.js

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const borsh = require("borsh");
const fs = require("fs");

// ── Config ──────────────────────────────────────────────────────────
const RPC = "http://localhost:8899";
const DEPLOYER_PATH = "/mnt/data/mythic-l2/keys/deployer.json";

const SEQUENCER = new PublicKey("DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg");
const FOUNDATION = new PublicKey("AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e");

// Canonical Program IDs (from genesis)
const PROGRAMS = {
  bridgeL1:      new PublicKey("MythBrdg11111111111111111111111111111111111"),
  bridgeL2:      new PublicKey("MythBrdgL2111111111111111111111111111111111"),
  swap:          new PublicKey("MythSwap11111111111111111111111111111111111"),
  launchpad:     new PublicKey("MythPad111111111111111111111111111111111111"),
  settlement:    new PublicKey("MythSett1ement11111111111111111111111111111"),
  mythToken:     new PublicKey("MythToken1111111111111111111111111111111111"),
  governance:    new PublicKey("MythGov111111111111111111111111111111111111"),
  staking:       new PublicKey("MythStak11111111111111111111111111111111111"),
  airdrop:       new PublicKey("MythDrop11111111111111111111111111111111111"),
  aiPrecompiles: new PublicKey("CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ"),
  computeMarket: new PublicKey("AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh"),
};

// ── Helpers ─────────────────────────────────────────────────────────
function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function findPDA(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

// Borsh-serialize a u64
function serU64(val) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(val));
  return buf;
}

// Borsh-serialize a u16
function serU16(val) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(val);
  return buf;
}

// Borsh-serialize an i64
function serI64(val) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(val));
  return buf;
}

// Borsh-serialize a Pubkey (32 bytes)
function serPubkey(pk) {
  return pk.toBuffer();
}

// Borsh-serialize a FeeSplit { validator_bps: u16, foundation_bps: u16, burn_bps: u16 }
function serFeeSplit(validatorBps, foundationBps, burnBps) {
  const buf = Buffer.alloc(6);
  buf.writeUInt16LE(validatorBps, 0);
  buf.writeUInt16LE(foundationBps, 2);
  buf.writeUInt16LE(burnBps, 4);
  return buf;
}

async function sendTx(conn, ix, signers, label) {
  const tx = new Transaction().add(ix);
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, signers, {
      commitment: "confirmed",
      skipPreflight: false,
    });
    console.log(`  [OK] ${label}: ${sig}`);
    return true;
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("already in use") || msg.includes("AlreadyInitialized") || msg.includes("already initialized") || msg.includes("Account already initialized")) {
      console.log(`  [SKIP] ${label}: already initialized`);
      return true;
    }
    // Check for program-specific AlreadyInitialized error codes
    // Bridge: 0x1, Launchpad: 0xd, Staking: 0x1, Airdrop: 0x1, AI: varies
    const alreadyInitCodes = ["0x1", "0xd", "0x0"];
    for (const code of alreadyInitCodes) {
      if (msg.includes("custom program error: " + code)) {
        console.log(`  [SKIP] ${label}: already initialized (error code ${code})`);
        return true;
      }
    }
    console.error(`  [FAIL] ${label}: ${msg}`);
    return false;
  }
}

// ── Initialize Functions ────────────────────────────────────────────

// 1. Bridge L1: InitializeParams { sequencer: Pubkey, challenge_period: i64 }
//    Accounts: admin(signer,writable), config_pda(writable), system_program
//    PDA seed: "bridge_config"
async function initBridgeL1(conn, deployer) {
  console.log("\n=== Bridge L1 ===");
  const programId = PROGRAMS.bridgeL1;
  const [configPDA] = findPDA([Buffer.from("bridge_config")], programId);
  
  // Discriminator 0 + sequencer(32) + challenge_period(i64, 604800 = 7 days)
  const data = Buffer.concat([
    Buffer.from([0]), // IX_INITIALIZE
    serPubkey(SEQUENCER),
    serI64(604800),
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Bridge L1 Initialize");
}

// 2. Bridge L2: InitializeParams { relayer: Pubkey }
//    Accounts: admin(signer,writable), l2_bridge_config_pda(writable), system_program
//    PDA seed: "l2_bridge_config"
async function initBridgeL2(conn, deployer) {
  console.log("\n=== Bridge L2 ===");
  const programId = PROGRAMS.bridgeL2;
  const [configPDA] = findPDA([Buffer.from("l2_bridge_config")], programId);
  
  // Discriminator 0 + relayer(Pubkey = deployer for now, acts as relayer)
  const data = Buffer.concat([
    Buffer.from([0]),
    serPubkey(deployer.publicKey), // relayer = deployer
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Bridge L2 Initialize");
}

// 3. Swap: InitializeArgs { protocol_fee_bps: u16, lp_fee_bps: u16, pool_creation_fee: u64 }
//    Accounts: authority(signer,writable), config_pda(writable), system_program
//    PDA seed: "swap_config"
async function initSwap(conn, deployer) {
  console.log("\n=== Swap ===");
  const programId = PROGRAMS.swap;
  const [configPDA] = findPDA([Buffer.from("swap_config")], programId);
  
  // protocol_fee = 3 bps (0.03%), lp_fee = 22 bps (0.22%), pool_creation_fee = 100_000_000 (0.1 SOL)
  const data = Buffer.concat([
    Buffer.from([0]),
    serU16(3),           // protocol_fee_bps
    serU16(22),          // lp_fee_bps
    serU64(100_000_000), // pool_creation_fee (0.1 SOL)
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Swap Initialize");
}

// 4. Launchpad: InitializeArgs { graduation_threshold: u64, protocol_fee_bps: u16, foundation_wallet: Pubkey }
//    Accounts: admin(signer,writable), config_pda(writable), system_program
//    PDA seed: "launchpad_config"
async function initLaunchpad(conn, deployer) {
  console.log("\n=== Launchpad ===");
  const programId = PROGRAMS.launchpad;
  const [configPDA] = findPDA([Buffer.from("launchpad_config")], programId);
  
  // graduation_threshold = 85 MYTH (85_000_000_000 lamports at 6 decimals)
  // protocol_fee = 100 bps (1%)
  const data = Buffer.concat([
    Buffer.from([0]),
    serU64(85_000_000_000), // graduation_threshold
    serU16(100),             // protocol_fee_bps (1%)
    serPubkey(FOUNDATION),   // foundation_wallet
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Launchpad Initialize");
}

// 5. Settlement: InitializeArgs { challenge_period_slots: u64, l2_chain_id: [u8;16], min_challenger_bond: u64 }
//    Accounts: admin(signer,writable), sequencer(readonly), config_pda(writable), system_program
//    PDA seed: "settlement_config"
async function initSettlement(conn, deployer) {
  console.log("\n=== Settlement ===");
  const programId = PROGRAMS.settlement;
  const [configPDA] = findPDA([Buffer.from("settlement_config")], programId);
  
  // l2_chain_id: "mythic-l2" padded to 16 bytes
  const chainId = Buffer.alloc(16);
  Buffer.from("mythic-l2").copy(chainId);
  
  const data = Buffer.concat([
    Buffer.from([0]),
    serU64(151200),       // challenge_period_slots (~7 days)
    chainId,              // l2_chain_id [u8; 16]
    serU64(1_000_000_000), // min_challenger_bond (1 SOL)
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SEQUENCER, isSigner: false, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Settlement Initialize");
}

// 6. MYTH Token: InitializeArgs { foundation_wallet: Pubkey, gas_split: FeeSplit, compute_split: FeeSplit, inference_split: FeeSplit, bridge_split: FeeSplit }
//    Accounts: admin(signer,writable), config_pda(writable), burn_address(readonly), myth_mint(readonly), system_program
//    PDA seed: "fee_config"
async function initMythToken(conn, deployer) {
  console.log("\n=== MYTH Token ===");
  const programId = PROGRAMS.mythToken;
  const [configPDA] = findPDA([Buffer.from("fee_config")], programId);
  
  // Use deployer as burn_address and a dummy mint for now (native SOL mint = 11111...)
  // In production this would be a real $MYTH SPL token mint
  const BURN_ADDRESS = new PublicKey("11111111111111111111111111111111"); // burn sink (system program)
  const MYTH_MINT = new PublicKey("11111111111111111111111111111111"); // placeholder
  
  // Fee splits (all must total 10000 bps)
  // 50% validators, 10% foundation, 40% burn
  const data = Buffer.concat([
    Buffer.from([0]),
    serPubkey(FOUNDATION),                   // foundation_wallet
    serFeeSplit(5000, 1000, 4000),           // gas_split
    serFeeSplit(5000, 1000, 4000),           // compute_split
    serFeeSplit(5000, 1000, 4000),           // inference_split
    serFeeSplit(5000, 1000, 4000),           // bridge_split
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: BURN_ADDRESS, isSigner: false, isWritable: false },
      { pubkey: MYTH_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "MYTH Token Initialize");
}

// 7. Governance: InitializeArgs { voting_period: u64, quorum_votes: u64, proposal_threshold: u64 }
//    Accounts: admin(signer,writable), config_pda(writable), system_program
//    PDA seed: "governance_config"
async function initGovernance(conn, deployer) {
  console.log("\n=== Governance ===");
  const programId = PROGRAMS.governance;
  const [configPDA] = findPDA([Buffer.from("governance_config")], programId);
  
  // voting_period = 302400 slots (~3.5 days)
  // quorum_votes = 1000 (# votes needed)
  // proposal_threshold = 100_000_000 (0.1 SOL worth of MYTH to create proposal)
  const data = Buffer.concat([
    Buffer.from([0]),
    serU64(302400),       // voting_period (slots)
    serU64(1000),         // quorum_votes
    serU64(100_000_000),  // proposal_threshold
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Governance Initialize");
}

// 8. Staking: InitializeArgs { reward_rate: u64, unbonding_slots: u64 }
//    Accounts: admin(signer,writable), config_pda(writable), vault_pda(writable), system_program
//    PDA seed: "staking_config", vault seed: "staking_vault"
async function initStaking(conn, deployer) {
  console.log("\n=== Staking ===");
  const programId = PROGRAMS.staking;
  const [configPDA] = findPDA([Buffer.from("staking_config")], programId);
  const [vaultPDA] = findPDA([Buffer.from("staking_vault")], programId);
  
  // reward_rate = 1000 lamports/slot, unbonding_slots = 120960 (~7 days)
  const data = Buffer.concat([
    Buffer.from([0]),
    serU64(1000),    // reward_rate
    serU64(120960),  // unbonding_slots
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Staking Initialize");
}

// 9. Airdrop: InitializeArgs { merkle_root: [u8;32], total_allocation: u64, claim_start_slot: u64, claim_end_slot: u64 }
//    Accounts: admin(signer,writable), config_pda(writable), vault_pda(writable), system_program
//    PDA seed: "airdrop_config", vault seed: "airdrop_vault"
async function initAirdrop(conn, deployer) {
  console.log("\n=== Airdrop ===");
  const programId = PROGRAMS.airdrop;
  const [configPDA] = findPDA([Buffer.from("airdrop_config")], programId);
  const [vaultPDA] = findPDA([Buffer.from("airdrop_vault")], programId);
  
  // Placeholder merkle root (all zeros), small allocation, far-future claim window
  const merkleRoot = Buffer.alloc(32); // all zeros placeholder
  const data = Buffer.concat([
    Buffer.from([0]),
    merkleRoot,                     // merkle_root [u8; 32]
    serU64(1_000_000_000),          // total_allocation (1 SOL)
    serU64(0),                      // claim_start_slot
    serU64(999_999_999),            // claim_end_slot
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Airdrop Initialize");
}

// 10. AI Precompiles: InitializeArgs { registration_fee: u64, min_stake: u64, burn_address: Pubkey, foundation: Pubkey }
//     Accounts: admin(signer,writable), config_pda(writable), system_program
//     PDA seed: "ai_config"
async function initAIPrecompiles(conn, deployer) {
  console.log("\n=== AI Precompiles ===");
  const programId = PROGRAMS.aiPrecompiles;
  const [configPDA] = findPDA([Buffer.from("ai_config")], programId);
  
  const BURN_ADDRESS = new PublicKey("11111111111111111111111111111111"); // burn sink
  
  const data = Buffer.concat([
    Buffer.from([0]),
    serU64(100_000_000),    // registration_fee (0.1 SOL)
    serU64(1_000_000_000),  // min_stake (1 SOL)
    serPubkey(BURN_ADDRESS), // burn_address
    serPubkey(FOUNDATION),   // foundation
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "AI Precompiles Initialize");
}

// 11. Compute Market: InitializeArgs { min_provider_stake: u64, foundation_wallet: Pubkey, protocol_fee_bps: u16 }
//     Accounts: admin(signer,writable), config_pda(writable), system_program
//     PDA seed: "market_config"
async function initComputeMarket(conn, deployer) {
  console.log("\n=== Compute Market ===");
  const programId = PROGRAMS.computeMarket;
  const [configPDA] = findPDA([Buffer.from("market_config")], programId);
  
  const data = Buffer.concat([
    Buffer.from([0]),
    serU64(1_000_000_000),  // min_provider_stake (1 SOL)
    serPubkey(FOUNDATION),   // foundation_wallet
    serU16(200),             // protocol_fee_bps (2%)
  ]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
  
  return sendTx(conn, ix, [deployer], "Compute Market Initialize");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Mythic L2 Program Config Initializer ===");
  console.log(`RPC: ${RPC}`);
  
  const conn = new Connection(RPC, "confirmed");
  const deployer = loadKeypair(DEPLOYER_PATH);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
  
  const balance = await conn.getBalance(deployer.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  
  let success = 0;
  let failed = 0;
  
  // Critical programs first
  const results = [
    await initBridgeL1(conn, deployer),
    await initBridgeL2(conn, deployer),
    await initSwap(conn, deployer),
    await initLaunchpad(conn, deployer),
    await initSettlement(conn, deployer),
    await initMythToken(conn, deployer),
    await initGovernance(conn, deployer),
    await initStaking(conn, deployer),
    await initAirdrop(conn, deployer),
    await initAIPrecompiles(conn, deployer),
    await initComputeMarket(conn, deployer),
  ];
  
  results.forEach(r => r ? success++ : failed++);
  
  console.log(`\n=== Summary: ${success} OK, ${failed} FAILED ===`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
