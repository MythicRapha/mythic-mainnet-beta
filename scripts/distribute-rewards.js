// Distribute epoch rewards from the MYTH Token fee pool to registered validators.
// Usage: node distribute-rewards.js
// This is called by the mythic-reward-distributor PM2 service every ~1000 slots.

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

// Known validators (add more as they register)
const VALIDATORS = [
  new PublicKey('4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s'), // deployer / primary validator
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function readU64LE(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function distribute() {
  const connection = new Connection(L2_RPC, 'confirmed');
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json');

  // Derive config PDA and read current epoch
  const [configPda] = PublicKey.findProgramAddressSync(
    [FEE_CONFIG_SEED],
    MYTH_TOKEN_PROGRAM_ID
  );

  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) {
    console.log('[reward-distributor] Fee config not found. Skipping.');
    return false;
  }

  // Read current_epoch from config (offset: 1 + 32*4 + 6*4 = 153 bytes into struct)
  // is_initialized(1) + admin(32) + foundation_wallet(32) + burn_address(32) + myth_mint(32)
  // + gas_split(6) + compute_split(6) + inference_split(6) + bridge_split(6) = 1+128+24 = 153
  // current_epoch is u64 at offset 153
  const configData = configInfo.data;
  const currentEpoch = readU64LE(configData, 153);
  const isPaused = configData[184] === 1; // is_paused at offset 1+128+24+8+8+8 = 177... let me recalculate

  console.log('[reward-distributor] Current epoch:', currentEpoch.toString());

  // Derive fee pool PDA for current epoch
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64LE(currentEpoch);
  const [feePoolPda] = PublicKey.findProgramAddressSync(
    [FEE_POOL_SEED, epochBytes],
    MYTH_TOKEN_PROGRAM_ID
  );

  const poolInfo = await connection.getAccountInfo(feePoolPda);
  if (!poolInfo) {
    console.log('[reward-distributor] No fee pool for epoch', currentEpoch.toString(), '- nothing to distribute.');
    return false;
  }

  // Read fee pool: epoch(8) + total_collected(8) + total_distributed(8) + is_finalized(1) + bump(1)
  const poolData = poolInfo.data;
  const totalCollected = readU64LE(poolData, 0);
  const totalDistributed = readU64LE(poolData, 8);
  const isFinalized = poolData[16] === 1;

  console.log('[reward-distributor] Fee pool epoch:', readU64LE(poolData, 0).toString());
  console.log('[reward-distributor] Total collected:', totalCollected.toString());
  console.log('[reward-distributor] Already distributed:', totalDistributed.toString());
  console.log('[reward-distributor] Is finalized:', isFinalized);

  if (isFinalized) {
    console.log('[reward-distributor] Epoch already finalized. Skipping.');
    return false;
  }

  // Build validator PDA accounts
  const validatorPdas = [];
  for (const validator of VALIDATORS) {
    const [pda] = PublicKey.findProgramAddressSync(
      [VALIDATOR_SEED, validator.toBuffer()],
      MYTH_TOKEN_PROGRAM_ID
    );

    // Verify it exists
    const info = await connection.getAccountInfo(pda);
    if (!info) {
      console.log('[reward-distributor] Validator PDA not found for', validator.toBase58(), '- skipping this validator.');
      continue;
    }
    validatorPdas.push({ pubkey: pda, validator: validator });
  }

  if (validatorPdas.length === 0) {
    console.log('[reward-distributor] No registered validators found. Skipping.');
    return false;
  }

  console.log('[reward-distributor] Distributing to', validatorPdas.length, 'validator(s)...');

  // Build DistributeEpochRewards instruction
  // Discriminator: 5 (no additional args)
  // Accounts: caller(signer), config(writable), fee_pool(writable), ...validator_fee_accounts(writable)
  const data = Buffer.from([IX_DISTRIBUTE_EPOCH_REWARDS]);

  const keys = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: feePoolPda, isSigner: false, isWritable: true },
    ...validatorPdas.map(v => ({
      pubkey: v.pubkey,
      isSigner: false,
      isWritable: true,
    })),
  ];

  const ix = new TransactionInstruction({
    programId: MYTH_TOKEN_PROGRAM_ID,
    keys,
    data,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log('[reward-distributor] Epoch rewards distributed:', sig);
    return true;
  } catch (e) {
    console.error('[reward-distributor] Distribution failed:', e.message);
    if (e.logs) console.error('[reward-distributor] Logs:', e.logs.join('\n'));
    return false;
  }
}

// If run directly (not imported)
if (require.main === module) {
  distribute()
    .then(success => {
      console.log('[reward-distributor] Done. Success:', success);
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('[reward-distributor] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { distribute };
