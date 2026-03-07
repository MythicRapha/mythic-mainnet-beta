#!/usr/bin/env node
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { readFileSync } from 'fs'

const RPC = 'http://127.0.0.1:8899'
const TX_OPTS = { skipPreflight: true, commitment: 'confirmed', preflightCommitment: 'confirmed' }
const SWAP_PROGRAM = new PublicKey('E3yp3LNjZkM1ayMhHX1ikH1TMFABYFrDpZVkW5GpkU8t')
const MYTH_MINT = new PublicKey('7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')
const WSOL_MINT = new PublicKey('FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3')
const POOL_PDA = new PublicKey('F1mZ26qS1tF7NEVKJayEU4Zf6Wnp3vSF1bN6WMW8CuY4')
const VAULT_A = new PublicKey('EW1RtpoGM8F74aoLXaUZT48n4CjjJwcbAzZb4bZtnwbS')
const VAULT_B = new PublicKey('8VMk2YtL7YFvNUkEuH8CXJBwvJdMZfS4ERtSErARCh7T')
const LP_MINT = new PublicKey('Gk2Be8yjZhTLTBb4Wb5Ap9YAza74mgeMbrTbDC16v5KB')

function writeU64LE(buf, o, v) { const b=BigInt(v); for(let i=0;i<8;i++) buf[o+i]=Number((b>>BigInt(8*i))&0xFFn) }
function readU64LE(buf, o) { let v=0n; for(let i=0;i<8;i++) v|=BigInt(buf[o+i])<<BigInt(8*i); return v }

const conn = new Connection(RPC, 'confirmed')
const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('/mnt/data/mythic-l2/keys/deployer.json','utf8'))))

// Fetch L1 target price
const l1Resp = await fetch('https://api.dexscreener.com/latest/dex/tokens/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump')
const l1Data = await l1Resp.json()
const l1Price = parseFloat(l1Data.pairs?.[0]?.priceNative || '0.000001694')
console.log('L1 target price:', l1Price)

// Read pool
let poolInfo = await conn.getAccountInfo(POOL_PDA)
let rA = readU64LE(poolInfo.data, 162)
let rB = readU64LE(poolInfo.data, 170)
let l2Price = (Number(rB)/1e9)/(Number(rA)/1e6)
console.log('Current pool:', Number(rA)/1e6, 'MYTH /', Number(rB)/1e9, 'SOL')
console.log('L2 price:', l2Price, '| L1:', l1Price, '| Drift:', ((l2Price-l1Price)/l1Price*100).toFixed(2)+'%')

if (l2Price <= l1Price * 1.02) {
  console.log('Already within 2%, done.'); process.exit(0)
}

// Step 1: Remove 5% LP
const deployerLpATA = await getAssociatedTokenAddress(LP_MINT, deployer.publicKey)
const deployerMythATA = await getAssociatedTokenAddress(MYTH_MINT, deployer.publicKey)
const deployerWsolATA = await getAssociatedTokenAddress(WSOL_MINT, deployer.publicKey)

// LP position PDA: seeds = ["lp_position", pool, owner]
const [lpPositionPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('lp_position'), POOL_PDA.toBuffer(), deployer.publicKey.toBuffer()],
  SWAP_PROGRAM
)

const lpInfo = await conn.getTokenAccountBalance(deployerLpATA)
const deployerLpBal = BigInt(lpInfo.value.amount)
const lpToRemove = deployerLpBal * 5n / 100n
console.log('Removing', Number(lpToRemove)/1e6, 'LP tokens (5%)')

const removeLpData = Buffer.alloc(25)
removeLpData[0] = 3 // RemoveLiquidity
writeU64LE(removeLpData, 1, lpToRemove)
writeU64LE(removeLpData, 9, 0n) // min_a
writeU64LE(removeLpData, 17, 0n) // min_b

const removeTx = new Transaction()
removeTx.add(new TransactionInstruction({
  programId: SWAP_PROGRAM,
  keys: [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: POOL_PDA, isSigner: false, isWritable: true },
    { pubkey: VAULT_A, isSigner: false, isWritable: true },
    { pubkey: VAULT_B, isSigner: false, isWritable: true },
    { pubkey: LP_MINT, isSigner: false, isWritable: true },
    { pubkey: deployerMythATA, isSigner: false, isWritable: true },
    { pubkey: deployerWsolATA, isSigner: false, isWritable: true },
    { pubkey: deployerLpATA, isSigner: false, isWritable: true },
    { pubkey: lpPositionPDA, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: removeLpData,
}))

const removeSig = await sendAndConfirmTransaction(conn, removeTx, [deployer], TX_OPTS)
console.log('LP removed:', removeSig)

// Check deployer MYTH balance after removal
const mythBal = await conn.getTokenAccountBalance(deployerMythATA)
console.log('Deployer wMYTH after LP removal:', Number(mythBal.value.amount)/1e6, 'MYTH')

// Step 2: Re-read pool and sell MYTH to correct price
poolInfo = await conn.getAccountInfo(POOL_PDA)
rA = readU64LE(poolInfo.data, 162)
rB = readU64LE(poolInfo.data, 170)
l2Price = (Number(rB)/1e9)/(Number(rA)/1e6)
console.log('After LP removal: pool', Number(rA)/1e6, 'MYTH /', Number(rB)/1e9, 'SOL, price:', l2Price)

const K = Number(rA) * Number(rB)
const targetRA = Math.sqrt(K / (l1Price * 1000))
let sellRaw = BigInt(Math.floor(targetRA - Number(rA)))
if (sellRaw <= 0n) { console.log('No sell needed'); process.exit(0) }

const availMyth = BigInt(mythBal.value.amount)
if (sellRaw > availMyth) {
  console.log('Capping sell at available:', Number(availMyth)/1e6, 'MYTH')
  sellRaw = availMyth
}
console.log('Selling', Number(sellRaw)/1e6, 'MYTH into pool...')

const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('swap_config')], SWAP_PROGRAM)
const [protocolVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('protocol_vault')], SWAP_PROGRAM)
const protocolFeeVaultToken = await getAssociatedTokenAddress(MYTH_MINT, protocolVaultPDA, true)

const swapData = Buffer.alloc(18)
swapData[0] = 4
writeU64LE(swapData, 1, sellRaw)
writeU64LE(swapData, 9, 0n)
swapData[17] = 1 // a_to_b (MYTH→wSOL)

const swapTx = new Transaction()
swapTx.add(new TransactionInstruction({
  programId: SWAP_PROGRAM,
  keys: [
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: POOL_PDA, isSigner: false, isWritable: true },
    { pubkey: VAULT_A, isSigner: false, isWritable: true },
    { pubkey: VAULT_B, isSigner: false, isWritable: true },
    { pubkey: deployerMythATA, isSigner: false, isWritable: true },
    { pubkey: deployerWsolATA, isSigner: false, isWritable: true },
    { pubkey: protocolFeeVaultToken, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: swapData,
}))

const swapSig = await sendAndConfirmTransaction(conn, swapTx, [deployer], TX_OPTS)
console.log('Swap done:', swapSig)

// Final state
poolInfo = await conn.getAccountInfo(POOL_PDA)
rA = readU64LE(poolInfo.data, 162)
rB = readU64LE(poolInfo.data, 170)
l2Price = (Number(rB)/1e9)/(Number(rA)/1e6)
console.log('Final pool:', Number(rA)/1e6, 'MYTH /', Number(rB)/1e9, 'SOL')
console.log('Final price:', l2Price, '| L1:', l1Price, '| Drift:', ((l2Price-l1Price)/l1Price*100).toFixed(2)+'%')
