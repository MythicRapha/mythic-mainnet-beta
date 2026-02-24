// Mythic Reward Distributor Service
// PM2 service that monitors slot progression and triggers epoch reward distribution
// every ~1000 slots on the L2 chain.
//
// Start: pm2 start services/reward-distributor/index.js --name mythic-reward-distributor

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────
const L2_RPC = 'http://127.0.0.1:8899';
const MYTH_TOKEN_PROGRAM_ID = new PublicKey('MythToken1111111111111111111111111111111111');

const FEE_CONFIG_SEED = Buffer.from('fee_config');
const FEE_POOL_SEED = Buffer.from('fee_pool');
const VALIDATOR_SEED = Buffer.from('validator');

const IX_DISTRIBUTE_EPOCH_REWARDS = 5;

const SLOT_INTERVAL = 1000;        // Distribute every 1000 slots
const POLL_INTERVAL_MS = 30_000;   // Check slot every 30 seconds (~75 slots at 400ms/slot)
const RETRY_DELAY_MS = 60_000;     // Wait 60s after errors before retrying

// Known validators
const VALIDATORS = [
  new PublicKey('4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s'),
];

// ── State ───────────────────────────────────────────────────────────────────
let lastDistributionSlot = 0;
let connection;
let deployer;

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function readU64LE(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

// ── Distribution Logic ──────────────────────────────────────────────────────
async function tryDistribute() {
  const [configPda] = PublicKey.findProgramAddressSync(
    [FEE_CONFIG_SEED],
    MYTH_TOKEN_PROGRAM_ID
  );

  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) {
    console.log('[reward-distributor] Fee config not found. Waiting...');
    return;
  }

  // Read current_epoch from config at offset 153
  const configData = configInfo.data;
  const currentEpoch = readU64LE(configData, 153);

  // Derive fee pool PDA
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64LE(currentEpoch);
  const [feePoolPda] = PublicKey.findProgramAddressSync(
    [FEE_POOL_SEED, epochBytes],
    MYTH_TOKEN_PROGRAM_ID
  );

  const poolInfo = await connection.getAccountInfo(feePoolPda);
  if (!poolInfo) {
    console.log('[reward-distributor] No fee pool for epoch', currentEpoch.toString());
    return;
  }

  // Check if already finalized
  const isFinalized = poolInfo.data[16] === 1;
  if (isFinalized) {
    return; // Already done, will advance epoch next collection
  }

  const totalCollected = readU64LE(poolInfo.data, 0);
  if (totalCollected === 0n) {
    console.log('[reward-distributor] Fee pool empty for epoch', currentEpoch.toString());
    return;
  }

  // Build validator PDAs
  const validatorKeys = [];
  for (const validator of VALIDATORS) {
    const [pda] = PublicKey.findProgramAddressSync(
      [VALIDATOR_SEED, validator.toBuffer()],
      MYTH_TOKEN_PROGRAM_ID
    );
    const info = await connection.getAccountInfo(pda);
    if (info) {
      validatorKeys.push({ pubkey: pda, isSigner: false, isWritable: true });
    }
  }

  if (validatorKeys.length === 0) {
    console.log('[reward-distributor] No registered validators found.');
    return;
  }

  console.log('[reward-distributor] Distributing epoch', currentEpoch.toString(),
    'rewards to', validatorKeys.length, 'validator(s)...');
  console.log('[reward-distributor] Pool collected:', totalCollected.toString());

  const data = Buffer.from([IX_DISTRIBUTE_EPOCH_REWARDS]);
  const keys = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: feePoolPda, isSigner: false, isWritable: true },
    ...validatorKeys,
  ];

  const ix = new TransactionInstruction({
    programId: MYTH_TOKEN_PROGRAM_ID,
    keys,
    data,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log('[reward-distributor] Distributed:', sig);
  } catch (e) {
    const msg = e.message || e.toString();
    if (msg.includes('FeePoolAlreadyFinalized') || msg.includes('custom program error: 0x8')) {
      console.log('[reward-distributor] Pool already finalized (race condition). OK.');
    } else {
      console.error('[reward-distributor] Distribution failed:', msg.substring(0, 500));
    }
  }
}

// ── Main Loop ───────────────────────────────────────────────────────────────
async function mainLoop() {
  console.log('[reward-distributor] Starting Mythic Reward Distributor...');
  console.log('[reward-distributor] RPC:', L2_RPC);
  console.log('[reward-distributor] Program:', MYTH_TOKEN_PROGRAM_ID.toBase58());
  console.log('[reward-distributor] Slot interval:', SLOT_INTERVAL);
  console.log('[reward-distributor] Poll interval:', POLL_INTERVAL_MS, 'ms');

  connection = new Connection(L2_RPC, 'confirmed');
  deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json');
  console.log('[reward-distributor] Crank wallet:', deployer.publicKey.toBase58());

  // Get initial slot
  lastDistributionSlot = await connection.getSlot();
  console.log('[reward-distributor] Starting at slot', lastDistributionSlot);

  while (true) {
    try {
      const currentSlot = await connection.getSlot();

      if (currentSlot - lastDistributionSlot >= SLOT_INTERVAL) {
        console.log('[reward-distributor] Slot', currentSlot,
          '- triggering distribution (last:', lastDistributionSlot, ')');

        await tryDistribute();
        lastDistributionSlot = currentSlot;
      }

      await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      console.error('[reward-distributor] Loop error:', e.message);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Start ───────────────────────────────────────────────────────────────────
mainLoop().catch(err => {
  console.error('[reward-distributor] Fatal:', err);
  process.exit(1);
});
