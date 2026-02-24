/**
 * Fix Launchpad Config — update graduation_threshold from the incorrect
 * 85_000_000_000_000_000 to the correct 85_000_000_000 (85 MYTH at 9 decimals).
 *
 * Run on the server:
 *   node /mnt/data/mythic-l2/scripts/fix-launchpad-config.cjs
 */
const { Connection, Keypair, PublicKey, TransactionInstruction, Transaction, sendAndConfirmTransaction } = require('/mnt/data/mythic-cli/node_modules/@solana/web3.js');
const { readFileSync } = require('fs');

const connection = new Connection('http://localhost:8899', 'confirmed');

// Deployer is the admin that initialized the launchpad
const deployerJson = JSON.parse(readFileSync('/mnt/data/mythic-l2/keys/deployer.json', 'utf8'));
const deployer = Keypair.fromSecretKey(new Uint8Array(deployerJson));

const LAUNCHPAD = new PublicKey('MythPad111111111111111111111111111111111111');
const [configPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('launchpad_config')],
  LAUNCHPAD,
);

// UpdateConfigArgs (Borsh):
//   graduation_threshold: Option<u64>  -> 1 byte tag + 8 bytes value
//   protocol_fee_bps:     Option<u16>  -> 1 byte tag (0 = None)
//   foundation_wallet:    Option<Pubkey> -> 1 byte tag (0 = None)
function buildUpdateConfigData(graduationThreshold) {
  const buf = Buffer.alloc(1 + 1 + 8 + 1 + 1); // instruction(1) + Some(1) + u64(8) + None(1) + None(1)
  let offset = 0;

  // Instruction discriminator: 5 = UpdateConfig
  buf.writeUInt8(5, offset); offset += 1;

  // graduation_threshold: Some(value)
  buf.writeUInt8(1, offset); offset += 1; // Some tag
  buf.writeBigUInt64LE(BigInt(graduationThreshold), offset); offset += 8;

  // protocol_fee_bps: None
  buf.writeUInt8(0, offset); offset += 1;

  // foundation_wallet: None
  buf.writeUInt8(0, offset); offset += 1;

  return buf;
}

async function main() {
  console.log('Deployer (admin):', deployer.publicKey.toBase58());
  console.log('Config PDA:', configPDA.toBase58());

  // Read current config
  const info = await connection.getAccountInfo(configPDA);
  if (!info) {
    console.error('Launchpad config not initialized!');
    process.exit(1);
  }

  // Quick peek: graduation_threshold is at offset 1 (bool) + 32 (pubkey) = 33, 8 bytes LE
  const currentThreshold = info.data.readBigUInt64LE(33);
  console.log('Current graduation_threshold:', currentThreshold.toString());

  const correctThreshold = 85000000000n; // 85 MYTH at 9 decimals
  if (currentThreshold === correctThreshold) {
    console.log('Already correct! Nothing to do.');
    return;
  }

  console.log('Updating to:', correctThreshold.toString(), '(85 MYTH)');

  const data = buildUpdateConfigData(correctThreshold);

  const ix = new TransactionInstruction({
    programId: LAUNCHPAD,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPDA, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
  console.log('Updated! TX:', sig);

  // Verify
  const info2 = await connection.getAccountInfo(configPDA);
  const newThreshold = info2.data.readBigUInt64LE(33);
  console.log('New graduation_threshold:', newThreshold.toString());
}

main().catch(console.error);
