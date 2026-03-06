#!/usr/bin/env node
// Phase 1: Create wMYTH mint, verify wSOL, mint tokens for initial LP
// Run on server: node scripts/setup-l2-tokens.mjs

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMint,
  getAccount,
  MINT_SIZE,
} from '@solana/spl-token'
import { readFileSync } from 'fs'

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }

const MYTH_DECIMALS = 6
const WSOL_DECIMALS = 9

// DexScreener API for PumpSwap MYTH price
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

// LP seed amount in SOL
const LP_SOL_AMOUNT = 2 // 2 SOL worth of wSOL

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ═══════════════════════════════════════════════════════════════
// Step 1: Create wMYTH Mint
// ═══════════════════════════════════════════════════════════════

async function createWMYTHMint(conn, deployer, mythMintKeypair) {
  console.log('\n═══ Step 1: Create wMYTH Mint ═══')
  console.log(`  Expected address: ${mythMintKeypair.publicKey.toBase58()}`)

  // Check if mint already exists
  const mintInfo = await conn.getAccountInfo(mythMintKeypair.publicKey)
  if (mintInfo) {
    console.log('  wMYTH mint already exists!')
    try {
      const mint = await getMint(conn, mythMintKeypair.publicKey)
      console.log(`  Decimals: ${mint.decimals}`)
      console.log(`  Supply: ${mint.supply}`)
      console.log(`  Mint authority: ${mint.mintAuthority?.toBase58() || 'null'}`)
      return mythMintKeypair.publicKey
    } catch (e) {
      console.log(`  Account exists but not a valid mint: ${e.message}`)
      console.log('  Will skip creation — account already occupied')
      return mythMintKeypair.publicKey
    }
  }

  // Calculate rent exemption for mint account
  const lamports = await conn.getMinimumBalanceForRentExemption(MINT_SIZE)
  console.log(`  Rent exemption: ${lamports} lamports`)

  const tx = new Transaction()

  // Create the mint account
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: deployer.publicKey,
      newAccountPubkey: mythMintKeypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    })
  )

  // Initialize mint: 6 decimals, deployer as mint authority, no freeze authority
  tx.add(
    createInitializeMint2Instruction(
      mythMintKeypair.publicKey,
      MYTH_DECIMALS,
      deployer.publicKey,  // mint authority
      null,                // freeze authority (none)
      TOKEN_PROGRAM_ID
    )
  )

  const sig = await sendAndConfirmTransaction(conn, tx, [deployer, mythMintKeypair], TX_OPTS)
  console.log(`  Created wMYTH mint: ${sig}`)
  console.log(`  Address: ${mythMintKeypair.publicKey.toBase58()}`)
  console.log(`  Decimals: ${MYTH_DECIMALS}`)
  console.log(`  Mint authority: ${deployer.publicKey.toBase58()}`)

  return mythMintKeypair.publicKey
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Verify wSOL Mint
// ═══════════════════════════════════════════════════════════════

async function verifyWSOLMint(conn, wsolMintPubkey) {
  console.log('\n═══ Step 2: Verify wSOL Mint ═══')
  console.log(`  Expected address: ${wsolMintPubkey.toBase58()}`)

  const mintInfo = await conn.getAccountInfo(wsolMintPubkey)
  if (!mintInfo) {
    throw new Error(`wSOL mint does not exist at ${wsolMintPubkey.toBase58()}`)
  }

  try {
    const mint = await getMint(conn, wsolMintPubkey)
    console.log(`  Decimals: ${mint.decimals}`)
    console.log(`  Supply: ${mint.supply}`)
    console.log(`  Mint authority: ${mint.mintAuthority?.toBase58() || 'null'}`)

    if (mint.decimals !== WSOL_DECIMALS) {
      throw new Error(`wSOL decimals mismatch: expected ${WSOL_DECIMALS}, got ${mint.decimals}`)
    }

    return wsolMintPubkey
  } catch (e) {
    throw new Error(`wSOL account is not a valid mint: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Fetch Live Price
// ═══════════════════════════════════════════════════════════════

async function fetchLivePrice() {
  console.log('\n═══ Step 3: Fetch Live MYTH/SOL Price ═══')

  const resp = await fetch(DEXSCREENER_URL)
  const data = await resp.json()

  const pair = data.pairs?.find(p => p.dexId === 'pumpswap' || p.dexId === 'raydium') || data.pairs?.[0]
  if (!pair) throw new Error('No pair found on DexScreener')

  const priceInSol = parseFloat(pair.priceNative)
  const priceInUsd = parseFloat(pair.priceUsd)

  console.log(`  Price: 1 MYTH = ${priceInSol} SOL ($${priceInUsd})`)
  console.log(`  Liquidity: $${pair.liquidity?.usd || 'N/A'}`)
  console.log(`  DEX: ${pair.dexId}`)

  return { priceInSol, priceInUsd }
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Create ATAs & Mint Tokens for LP
// ═══════════════════════════════════════════════════════════════

async function mintTokensForLP(conn, deployer, mythMint, wsolMint, priceInSol) {
  console.log('\n═══ Step 4: Create ATAs & Mint Tokens for LP ═══')

  // Calculate amounts based on live price
  // For LP_SOL_AMOUNT SOL worth of liquidity on each side:
  // wSOL: LP_SOL_AMOUNT * 10^9 raw
  // wMYTH: LP_SOL_AMOUNT / priceInSol * 10^6 raw
  const wsolRaw = BigInt(Math.round(LP_SOL_AMOUNT * 10 ** WSOL_DECIMALS))
  const mythAmount = LP_SOL_AMOUNT / priceInSol
  const mythRaw = BigInt(Math.round(mythAmount * 10 ** MYTH_DECIMALS))

  console.log(`  LP seeding: ${LP_SOL_AMOUNT} SOL worth on each side`)
  console.log(`  wSOL to mint: ${Number(wsolRaw) / 10 ** WSOL_DECIMALS} (${wsolRaw} raw)`)
  console.log(`  wMYTH to mint: ${Number(mythRaw) / 10 ** MYTH_DECIMALS} (${mythRaw} raw)`)
  console.log(`  At price: 1 MYTH = ${priceInSol} SOL`)

  // Create deployer's wMYTH ATA
  const mythATA = await getAssociatedTokenAddress(mythMint, deployer.publicKey)
  const wsolATA = await getAssociatedTokenAddress(wsolMint, deployer.publicKey)

  console.log(`  Deployer wMYTH ATA: ${mythATA.toBase58()}`)
  console.log(`  Deployer wSOL ATA: ${wsolATA.toBase58()}`)

  // Create ATAs if they don't exist
  const tx1 = new Transaction()
  let needsTx1 = false

  const mythATAInfo = await conn.getAccountInfo(mythATA)
  if (!mythATAInfo) {
    console.log('  Creating deployer wMYTH ATA...')
    tx1.add(createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      mythATA,
      deployer.publicKey,
      mythMint
    ))
    needsTx1 = true
  } else {
    console.log('  Deployer wMYTH ATA already exists')
  }

  const wsolATAInfo = await conn.getAccountInfo(wsolATA)
  if (!wsolATAInfo) {
    console.log('  Creating deployer wSOL ATA...')
    tx1.add(createAssociatedTokenAccountInstruction(
      deployer.publicKey,
      wsolATA,
      deployer.publicKey,
      wsolMint
    ))
    needsTx1 = true
  } else {
    console.log('  Deployer wSOL ATA already exists')
  }

  if (needsTx1) {
    const sig1 = await sendAndConfirmTransaction(conn, tx1, [deployer], TX_OPTS)
    console.log(`  Created ATAs: ${sig1}`)
    await sleep(500)
  }

  // Mint wMYTH to deployer (deployer has mint authority)
  console.log(`\n  Minting ${Number(mythRaw) / 10 ** MYTH_DECIMALS} wMYTH to deployer...`)
  const tx2 = new Transaction()
  tx2.add(createMintToInstruction(
    mythMint,
    mythATA,
    deployer.publicKey, // mint authority
    mythRaw
  ))

  const sig2 = await sendAndConfirmTransaction(conn, tx2, [deployer], TX_OPTS)
  console.log(`  Minted wMYTH: ${sig2}`)

  // Mint wSOL to deployer (deployer has mint authority on L2 wSOL)
  console.log(`  Minting ${Number(wsolRaw) / 10 ** WSOL_DECIMALS} wSOL to deployer...`)
  const tx3 = new Transaction()
  tx3.add(createMintToInstruction(
    wsolMint,
    wsolATA,
    deployer.publicKey, // mint authority
    wsolRaw
  ))

  const sig3 = await sendAndConfirmTransaction(conn, tx3, [deployer], TX_OPTS)
  console.log(`  Minted wSOL: ${sig3}`)

  // Verify balances
  await sleep(500)
  const mythBalance = await conn.getTokenAccountBalance(mythATA)
  const wsolBalance = await conn.getTokenAccountBalance(wsolATA)

  console.log(`\n  Final deployer balances:`)
  console.log(`  wMYTH: ${mythBalance.value.uiAmountString} (${mythBalance.value.amount} raw)`)
  console.log(`  wSOL: ${wsolBalance.value.uiAmountString} (${wsolBalance.value.amount} raw)`)

  return { mythATA, wsolATA, mythRaw, wsolRaw }
}

// ═══════════════════════════════════════════════════════════════
// Step 5: Create Pool
// ═══════════════════════════════════════════════════════════════

async function createPool(conn, deployer, mythMint, wsolMint, mythRaw, wsolRaw) {
  console.log('\n═══ Step 5: Create MYTH/wSOL Pool ═══')

  const SWAP_PROGRAM = new PublicKey('MythSwap11111111111111111111111111111111111')
  const TOKEN_PROG = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111')

  // Sort mints (lower address first)
  const cmp = mythMint.toBuffer().compare(wsolMint.toBuffer())
  const [sortedA, sortedB] = cmp < 0 ? [mythMint, wsolMint] : [wsolMint, mythMint]
  const [amtA, amtB] = cmp < 0 ? [mythRaw, wsolRaw] : [wsolRaw, mythRaw]
  const swapped = cmp >= 0

  console.log(`  Mint A (sorted): ${sortedA.toBase58()}`)
  console.log(`  Mint B (sorted): ${sortedB.toBase58()}`)
  console.log(`  Amount A: ${amtA} raw`)
  console.log(`  Amount B: ${amtB} raw`)
  console.log(`  Swapped: ${swapped}`)

  // Derive PDAs
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap_config')], SWAP_PROGRAM
  )
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), sortedA.toBuffer(), sortedB.toBuffer()], SWAP_PROGRAM
  )
  const [vaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_a'), poolPDA.toBuffer()], SWAP_PROGRAM
  )
  const [vaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_b'), poolPDA.toBuffer()], SWAP_PROGRAM
  )
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('lp_mint'), poolPDA.toBuffer()], SWAP_PROGRAM
  )
  const [protocolVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_vault')], SWAP_PROGRAM
  )

  console.log(`  Pool PDA: ${poolPDA.toBase58()}`)
  console.log(`  LP Mint PDA: ${lpMint.toBase58()}`)

  // Check if pool already exists
  const poolInfo = await conn.getAccountInfo(poolPDA)
  if (poolInfo) {
    console.log('  Pool already exists! Skipping creation.')
    return poolPDA
  }

  // Derive creator ATAs
  const creatorTokenA = await getAssociatedTokenAddress(sortedA, deployer.publicKey)
  const creatorTokenB = await getAssociatedTokenAddress(sortedB, deployer.publicKey)
  const creatorLpAta = await getAssociatedTokenAddress(lpMint, deployer.publicKey)

  // Build CreatePool instruction (disc=1)
  const data = Buffer.alloc(17) // 1 + 8 + 8
  data[0] = 1 // CreatePool discriminator
  data.writeBigUInt64LE(amtA, 1)
  data.writeBigUInt64LE(amtB, 9)

  const tx = new Transaction()

  // CreatePool instruction — LP ATA is created inline by the program via CPI
  // Account 15 (ATA program) is passed so the program can create the LP ATA
  // after the LP mint PDA is initialized
  tx.add(new TransactionInstruction({
    programId: SWAP_PROGRAM,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: sortedA, isSigner: false, isWritable: false },
      { pubkey: sortedB, isSigner: false, isWritable: false },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: creatorTokenA, isSigner: false, isWritable: true },
      { pubkey: creatorTokenB, isSigner: false, isWritable: true },
      { pubkey: creatorLpAta, isSigner: false, isWritable: true },
      { pubkey: protocolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false }, // account 15: ATA program for inline LP ATA creation
    ],
    data,
  }))

  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
  console.log(`  CreatePool tx: ${sig}`)

  // Verify pool state
  await sleep(1000)
  const newPoolInfo = await conn.getAccountInfo(poolPDA)
  if (newPoolInfo) {
    const reserveA = newPoolInfo.data.readBigUInt64LE(162)
    const reserveB = newPoolInfo.data.readBigUInt64LE(170)
    const lpSupply = newPoolInfo.data.readBigUInt64LE(178)

    console.log(`\n  Pool created successfully!`)
    console.log(`  Reserve A: ${reserveA}`)
    console.log(`  Reserve B: ${reserveB}`)
    console.log(`  LP Supply: ${lpSupply}`)

    // Calculate implied price
    if (cmp < 0) {
      // A = MYTH, B = wSOL
      const price = (Number(reserveB) / 10 ** WSOL_DECIMALS) / (Number(reserveA) / 10 ** MYTH_DECIMALS)
      console.log(`  Implied price: 1 MYTH = ${price} SOL`)
    } else {
      // A = wSOL, B = MYTH
      const price = (Number(reserveA) / 10 ** WSOL_DECIMALS) / (Number(reserveB) / 10 ** MYTH_DECIMALS)
      console.log(`  Implied price: 1 MYTH = ${price} SOL`)
    }
  }

  return poolPDA
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Phase 1+2: L2 Token Infrastructure + Pool Setup')
  console.log('═══════════════════════════════════════════════════')

  const conn = new Connection(RPC_URL, 'confirmed')

  // Load keypairs
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  const mythMintKeypair = loadKeypair('/mnt/data/mythic-l2/keys/mints/myth.json')
  const wsolMintPubkey = new PublicKey('FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3')

  console.log(`Deployer: ${deployer.publicKey.toBase58()}`)
  console.log(`wMYTH mint keypair: ${mythMintKeypair.publicKey.toBase58()}`)
  console.log(`wSOL mint: ${wsolMintPubkey.toBase58()}`)

  const balance = await conn.getBalance(deployer.publicKey)
  console.log(`Deployer native balance: ${balance / 1e9} MYTH (as SOL)`)

  // Step 1: Create wMYTH mint
  const mythMint = await createWMYTHMint(conn, deployer, mythMintKeypair)

  // Step 2: Verify wSOL mint
  await verifyWSOLMint(conn, wsolMintPubkey)

  // Step 3: Fetch live price
  const { priceInSol } = await fetchLivePrice()

  // Step 4: Create ATAs and mint tokens
  const { mythATA, wsolATA, mythRaw, wsolRaw } = await mintTokensForLP(
    conn, deployer, mythMint, wsolMintPubkey, priceInSol
  )

  // Step 5: Create pool
  const poolPDA = await createPool(conn, deployer, mythMint, wsolMintPubkey, mythRaw, wsolRaw)

  console.log('\n═══════════════════════════════════════════════════')
  console.log('  SETUP COMPLETE')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  wMYTH Mint: ${mythMint.toBase58()}`)
  console.log(`  wSOL Mint: ${wsolMintPubkey.toBase58()}`)
  console.log(`  Pool: ${poolPDA.toBase58()}`)
  console.log(`  Price: 1 MYTH = ${priceInSol} SOL`)
  console.log('')
  console.log('  Next: Run init-launchpad-live.mjs to initialize launchpad')
  console.log('  Then: Start price-sync-daemon.mjs via PM2')
}

main().catch(err => {
  console.error('\nFATAL:', err.message || err)
  if (err.logs) console.error('Logs:', err.logs)
  process.exit(1)
})
