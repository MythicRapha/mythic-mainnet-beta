const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction, SYSVAR_RENT_PUBKEY } = require('/mnt/data/mythic-cli/node_modules/@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('/mnt/data/mythic-cli/node_modules/@solana/spl-token');
const { readFileSync, writeFileSync, existsSync } = require('fs');

const connection = new Connection('http://localhost:8899', 'confirmed');

const deployerJson = JSON.parse(readFileSync('/mnt/data/mythic-l2/keys/deployer.json', 'utf8'));
const deployer = Keypair.fromSecretKey(new Uint8Array(deployerJson));

const LAUNCHPAD_PROGRAM = new PublicKey('MythPad111111111111111111111111111111111111');
const FOUNDATION = new PublicKey('AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e');

function serializeBorsh(fields) {
  const buffers = [];
  for (const [type, value] of fields) {
    if (type === 'u8') {
      const b = Buffer.alloc(1); b.writeUInt8(value, 0); buffers.push(b);
    } else if (type === 'u16') {
      const b = Buffer.alloc(2); b.writeUInt16LE(value, 0); buffers.push(b);
    } else if (type === 'u32') {
      const b = Buffer.alloc(4); b.writeUInt32LE(value, 0); buffers.push(b);
    } else if (type === 'u64') {
      const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value), 0); buffers.push(b);
    } else if (type === 'pubkey') {
      buffers.push(value.toBuffer());
    } else if (type === 'string') {
      const strBytes = Buffer.from(value, 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(strBytes.length, 0);
      buffers.push(lenBuf); buffers.push(strBytes);
    } else if (type === 'option_bytes32') {
      if (value === null) {
        buffers.push(Buffer.from([0]));
      } else {
        buffers.push(Buffer.from([1]));
        buffers.push(Buffer.from(value));
      }
    }
  }
  return Buffer.concat(buffers);
}

async function sendTx(programId, keys, data, label, signers) {
  try {
    const ix = new TransactionInstruction({ programId, keys, data });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, signers || [deployer], { commitment: 'confirmed' });
    console.log('  [OK] ' + label + ': ' + sig);
    return sig;
  } catch (e) {
    const msg = e.message || e.toString();
    if (msg.includes('already in use') || msg.includes('AlreadyInitialized') || msg.includes('custom program error: 0xd')) {
      console.log('  [SKIP] ' + label + ': already initialized');
      return 'skip';
    }
    console.error('  [FAIL] ' + label + ': ' + msg.substring(0, 600));
    return null;
  }
}

async function main() {
  console.log('=== Launchpad Initialization & Test Tokens ===');
  console.log('Deployer:', deployer.publicKey.toBase58());

  // Step 1: Load or create MYTH token mint
  console.log('\n--- Step 1: MYTH Token Mint ---');
  const mythMintAddrFile = '/mnt/data/mythic-l2/keys/myth-mint-address.txt';
  let mythMint;
  if (existsSync(mythMintAddrFile)) {
    mythMint = new PublicKey(readFileSync(mythMintAddrFile, 'utf8').trim());
    const acct = await connection.getAccountInfo(mythMint);
    if (acct) {
      console.log('  Using existing MYTH mint:', mythMint.toBase58());
    } else {
      console.log('  Stored mint not on chain, creating new one...');
      mythMint = await createMint(connection, deployer, deployer.publicKey, null, 9);
      writeFileSync(mythMintAddrFile, mythMint.toBase58());
      console.log('  Created MYTH mint:', mythMint.toBase58());
    }
  } else {
    mythMint = await createMint(connection, deployer, deployer.publicKey, null, 9);
    writeFileSync(mythMintAddrFile, mythMint.toBase58());
    console.log('  Created MYTH mint:', mythMint.toBase58());
  }

  // Step 2: Fund deployer with MYTH
  console.log('\n--- Step 2: Fund Deployer with MYTH ---');
  const deployerMythAta = await getOrCreateAssociatedTokenAccount(connection, deployer, mythMint, deployer.publicKey);
  console.log('  Deployer MYTH ATA:', deployerMythAta.address.toBase58());
  
  // Only mint if balance is low
  if (deployerMythAta.amount < BigInt('100000000000000000')) {
    const mythAmount = BigInt('1000000000000000000'); // 1B MYTH (9 decimals)
    await mintTo(connection, deployer, mythMint, deployerMythAta.address, deployer, mythAmount);
    console.log('  Minted 1B MYTH to deployer');
  } else {
    console.log('  Deployer already has MYTH:', (Number(deployerMythAta.amount) / 1e9).toFixed(2));
  }

  // Step 3: Foundation ATA
  console.log('\n--- Step 3: Foundation MYTH ATA ---');
  const foundationMythAta = await getOrCreateAssociatedTokenAccount(connection, deployer, mythMint, FOUNDATION);
  console.log('  Foundation MYTH ATA:', foundationMythAta.address.toBase58());

  // Step 4: Config PDA
  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('launchpad_config')], LAUNCHPAD_PROGRAM);
  console.log('\n--- Step 4: Config PDA:', configPDA.toBase58(), '---');

  const configAcct = await connection.getAccountInfo(configPDA);
  if (configAcct && configAcct.data.length === 101) {
    console.log('  Config already initialized');
  } else {
    const initData = Buffer.concat([
      Buffer.from([0]),
      serializeBorsh([
        ['u64', BigInt('85000000000')],
        ['u16', 100],
        ['pubkey', FOUNDATION],
      ]),
    ]);
    await sendTx(LAUNCHPAD_PROGRAM, [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], initData, 'Launchpad Initialize');
  }

  // Step 5: Create test tokens
  console.log('\n--- Step 5: Create Test Tokens ---');
  
  const testTokens = [
    { name: 'NeuralNet', symbol: 'NEURAL', desc: 'Decentralized neural network compute on Mythic. Training distributed AI models with on-chain coordination.', ai: 'GPT-4 Fine-tune' },
    { name: 'GPT-Chain', symbol: 'GPTC', desc: 'On-chain GPT inference marketplace. Run large language models on distributed Mythic L2 compute nodes.', ai: 'GPT-4o' },
    { name: 'AI Agent', symbol: 'AGENT', desc: 'Autonomous AI trading agent on Mythic L2. Self-improving strategies powered by reinforcement learning.', ai: null },
    { name: 'Tensor', symbol: 'TENSOR', desc: 'GPU tensor compute rental protocol. Rent and provide GPU power for AI workloads on Mythic L2.', ai: 'Stable Diffusion XL' },
    { name: 'CompuToken', symbol: 'COMPU', desc: 'Decentralized compute credits. Purchase GPU/TPU time on the Mythic network.', ai: null },
    { name: 'InferAI', symbol: 'INFER', desc: 'Real-time AI inference protocol. Sub-second model inference on distributed GPU nodes.', ai: 'Llama 3' },
    { name: 'AgentSwarm', symbol: 'SWARM', desc: 'Coordinating AI agent swarms for distributed task execution on Mythic L2.', ai: 'AutoGPT' },
    { name: 'MythicBot', symbol: 'MBOT', desc: 'Autonomous trading bot framework powered by Mythic L2. Deploy AI-driven trading strategies.', ai: null },
  ];

  const createdTokens = [];

  for (let i = 0; i < testTokens.length; i++) {
    const t = testTokens[i];
    console.log('\n  Creating token ' + (i+1) + '/' + testTokens.length + ': ' + t.name + ' ($' + t.symbol + ')');
    
    const cfgData = await connection.getAccountInfo(configPDA);
    if (!cfgData) { console.log('    Config not found'); continue; }
    
    const launchIndex = cfgData.data.readBigUInt64LE(75);
    console.log('    Launch index:', launchIndex.toString());
    const launchIndexBytes = Buffer.alloc(8);
    launchIndexBytes.writeBigUInt64LE(launchIndex);

    // Derive PDAs
    const [mintPDA] = PublicKey.findProgramAddressSync([Buffer.from('mint'), launchIndexBytes], LAUNCHPAD_PROGRAM);
    const [launchPDA] = PublicKey.findProgramAddressSync([Buffer.from('token_launch'), mintPDA.toBuffer()], LAUNCHPAD_PROGRAM);
    const [curveVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('curve_vault'), mintPDA.toBuffer()], LAUNCHPAD_PROGRAM);
    
    // The curve_vault ATA (MYTH token account owned by curveVaultPDA)
    const curveVaultAta = await getAssociatedTokenAddress(mythMint, curveVaultPDA, true);
    
    // Creator's token ATA for the new mint
    const creatorTokenAta = await getAssociatedTokenAddress(mintPDA, deployer.publicKey, true);

    console.log('    Mint PDA:', mintPDA.toBase58());
    console.log('    Launch PDA:', launchPDA.toBase58());
    console.log('    Curve Vault PDA:', curveVaultPDA.toBase58());
    console.log('    Curve Vault ATA:', curveVaultAta.toBase58());

    // Check if launch already exists
    const existingLaunch = await connection.getAccountInfo(launchPDA);
    if (existingLaunch) {
      console.log('    Launch already exists, skipping');
      createdTokens.push({
        name: t.name, symbol: t.symbol, mint: mintPDA.toBase58(),
        launch: launchPDA.toBase58(), launchIndex: launchIndex.toString(),
      });
      continue;
    }

    let aiModelHash = null;
    if (t.ai) {
      const hashBuf = Buffer.alloc(32);
      Buffer.from(t.ai, 'utf8').copy(hashBuf, 0, 0, Math.min(t.ai.length, 32));
      aiModelHash = hashBuf;
    }

    // CreateToken instruction data
    const createData = Buffer.concat([
      Buffer.from([1]),
      serializeBorsh([
        ['string', t.name],
        ['string', t.symbol],
        ['string', ''],  // token_uri
        ['string', t.desc],
        ['option_bytes32', aiModelHash],
        ['u64', BigInt('1000')],          // base_price
        ['u64', BigInt('1')],             // slope
        ['u64', BigInt('1000000000000')], // max_supply (1M tokens * 1e6 decimals)
        ['u64', BigInt('0')],             // creator_buy_amount (0 = no pre-buy)
      ]),
    ]);

    const createResult = await sendTx(LAUNCHPAD_PROGRAM, [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },     // 0. creator
      { pubkey: configPDA, isSigner: false, isWritable: true },              // 1. config
      { pubkey: launchPDA, isSigner: false, isWritable: true },              // 2. token_launch
      { pubkey: mintPDA, isSigner: false, isWritable: true },                // 3. mint
      { pubkey: curveVaultAta, isSigner: false, isWritable: true },          // 4. curve_vault (ATA)
      { pubkey: curveVaultPDA, isSigner: false, isWritable: false },         // 5. curve_vault_authority (PDA)
      { pubkey: mythMint, isSigner: false, isWritable: false },              // 6. myth_mint
      { pubkey: deployerMythAta.address, isSigner: false, isWritable: true },// 7. creator_myth_ata
      { pubkey: creatorTokenAta, isSigner: false, isWritable: true },        // 8. creator_token_ata
      { pubkey: foundationMythAta.address, isSigner: false, isWritable: true },// 9. foundation_myth_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },      // 10. token_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 11. ata_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },// 12. system
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },    // 13. rent
    ], createData, 'Create ' + t.symbol);

    if (createResult && createResult !== null) {
      createdTokens.push({
        name: t.name, symbol: t.symbol, mint: mintPDA.toBase58(),
        launch: launchPDA.toBase58(), launchIndex: launchIndex.toString(),
      });
    }
  }

  console.log('\n=== Summary ===');
  console.log('MYTH Mint:', mythMint.toBase58());
  console.log('Tokens created:', createdTokens.length);
  for (const ct of createdTokens) {
    console.log('  ' + ct.symbol + ': mint=' + ct.mint);
  }

  const output = {
    mythMint: mythMint.toBase58(),
    launchpadProgram: LAUNCHPAD_PROGRAM.toBase58(),
    configPDA: configPDA.toBase58(),
    tokens: createdTokens,
  };
  writeFileSync('/mnt/data/mythic-l2/scripts/launchpad-tokens.json', JSON.stringify(output, null, 2));
}

main().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
