/**
 * Fund the Bridge L2 Reserve — sends native MYTH from Foundation to the
 * bridge reserve PDA so the relayer can distribute MYTH on L1→L2 deposits.
 *
 * Run on the server:
 *   node /mnt/data/mythic-l2/scripts/fund-bridge-reserve.cjs
 */
const {
  Connection, Keypair, PublicKey, SystemProgram,
  TransactionInstruction, Transaction, sendAndConfirmTransaction,
} = require('/mnt/data/mythic-cli/node_modules/@solana/web3.js');
const { readFileSync } = require('fs');

const connection = new Connection('http://localhost:8899', 'confirmed');

// Foundation holds the reserve MYTH
const foundationJson = JSON.parse(readFileSync('/mnt/data/mythic-l2/keys/foundation.json', 'utf8'));
const foundation = Keypair.fromSecretKey(new Uint8Array(foundationJson));

const BRIDGE_L2 = new PublicKey('MythBrdgL2111111111111111111111111111111111');

const [configPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('l2_bridge_config')],
  BRIDGE_L2,
);
const [reservePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('bridge_reserve')],
  BRIDGE_L2,
);

// Amount to fund: 10,000,000 MYTH (10M at 9 decimals)
const AMOUNT = BigInt(10_000_000) * BigInt(1_000_000_000); // 10M MYTH in lamports

async function main() {
  console.log('Foundation:', foundation.publicKey.toBase58());
  console.log('Bridge L2 Config PDA:', configPDA.toBase58());
  console.log('Bridge Reserve PDA:', reservePDA.toBase58());
  console.log('Funding amount:', (Number(AMOUNT) / 1e9).toLocaleString(), 'MYTH');

  const balBefore = await connection.getBalance(reservePDA);
  console.log('Reserve balance before:', balBefore / 1e9, 'MYTH');

  // Build FundReserve instruction (IX_FUND_RESERVE = 1)
  // Data: [1] + borsh(FundReserveParams { amount: u64 })
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(1, 0); // instruction discriminator
  data.writeBigUInt64LE(AMOUNT, 1);

  const ix = new TransactionInstruction({
    programId: BRIDGE_L2,
    keys: [
      { pubkey: foundation.publicKey, isSigner: true, isWritable: true },
      { pubkey: reservePDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [foundation]);
  console.log('Funded! TX:', sig);

  const balAfter = await connection.getBalance(reservePDA);
  console.log('Reserve balance after:', balAfter / 1e9, 'MYTH');
}

main().catch(console.error);
