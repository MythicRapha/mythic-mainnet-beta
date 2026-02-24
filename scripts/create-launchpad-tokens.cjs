// create-launchpad-tokens.cjs - Create 6 AI tokens on MythicPad and buy some of each
// Run: cd /mnt/data/mythic-money/website && node /mnt/data/mythic-l2/scripts/create-launchpad-tokens.cjs

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const fs = require('fs');

// ---- Config ----
const RPC_URL = 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey('MythPad111111111111111111111111111111111111');
const MYTH_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq');
const FOUNDATION = new PublicKey('AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e');

// PDA seeds
const LAUNCHPAD_CONFIG_SEED = Buffer.from('launchpad_config');
const TOKEN_LAUNCH_SEED = Buffer.from('token_launch');
const MINT_SEED = Buffer.from('mint');
const CURVE_VAULT_SEED = Buffer.from('curve_vault');

const connection = new Connection(RPC_URL, 'confirmed');

// Load deployer
const deployerJson = JSON.parse(fs.readFileSync('/mnt/data/mythic-l2/keys/deployer.json', 'utf8'));
const deployer = Keypair.fromSecretKey(new Uint8Array(deployerJson));
console.log('Deployer:', deployer.publicKey.toBase58());

// ---- Borsh serialization helpers ----
function serializeString(s) {
  const bytes = Buffer.from(s, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(bytes.length);
  return Buffer.concat([lenBuf, bytes]);
}

function serializeU64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function serializeU16(n) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function serializeOptionBytes32(v) {
  if (v === null || v === undefined) {
    return Buffer.from([0]); // None
  }
  return Buffer.concat([Buffer.from([1]), v]); // Some(bytes)
}

// CreateTokenArgs borsh encoding
// struct CreateTokenArgs {
//   token_name: String,
//   token_symbol: String,
//   token_uri: String,
//   description: String,
//   ai_model_hash: Option<[u8; 32]>,
//   base_price: u64,
//   slope: u64,
//   max_supply: u64,
//   creator_buy_amount: u64,
// }
function encodeCreateToken(args) {
  return Buffer.concat([
    Buffer.from([1]), // discriminator
    serializeString(args.token_name),
    serializeString(args.token_symbol),
    serializeString(args.token_uri),
    serializeString(args.description),
    serializeOptionBytes32(args.ai_model_hash),
    serializeU64(args.base_price),
    serializeU64(args.slope),
    serializeU64(args.max_supply),
    serializeU64(args.creator_buy_amount),
  ]);
}

// BuyArgs borsh encoding
// struct BuyArgs { amount: u64, max_cost: u64 }
function encodeBuy(amount, maxCost) {
  return Buffer.concat([
    Buffer.from([2]), // discriminator
    serializeU64(amount),
    serializeU64(maxCost),
  ]);
}

// ---- PDA derivation ----
function getConfigPDA() {
  return PublicKey.findProgramAddressSync([LAUNCHPAD_CONFIG_SEED], PROGRAM_ID);
}

function getMintPDA(launchIndex) {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(launchIndex));
  return PublicKey.findProgramAddressSync([MINT_SEED, indexBuf], PROGRAM_ID);
}

function getTokenLaunchPDA(mintPubkey) {
  return PublicKey.findProgramAddressSync([TOKEN_LAUNCH_SEED, mintPubkey.toBuffer()], PROGRAM_ID);
}

function getCurveVaultAuthorityPDA(mintPubkey) {
  return PublicKey.findProgramAddressSync([CURVE_VAULT_SEED, mintPubkey.toBuffer()], PROGRAM_ID);
}

// ---- Token definitions ----
const TOKENS = [
  {
    name: 'NeuralMYTH',
    symbol: 'NMYTH',
    uri: 'https://mythic.money/tokens/nmyth',
    description: 'AI neural network token for decentralized inference on Mythic L2. Train and deploy models with on-chain rewards.',
    base_price: 100000n,      // 0.0001 MYTH (in lamports with 9 decimals = 100_000)
    slope: 10n,
    max_supply: 1000000000000n, // 1M tokens with 6 decimals
    prebuy: 100000000n,        // 100 tokens (6 decimals) = 100_000_000 
  },
  {
    name: 'SynthAI',
    symbol: 'SYNTH',
    uri: 'https://mythic.money/tokens/synth',
    description: 'Synthetic AI data marketplace token. Generate, trade, and verify synthetic training data on Mythic L2.',
    base_price: 150000n,
    slope: 8n,
    max_supply: 1000000000000n,
    prebuy: 80000000n,         // 80 tokens
  },
  {
    name: 'DeepMythic',
    symbol: 'DEEP',
    uri: 'https://mythic.money/tokens/deep',
    description: 'Deep learning compute credits on Mythic L2. Purchase distributed GPU time for model training and fine-tuning.',
    base_price: 200000n,
    slope: 12n,
    max_supply: 1000000000000n,
    prebuy: 60000000n,         // 60 tokens
  },
  {
    name: 'AgentCoin',
    symbol: 'AGNTC',
    uri: 'https://mythic.money/tokens/agntc',
    description: 'Autonomous AI agent framework token. Build self-improving agents that earn and trade on Mythic L2.',
    base_price: 120000n,
    slope: 15n,
    max_supply: 1000000000000n,
    prebuy: 150000000n,        // 150 tokens
  },
  {
    name: 'MythicGPT',
    symbol: 'MGPT',
    uri: 'https://mythic.money/tokens/mgpt',
    description: 'Large language model inference token. Run GPT-scale models on Mythic L2 decentralized compute network.',
    base_price: 180000n,
    slope: 5n,
    max_supply: 1000000000000n,
    prebuy: 200000000n,        // 200 tokens
  },
  {
    name: 'QuantumAI',
    symbol: 'QUAI',
    uri: 'https://mythic.money/tokens/quai',
    description: 'Quantum-resistant AI computation token. Post-quantum secure inference and training on Mythic L2.',
    base_price: 250000n,
    slope: 20n,
    max_supply: 1000000000000n,
    prebuy: 50000000n,         // 50 tokens
  },
];

async function readConfig() {
  const [configPda] = getConfigPDA();
  const info = await connection.getAccountInfo(configPda);
  if (!info) throw new Error('Launchpad config not found');
  const data = info.data;
  let offset = 0;
  const isInit = data.readUInt8(offset); offset += 1;
  offset += 32; // admin
  offset += 8;  // graduation_threshold
  const feeBps = data.readUInt16LE(offset); offset += 2;
  offset += 32; // foundation
  const totalLaunched = Number(data.readBigUInt64LE(offset)); offset += 8;
  return { totalLaunched, feeBps };
}

async function createToken(tokenDef, launchIndex) {
  console.log(`\n--- Creating token #${launchIndex}: ${tokenDef.name} (${tokenDef.symbol}) ---`);

  const [configPda] = getConfigPDA();
  const [mintPda] = getMintPDA(launchIndex);
  const [launchPda] = getTokenLaunchPDA(mintPda);
  const [curveVaultAuth] = getCurveVaultAuthorityPDA(mintPda);
  const curveVault = getAssociatedTokenAddressSync(MYTH_MINT, curveVaultAuth, true);
  
  const deployerMythAta = getAssociatedTokenAddressSync(MYTH_MINT, deployer.publicKey);
  const deployerTokenAta = getAssociatedTokenAddressSync(mintPda, deployer.publicKey, true);
  const foundationMythAta = getAssociatedTokenAddressSync(MYTH_MINT, FOUNDATION);

  console.log('  Mint PDA:', mintPda.toBase58());
  console.log('  Launch PDA:', launchPda.toBase58());
  console.log('  Curve Vault Auth:', curveVaultAuth.toBase58());
  console.log('  Curve Vault:', curveVault.toBase58());

  const data = encodeCreateToken({
    token_name: tokenDef.name,
    token_symbol: tokenDef.symbol,
    token_uri: tokenDef.uri,
    description: tokenDef.description,
    ai_model_hash: null,
    base_price: tokenDef.base_price,
    slope: tokenDef.slope,
    max_supply: tokenDef.max_supply,
    creator_buy_amount: tokenDef.prebuy,
  });

  // Accounts for CreateToken:
  //  0.  [signer, writable] creator
  //  1.  [writable]          launchpad_config PDA
  //  2.  [writable]          token_launch PDA
  //  3.  [writable]          mint PDA
  //  4.  [writable]          curve_vault (MYTH ATA owned by vault auth)
  //  5.  []                  curve_vault_authority PDA
  //  6.  []                  myth_mint
  //  7.  [writable]          creator_myth_ata
  //  8.  [writable]          creator_token_ata
  //  9.  [writable]          foundation_myth_ata
  //  10. []                  token_program
  //  11. []                  associated_token_program
  //  12. []                  system_program
  //  13. []                  rent sysvar
  const accounts = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: launchPda, isSigner: false, isWritable: true },
    { pubkey: mintPda, isSigner: false, isWritable: true },
    { pubkey: curveVault, isSigner: false, isWritable: true },
    { pubkey: curveVaultAuth, isSigner: false, isWritable: false },
    { pubkey: MYTH_MINT, isSigner: false, isWritable: false },
    { pubkey: deployerMythAta, isSigner: false, isWritable: true },
    { pubkey: deployerTokenAta, isSigner: false, isWritable: true },
    { pubkey: foundationMythAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys: accounts, data });
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(computeIx).add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { commitment: 'confirmed' });
    console.log('  [OK] Created:', sig);
    return { mintPda, launchPda, curveVault, curveVaultAuth };
  } catch (e) {
    console.error('  [FAIL]', e.message.substring(0, 500));
    // Check if already created
    const launchInfo = await connection.getAccountInfo(launchPda);
    if (launchInfo && launchInfo.data.length > 0) {
      console.log('  [SKIP] Token already exists, continuing...');
      return { mintPda, launchPda, curveVault, curveVaultAuth };
    }
    throw e;
  }
}

async function buyToken(mintPda, launchPda, curveVault, amount) {
  console.log(`  Buying ${amount} tokens of ${mintPda.toBase58()}...`);
  
  const [configPda] = getConfigPDA();
  const deployerMythAta = getAssociatedTokenAddressSync(MYTH_MINT, deployer.publicKey);
  const deployerTokenAta = getAssociatedTokenAddressSync(mintPda, deployer.publicKey, true);
  const foundationMythAta = getAssociatedTokenAddressSync(MYTH_MINT, FOUNDATION);

  // Calculate generous max_cost (10x base_price * amount as upper bound)
  const maxCost = BigInt(amount) * 10000000n; // very generous slippage

  const data = encodeBuy(BigInt(amount), maxCost);

  // Accounts for Buy:
  //  0.  [signer, writable] buyer
  //  1.  [writable]          launchpad_config PDA
  //  2.  [writable]          token_launch PDA
  //  3.  [writable]          mint PDA
  //  4.  [writable]          curve_vault
  //  5.  [writable]          buyer_myth_ata
  //  6.  [writable]          buyer_token_ata
  //  7.  [writable]          foundation_myth_ata
  //  8.  []                  myth_mint
  //  9.  []                  token_program
  //  10. []                  associated_token_program
  //  11. []                  system_program
  const accounts = [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: launchPda, isSigner: false, isWritable: true },
    { pubkey: mintPda, isSigner: false, isWritable: true },
    { pubkey: curveVault, isSigner: false, isWritable: true },
    { pubkey: deployerMythAta, isSigner: false, isWritable: true },
    { pubkey: deployerTokenAta, isSigner: false, isWritable: true },
    { pubkey: foundationMythAta, isSigner: false, isWritable: true },
    { pubkey: MYTH_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys: accounts, data });
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(computeIx).add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { commitment: 'confirmed' });
    console.log('  [OK] Buy:', sig);
  } catch (e) {
    console.error('  [FAIL] Buy:', e.message.substring(0, 500));
  }
}

async function main() {
  try {
    const { totalLaunched, feeBps } = await readConfig();
    console.log('Current total tokens launched:', totalLaunched);
    console.log('Protocol fee bps:', feeBps);

    for (let i = 0; i < TOKENS.length; i++) {
      const tokenDef = TOKENS[i];
      const launchIndex = totalLaunched + i;
      
      const result = await createToken(tokenDef, launchIndex);
      
      // Small delay between transactions
      await new Promise(r => setTimeout(r, 500));
    }

    // Now do additional buys on existing tokens to show activity
    console.log('\n\n=== Buying tokens on existing launches ===');
    
    // Re-read config to get updated state
    const { totalLaunched: newTotal } = await readConfig();
    console.log('Total tokens now:', newTotal);

    // Buy additional amounts on the existing tokens too
    const buyTargets = [
      { index: 0, amount: 200000000 },  // 200 more tokens of NeuralNet
      { index: 1, amount: 150000000 },  // 150 more of GPT-Chain
      { index: 2, amount: 100000000 },  // 100 more of AI Agent
      { index: 3, amount: 80000000 },   // 80 more of TensorGPU
      { index: 4, amount: 120000000 },  // 120 more of SkyNet
      { index: 5, amount: 60000000 },   // 60 more of CompuToken
      { index: 6, amount: 90000000 },   // 90 more of InferAI
      { index: 7, amount: 70000000 },   // 70 more of AgentSwarm
    ];

    for (const target of buyTargets) {
      const [mintPda] = getMintPDA(target.index);
      const [launchPda] = getTokenLaunchPDA(mintPda);
      const [curveVaultAuth] = getCurveVaultAuthorityPDA(mintPda);
      const curveVault = getAssociatedTokenAddressSync(MYTH_MINT, curveVaultAuth, true);
      
      console.log(`\nBuying ${target.amount / 1000000} tokens of index #${target.index}...`);
      await buyToken(mintPda, launchPda, curveVault, target.amount);
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n\n=== Done! Checking final stats ===');
    const finalConfig = await readConfig();
    console.log('Final total tokens launched:', finalConfig.totalLaunched);
    
  } catch (e) {
    console.error('Fatal error:', e);
    process.exit(1);
  }
}

main();
