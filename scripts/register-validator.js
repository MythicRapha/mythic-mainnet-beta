// Register the main L2 validator with the MYTH Token fee distribution program.
// Usage: node register-validator.js
// Run on server: export PATH=$PATH:/home/mythic/.local/share/solana/install/active_release/bin && node scripts/register-validator.js

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────
const L2_RPC = 'http://127.0.0.1:8899';
const MYTH_TOKEN_PROGRAM_ID = new PublicKey('MythToken1111111111111111111111111111111111');

const FEE_CONFIG_SEED = Buffer.from('fee_config');
const VALIDATOR_SEED = Buffer.from('validator');

const IX_REGISTER_VALIDATOR = 1;

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function serializeRegisterValidatorArgs(stakeAmount, aiCapable) {
  // RegisterValidatorArgs { stake_amount: u64, ai_capable: bool }
  const buf = Buffer.alloc(1 + 8 + 1); // discriminator + u64 + bool
  buf.writeUInt8(IX_REGISTER_VALIDATOR, 0);
  buf.writeBigUInt64LE(BigInt(stakeAmount), 1);
  buf.writeUInt8(aiCapable ? 1 : 0, 9);
  return buf;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const connection = new Connection(L2_RPC, 'confirmed');

  // The deployer is the validator identity on L2
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json');

  console.log('=== Mythic Validator Registration ===');
  console.log('Validator:   ', deployer.publicKey.toBase58());
  console.log('Program:     ', MYTH_TOKEN_PROGRAM_ID.toBase58());

  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [FEE_CONFIG_SEED],
    MYTH_TOKEN_PROGRAM_ID
  );
  const [validatorPda] = PublicKey.findProgramAddressSync(
    [VALIDATOR_SEED, deployer.publicKey.toBuffer()],
    MYTH_TOKEN_PROGRAM_ID
  );

  console.log('Config PDA:  ', configPda.toBase58());
  console.log('Validator PDA:', validatorPda.toBase58());
  console.log();

  // Check if fee config exists
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) {
    console.error('Fee config not initialized. Run init-all-programs first.');
    process.exit(1);
  }
  console.log('Fee config found (' + configInfo.data.length + ' bytes)');

  // Check if validator already registered
  const validatorInfo = await connection.getAccountInfo(validatorPda);
  if (validatorInfo) {
    console.log('Validator already registered! PDA data length:', validatorInfo.data.length);
    console.log('Skipping registration.');
    return;
  }

  // Register: stake_amount = 1,000,000 SOL (in lamports), ai_capable = true
  const STAKE_AMOUNT = 1_000_000_000_000_000n; // 1M SOL * 1e9 lamports
  const AI_CAPABLE = true;

  console.log('Registering validator...');
  console.log('  stake_amount:', STAKE_AMOUNT.toString(), '(1M SOL)');
  console.log('  ai_capable:  ', AI_CAPABLE, '(2x reward multiplier)');

  const data = serializeRegisterValidatorArgs(STAKE_AMOUNT, AI_CAPABLE);

  const ix = new TransactionInstruction({
    programId: MYTH_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: validatorPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log('  Validator registered:', sig);
  } catch (e) {
    console.error('  Registration failed:', e.message);
    if (e.logs) console.error('  Logs:', e.logs.join('\n'));
    process.exit(1);
  }

  // Verify
  const verifyInfo = await connection.getAccountInfo(validatorPda);
  if (verifyInfo) {
    console.log();
    console.log('=== Verification ===');
    console.log('Validator PDA exists:', verifyInfo.data.length, 'bytes');
    console.log('Owner:', verifyInfo.owner.toBase58());
    console.log();
    console.log('Validator registration complete!');
  } else {
    console.error('Verification failed: validator PDA not found after registration.');
    process.exit(1);
  }
}

main().catch(console.error);
