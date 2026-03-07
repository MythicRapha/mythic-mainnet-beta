#!/usr/bin/env node
// Drain all MythicSwap pools and burn the MYTH tokens
// Uses RemoveLiquidity (instruction 3) with deployer's LP tokens

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { readFileSync } from 'fs'

const RPC_URL = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }
const SWAP_PROGRAM = new PublicKey('MythSwap11111111111111111111111111111111111')
const MYTH_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const LP_POSITION_SEED = Buffer.from('lp_position')

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

function writeU64LE(buf, offset, val) {
  const big = BigInt(val)
  for (let i = 0; i < 8; i++) buf[offset + i] = Number((big >> BigInt(8 * i)) & 0xFFn)
}

function readU64LE(buf, offset) {
  let val = 0n
  for (let i = 0; i < 8; i++) val |= BigInt(buf[offset + i]) << BigInt(8 * i)
  return val
}

// Pool data extracted from on-chain state
const POOLS = [
  {
    name: 'MYTH/wBTC',
    pool: '2Yrg9gaQg36J6Z1qU7CzMoCS5EV1RFUDAMKqDrYEMBD1',
    mintA: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    mintB: '8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw',
    vaultA: '7tm7ytbUFvXDPnPAUJDG7swdAN8RnxaN6tjri5ixighT',
    vaultB: 'HMnZQnxjJDw68Pxo6mUoWb8dRUb3ijmjsFQjwNPjpJup',
    lpMint: 'BcuVHwFqu6iKu2oZywRD8Jqe17U3hrMh4FgNsrJoyorv',
  },
  {
    name: 'RAP/MYTH',
    pool: '36KBrXX7kLxfpw62yUGRGk71oMZCBj2khraeYDTyhskx',
    mintA: '36Rtiv4sccqcTTNCTiTdzAqB9zN7ASoxRV8sJCX1fBL4',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: 'H3VyYFAiR1JBS1TZVt62R7kGM9LrVdoXjFEN7H7mU23g',
    vaultB: '2AeHFeVomgqbtkVHtxe3HsiDbWmVi29A5Hna32952QRr',
    lpMint: 'DgN8Uzzpmm3vKFVT2dTDKtneFcArE6qsKeAmyUYDMZzb',
  },
  {
    name: 'LORE/MYTH',
    pool: '3XHWjhN5JPfxgrTQ5ARaM2tca3xCBTZ7VuhsQqS9mR7b',
    mintA: 'F9g1geEgbjq9sRpUydB6w217TEBnDdYELvzoRGhRWbv',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: 'A4yarNkYqUQqAWmiPiWKBXYiVZTGLXV5edEELBZqxXFc',
    vaultB: '4RC6Ly9z8gjf8Ynn7Qn56zHiMYWikXU29ifXbg4T9JR8',
    lpMint: 'F88SGTR1u8NfE7TtiVFcrb9uDh6F49TPMQYSmbAJbFvv',
  },
  {
    name: 'SAGE/MYTH',
    pool: '6bTopBFBUXp2Qtz88NsVuSrAbTLQDZHA7RpABAqz8FtW',
    mintA: '2FYxcWrmBqRP7vQmakbaQzwb27KEumgjuTTDSCa9wNo5',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: 'CgjEMFTG2poHpcXaSKBirJnSC6Arsm92FbJzmvWgXW7H',
    vaultB: 'GDpcpz6k4SUHrNxTVBGGyikCdQ17u5SoJU9JPE51jgRH',
    lpMint: 'DamriLBMnHBVQ1KLQQDMnBDr2kdYAYGUfS3PYjEDx5tk',
  },
  {
    name: 'RAP2/MYTH',
    pool: '8pdDmeG4iKeWQxPPcW26TrTkNXkFWNSwg5HGCM6BP2tE',
    mintA: 'RapUCeGe48bvGnpoHdHjK1PjuTCzQEvazXqx7c9k5oP',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: 'BcBKyEhWbvWgTRT1deZUpZpmbFoS4Vq5SwK1sM7Rc47p',
    vaultB: 'FTt1AYmpeLz5ReWE4bTQ8RowGjh57ucBLYdWjwSaFNZe',
    lpMint: 'BtW7hZzKVMoJ8B5wGyCoeTVRtfySKLnhe6ZW6b2h2MbL',
  },
  {
    name: 'wETH/MYTH',
    pool: 'Ao542pJLJTVYBizt8ZzY7trgAkf94t5QFV7te8eqLaem',
    mintA: '4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: '52UWrSk9YPQxMtHiX4ZehmHxFVtJZ79B7yVcwozQsVWz',
    vaultB: '2WtDhNce1Fv7odoQaLP8XvEHyG59gx1cyoHS14YDUJf5',
    lpMint: '9MhdtAG5m9CBWh92hCNNe4SZ7P964U985gvm7W5M14ZU',
  },
  {
    name: 'USDC/MYTH',
    pool: 'BFBD6PCcYX7BWDVcNiiwCRJmtSwyxfttJfSXvSF67edj',
    mintA: '6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: '7P9sjTyPFHrmhBas8TKrgBJPFne1Pea8GKYJkCpuuVRP',
    vaultB: 'GyLz4VbWXGkdqrcsUZiyS6cPHJ9Kfro5sBUy7LhnnPac',
    lpMint: 'EBL2Sbgy2k5sbGmPdkx9dDAKdLaWEZWG8oQXfrNUMmK7',
  },
  {
    name: 'MYTH/TOKEN1',
    pool: 'BhTVssfJwCmhc3MyH8AxXnYXWmhQYSXpucR6UZEP3wTw',
    mintA: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    mintB: '9BvyhFM4PAnvwoHpBwDot3oavRRN5kiQPvFzMxvJMSeL',
    vaultA: '75psjgqW1bPSTtWTtAvEXjvRuaPNeHF3RcWEXd6hV1VR',
    vaultB: '5FrfverXCVwnwkYuUickfUBGx2jCDgiLAL11p2HMKanA',
    lpMint: 'EXPqHhsaBRxMoNmyqAzB5GMNxvoN9tbDxozu4EzCqRxA',
  },
  {
    name: 'MYTH/TOKEN2',
    pool: 'CRMHD7bs5bCFXwEw7opGFaucyMmubK34Yi2yZnaMYTvS',
    mintA: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    mintB: '9F93py596SnDiawuZfbJYode7AdPw5JKcTGZgqWBFki1',
    vaultA: 'A7AmFtUSKbXrwHsHzzj8gdKMMAUdwWZ37JY3bhp3mBCN',
    vaultB: '8N5F8C4D2csYTdWjVH76n5gtjL2aNrpkTpDKeTqfBBWp',
    lpMint: 'DHfKnqu22YZ5J48iGv3Wg11ptWrRRxMnSSkv1PvChfdX',
  },
  {
    name: 'MYTH/TOKEN3',
    pool: 'EgUF9HWAdkiqHb4ZrRC1UPSpTLL2pdXMzjGqCpfRAAnu',
    mintA: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    mintB: 'CkXdziAeJK1cFbiR4hWJ5z2RL7yaXUwdVYZjCfiBLzkh',
    vaultA: 'A54RMiGvkvhMcAkvmaomZM1MZtRbra83qDsiX7ssxuwz',
    vaultB: 'FSqxk9KXmWKa4UXvMwE2m7dSSqogvAMrTwjgb3ppdHN9',
    lpMint: 'BYRizrLC4JvUkMvyZuHewCizHWwXEp1dJcGfWUzxwbic',
  },
  {
    name: 'MYTH/wSOL',
    pool: 'F1mZ26qS1tF7NEVKJayEU4Zf6Wnp3vSF1bN6WMW8CuY4',
    mintA: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    mintB: 'FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3',
    vaultA: 'EW1RtpoGM8F74aoLXaUZT48n4CjjJwcbAzZb4bZtnwbS',
    vaultB: '8VMk2YtL7YFvNUkEuH8CXJBwvJdMZfS4ERtSErARCh7T',
    lpMint: 'Gk2Be8yjZhTLTBb4Wb5Ap9YAza74mgeMbrTbDC16v5KB',
  },
  {
    name: 'MYTH/TOKEN4',
    pool: 'GCDimkBX2Zyc46Ts9h3jLT9AQCWgLGmsVxHf6vdTGS8j',
    mintA: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    mintB: 'AuDFDRmutV5ZHDJFwSvvDCRvaE2MaN4awSpKMxJnbj8s',
    vaultA: 'EA8Q3ejHKRsk5J6fSq4c7Z7EpTxLPx3HYG3rkYaKaZ5X',
    vaultB: '5vF5YWqidmVVgxS22Y1vDhDuw6YQJ8YzKCHdmDdybrwr',
    lpMint: '93zLBJyNtNbgzm8kPLw5M5qNDNsD11oRfpovKfsC2dxH',
  },
  {
    name: 'TOKEN5/MYTH',
    pool: 'GXpxdoTtfQke1NZKvBXLkFnEvdaxsyahqPv9UTcwpvCF',
    mintA: '7ohvAnBrnmXiPcwbTvoSHUMZweh4uGWX9pjnjC5TQ4Ut',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: 'vcTPMmvf7CTsbzihfjUQxQreFZV5XupsjBYdYMNiAXu',
    vaultB: '9FLxEDgdBxPiSGV7xPupQToLsXCBs5iJugbEqBKxMVBJ',
    lpMint: 'F58CuQzrU42HPAxMtR8ghJWpb5NttchE939XTQbSLABT',
  },
  {
    name: 'TOKEN6/MYTH',
    pool: 'HRJTGUS36UxTWnJjUiyijk2RYwHuDd8GTFTKscNtqqcE',
    mintA: '63fPDRZhnfXmif8nougZwAAkygci3M7CtAwk7TzQ4rgr',
    mintB: '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq',
    vaultA: 'HXVqHXDC6pQkVjNeJDwyRuHjehB544aBU3Vq36rXCGsV',
    vaultB: 'Fq7vj651F7Drw8tibK9prAQNDZzorVuPLhrcA3dh3t6v',
    lpMint: '9jZpsKFy5tSdJyxzhpHSZxQeBDs6htXvS3ESYZt2egVK',
  },
]

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed')
  const deployer = loadKeypair('/mnt/data/mythic-l2/keys/deployer.json')
  console.log('Deployer:', deployer.publicKey.toBase58())

  let totalMythBurned = 0n

  for (const pool of POOLS) {
    console.log(`\n═══ Draining pool: ${pool.name} ═══`)
    const poolPK = new PublicKey(pool.pool)
    const lpMint = new PublicKey(pool.lpMint)

    // Find deployer's LP position PDA
    const [lpPositionPDA] = PublicKey.findProgramAddressSync(
      [LP_POSITION_SEED, deployer.publicKey.toBuffer(), poolPK.toBuffer()],
      SWAP_PROGRAM
    )

    // Check LP position exists
    const lpPosInfo = await conn.getAccountInfo(lpPositionPDA)
    if (!lpPosInfo) {
      console.log('  No LP position found, skipping')
      continue
    }

    // Read lp_amount from position (offset: 1+32+32 = 65, 8 bytes)
    const lpAmount = readU64LE(lpPosInfo.data, 65)
    if (lpAmount === 0n) {
      console.log('  LP amount is 0, skipping')
      continue
    }
    console.log(`  LP amount: ${lpAmount}`)

    // Find deployer's LP token ATA
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token')
    const lpATA = await getAssociatedTokenAddress(lpMint, deployer.publicKey)

    // Find deployer's token ATAs for both mints
    const mintA = new PublicKey(pool.mintA)
    const mintB = new PublicKey(pool.mintB)
    const tokenATA_A = await getAssociatedTokenAddress(mintA, deployer.publicKey)
    const tokenATA_B = await getAssociatedTokenAddress(mintB, deployer.publicKey)

    const tx = new Transaction()

    // Create ATAs if they don't exist
    for (const [ata, mint] of [[tokenATA_A, mintA], [tokenATA_B, mintB]]) {
      const ataInfo = await conn.getAccountInfo(ata)
      if (!ataInfo) {
        console.log(`  Creating ATA for mint ${mint.toBase58().slice(0,12)}...`)
        tx.add(createAssociatedTokenAccountInstruction(deployer.publicKey, ata, deployer.publicKey, mint))
      }
    }

    // RemoveLiquidity instruction (disc=3)
    // RemoveLiquidityArgs: lp_amount(u64) + min_amount_a(u64) + min_amount_b(u64)
    const data = Buffer.alloc(1 + 24)
    data[0] = 3 // RemoveLiquidity
    writeU64LE(data, 1, lpAmount)
    writeU64LE(data, 9, 0n)  // min_amount_a = 0
    writeU64LE(data, 17, 0n) // min_amount_b = 0

    // Accounts for RemoveLiquidity:
    //   0. [signer, writable] withdrawer
    //   1. [writable]          pool PDA
    //   2. [writable]          vault_a
    //   3. [writable]          vault_b
    //   4. [writable]          lp_mint
    //   5. [writable]          withdrawer_token_a
    //   6. [writable]          withdrawer_token_b
    //   7. [writable]          withdrawer_lp_ata
    //   8. [writable]          lp_position PDA
    //   9. []                  token_program
    const ix = new TransactionInstruction({
      programId: SWAP_PROGRAM,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
        { pubkey: poolPK, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(pool.vaultA), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(pool.vaultB), isSigner: false, isWritable: true },
        { pubkey: lpMint, isSigner: false, isWritable: true },
        { pubkey: tokenATA_A, isSigner: false, isWritable: true },
        { pubkey: tokenATA_B, isSigner: false, isWritable: true },
        { pubkey: lpATA, isSigner: false, isWritable: true },
        { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data,
    })
    tx.add(ix)

    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
      console.log(`  RemoveLiquidity tx: ${sig}`)
    } catch (err) {
      console.log(`  ERROR: ${err.message}`)
      continue
    }
  }

  // Now burn ALL MYTH the deployer has
  console.log('\n═══ Burning all deployer MYTH ═══')
  const { getAssociatedTokenAddress: getATA2, createBurnInstruction } = await import('@solana/spl-token')
  const mythATA = await getATA2(MYTH_MINT, deployer.publicKey)

  try {
    const mythBalance = await conn.getTokenAccountBalance(mythATA)
    const bal = BigInt(mythBalance.value.amount)
    console.log(`Deployer MYTH balance: ${mythBalance.value.uiAmountString}`)

    if (bal > 0n) {
      const burnIx = createBurnInstruction(mythATA, MYTH_MINT, deployer.publicKey, bal)
      const tx = new Transaction().add(burnIx)
      const sig = await sendAndConfirmTransaction(conn, tx, [deployer], TX_OPTS)
      console.log(`Burn tx: ${sig}`)
      totalMythBurned += bal
    }
  } catch (err) {
    console.log(`Burn error: ${err.message}`)
  }

  // Final supply check
  const supply = await conn.getTokenSupply(MYTH_MINT)
  console.log(`\n═══ FINAL MYTH SUPPLY: ${supply.value.uiAmountString} ═══`)
}

main().catch(err => {
  console.error('FATAL:', err.message || err)
  process.exit(1)
})
