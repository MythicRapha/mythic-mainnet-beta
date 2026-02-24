import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction } from '/mnt/data/mythic-cli/node_modules/@solana/web3.js/lib/index.cjs.js';
import { serialize } from '/mnt/data/mythic-cli/node_modules/borsh/lib/index.cjs.js';
import { readFileSync } from 'fs';

const connection = new Connection('http://localhost:8899', 'confirmed');

// Load deployer keypair
const deployerJson = JSON.parse(readFileSync('/mnt/data/mythic-l2/keys/deployer.json', 'utf8'));
const deployer = Keypair.fromSecretKey(new Uint8Array(deployerJson));
console.log('Deployer:', deployer.publicKey.toBase58());

// Key addresses
const SEQUENCER = new PublicKey('DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg');
const FOUNDATION = new PublicKey('AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e');

// Program IDs
const PROGRAMS = {
  bridge:     new PublicKey('MythBrdg11111111111111111111111111111111111'),
  bridgeL2:   new PublicKey('MythBrdgL2111111111111111111111111111111111'),
  settlement: new PublicKey('MythSett1ement11111111111111111111111111111'),
  mythToken:  new PublicKey('MythToken1111111111111111111111111111111111'),
  launchpad:  new PublicKey('MythPad111111111111111111111111111111111111'),
  swap:       new PublicKey('MythSwap11111111111111111111111111111111111'),
  staking:    new PublicKey('MythStak11111111111111111111111111111111111'),
  governance: new PublicKey('MythGov111111111111111111111111111111111111'),
  airdrop:    new PublicKey('MythDrop11111111111111111111111111111111111'),
};

// Helper: find PDA
function findPDA(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

// Helper: manual borsh serialization
function serializeBorsh(fields) {
  const buffers = [];
  for (const [type, value] of fields) {
    if (type === 'u8') {
      const b = Buffer.alloc(1);
      b.writeUInt8(value, 0);
      buffers.push(b);
    } else if (type === 'u16') {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(value, 0);
      buffers.push(b);
    } else if (type === 'u64') {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(BigInt(value), 0);
      buffers.push(b);
    } else if (type === 'i64') {
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(value), 0);
      buffers.push(b);
    } else if (type === 'pubkey') {
      buffers.push(value.toBuffer());
    } else if (type === 'bytes') {
      buffers.push(Buffer.from(value));
    }
  }
  return Buffer.concat(buffers);
}

async function sendTx(programId, keys, data, label) {
  try {
    const ix = new TransactionInstruction({ programId, keys, data });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
      commitment: 'confirmed',
    });
    console.log('  [OK] ' + label + ': ' + sig);
    return true;
  } catch (e) {
    const msg = e.message || e.toString();
    if (msg.includes('already in use') || msg.includes('AlreadyInitialized') || msg.includes('custom program error: 0x1')) {
      console.log('  [SKIP] ' + label + ': already initialized');
      return true;
    }
    console.error('  [FAIL] ' + label + ': ' + msg.substring(0, 300));
    return false;
  }
}

// 1. Bridge L1
async function initBridge() {
  console.log('\n=== Bridge L1 ===');
  const programId = PROGRAMS.bridge;
  const [configPDA] = findPDA(programId, [Buffer.from('bridge_config')]);
  console.log('  Config PDA:', configPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['pubkey', SEQUENCER],
      ['i64', 151200],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Bridge L1 Initialize');
}

// 2. Bridge L2
async function initBridgeL2() {
  console.log('\n=== Bridge L2 ===');
  const programId = PROGRAMS.bridgeL2;
  const [configPDA] = findPDA(programId, [Buffer.from('l2_bridge_config')]);
  console.log('  Config PDA:', configPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['pubkey', SEQUENCER],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Bridge L2 Initialize');
}

// 3. Settlement
async function initSettlement() {
  console.log('\n=== Settlement ===');
  const programId = PROGRAMS.settlement;
  const [configPDA] = findPDA(programId, [Buffer.from('settlement_config')]);
  console.log('  Config PDA:', configPDA.toBase58());

  const chainId = Buffer.alloc(16);
  chainId.write('mythic-l2', 'utf8');

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['u64', 151200],
      ['bytes', chainId],
      ['u64', 1000000000],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: SEQUENCER, isSigner: false, isWritable: false },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Settlement Initialize');
}

// 4. Swap
async function initSwap() {
  console.log('\n=== Swap ===');
  const programId = PROGRAMS.swap;
  const [configPDA] = findPDA(programId, [Buffer.from('swap_config')]);
  console.log('  Config PDA:', configPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['u16', 3],
      ['u16', 22],
      ['u64', 100000000],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Swap Initialize');
}

// 5. Staking
async function initStaking() {
  console.log('\n=== Staking ===');
  const programId = PROGRAMS.staking;
  const [configPDA] = findPDA(programId, [Buffer.from('staking_config')]);
  const [vaultPDA] = findPDA(programId, [Buffer.from('staking_vault')]);
  console.log('  Config PDA:', configPDA.toBase58());
  console.log('  Vault PDA:', vaultPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['u64', 1000000],
      ['u64', 120960],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Staking Initialize');
}

// 6. Governance
async function initGovernance() {
  console.log('\n=== Governance ===');
  const programId = PROGRAMS.governance;
  const [configPDA] = findPDA(programId, [Buffer.from('governance_config')]);
  console.log('  Config PDA:', configPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['u64', 216000],
      ['u64', 40000000000000],
      ['u64', 50000000000000],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Governance Initialize');
}

// 7. Airdrop
async function initAirdrop() {
  console.log('\n=== Airdrop ===');
  const programId = PROGRAMS.airdrop;
  const [configPDA] = findPDA(programId, [Buffer.from('airdrop_config')]);
  const [vaultPDA] = findPDA(programId, [Buffer.from('airdrop_vault')]);
  console.log('  Config PDA:', configPDA.toBase58());
  console.log('  Vault PDA:', vaultPDA.toBase58());

  const merkleRoot = Buffer.alloc(32);
  const currentSlot = await connection.getSlot();

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['bytes', merkleRoot],
      ['u64', 100000000000000000n],
      ['u64', currentSlot],
      ['u64', currentSlot + 4320000],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Airdrop Initialize');
}

// 8. MYTH Token
async function initMythToken() {
  console.log('\n=== MYTH Token ===');
  const programId = PROGRAMS.mythToken;
  const [configPDA] = findPDA(programId, [Buffer.from('fee_config')]);
  const BURN_ADDRESS = new PublicKey('1nc1nerator11111111111111111111111111111111');
  const MYTH_MINT = PublicKey.default;
  console.log('  Config PDA:', configPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['pubkey', FOUNDATION],
      ['u16', 7000], ['u16', 2000], ['u16', 1000],
      ['u16', 6000], ['u16', 2500], ['u16', 1500],
      ['u16', 5000], ['u16', 3000], ['u16', 2000],
      ['u16', 4000], ['u16', 4000], ['u16', 2000],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: BURN_ADDRESS, isSigner: false, isWritable: false },
    { pubkey: MYTH_MINT, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'MYTH Token Initialize');
}

// 9. Launchpad
async function initLaunchpad() {
  console.log('\n=== Launchpad ===');
  const programId = PROGRAMS.launchpad;
  const [configPDA] = findPDA(programId, [Buffer.from('launchpad_config')]);
  console.log('  Config PDA:', configPDA.toBase58());

  const data = Buffer.concat([
    Buffer.from([0]),
    serializeBorsh([
      ['u64', 85000000000000000n],
      ['u16', 100],
      ['pubkey', FOUNDATION],
    ]),
  ]);

  return sendTx(programId, [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data, 'Launchpad Initialize');
}

// Main
async function main() {
  console.log('Initializing all Mythic L2 programs...');
  console.log('RPC:', connection.rpcEndpoint);

  const balance = await connection.getBalance(deployer.publicKey);
  console.log('Deployer balance:', balance / 1e9, 'SOL');

  if (balance < 10000000000) {
    console.log('Requesting airdrop...');
    const sig = await connection.requestAirdrop(deployer.publicKey, 100000000000);
    await connection.confirmTransaction(sig);
    console.log('Airdrop confirmed');
  }

  const results = [];
  results.push(await initBridge());
  results.push(await initBridgeL2());
  results.push(await initSettlement());
  results.push(await initSwap());
  results.push(await initStaking());
  results.push(await initGovernance());
  results.push(await initAirdrop());
  results.push(await initMythToken());
  results.push(await initLaunchpad());

  const ok = results.filter(r => r).length;
  const fail = results.filter(r => !r).length;
  console.log('\n=== Summary: ' + ok + ' OK, ' + fail + ' FAILED ===');
}

main().catch(console.error);
