'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  fetchBridgeConfig,
  fetchL2BridgeConfig,
  fetchSolVaultBalance,
  fetchBridgeReserveBalance,
  buildDepositSOLTransaction,
  buildDepositSPLTransaction,
  buildBridgeToL1Transaction,
  BridgeStats,
  BridgeDirection,
  BridgeAsset,
  DepositRecord,
  DAILY_RESET_SLOTS,
  BPS_DENOMINATOR,
  MIN_FEE_LAMPORTS,
  BRIDGE_L1_PROGRAM_ID,
  DECIMAL_SCALING_FACTOR,
  LAMPORTS_PER_MYTH,
  SUPPORTED_ASSETS,
  TOKEN_2022_PROGRAM_ID,
} from '@/lib/bridge-sdk'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { useWalletContext } from '@/providers/WalletProvider'

const L2_RPC = process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh'

export function useBridge() {
  const { publicKey, connected, signAndSendTransaction, signTransaction, refreshBalances } = useWalletContext()

  const [direction, setDirection] = useState<BridgeDirection>('deposit')
  const [selectedAsset, setSelectedAsset] = useState<BridgeAsset>(SUPPORTED_ASSETS[0]) // SOL default
  const [stats, setStats] = useState<BridgeStats | null>(null)
  const [l2Paused, setL2Paused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deposits, setDeposits] = useState<DepositRecord[]>([])
  const [solVaultTvl, setSolVaultTvl] = useState<number>(0)
  const [l2ReserveBalance, setL2ReserveBalance] = useState<number>(0)
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({})

  const l1ConnRef = useRef<Connection | null>(null)
  const l2ConnRef = useRef<Connection | null>(null)

  function getL1Connection(): Connection {
    if (!l1ConnRef.current) {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      l1ConnRef.current = new Connection(baseUrl + '/api/l1-rpc', 'confirmed')
    }
    return l1ConnRef.current
  }

  function getL2Connection(): Connection {
    if (!l2ConnRef.current) {
      l2ConnRef.current = new Connection(L2_RPC, 'confirmed')
    }
    return l2ConnRef.current
  }

  // ── Load Token Balances (L1 SPL tokens) ─────────────────────────────────

  const loadTokenBalances = useCallback(async () => {
    if (!publicKey) {
      setTokenBalances({})
      return
    }

    const l1Conn = getL1Connection()
    const balances: Record<string, number> = {}

    for (const asset of SUPPORTED_ASSETS) {
      if (!asset.l1Mint) continue // SOL handled by wallet hook
      try {
        const tokenProgram = asset.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
        const ata = getAssociatedTokenAddressSync(
          asset.l1Mint,
          publicKey,
          false,
          tokenProgram,
        )
        const info = await l1Conn.getAccountInfo(ata)
        if (info && info.data.length >= 72) {
          const amount = info.data.readBigUInt64LE(64)
          balances[asset.symbol] = Number(amount) / Math.pow(10, asset.decimals)
        } else {
          balances[asset.symbol] = 0
        }
      } catch {
        balances[asset.symbol] = 0
      }
    }

    setTokenBalances(balances)
  }, [publicKey])

  useEffect(() => {
    if (connected) {
      loadTokenBalances()
    }
  }, [connected, loadTokenBalances])

  // ── Load Bridge Stats ───────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    try {
      const l1Conn = getL1Connection()
      const config = await fetchBridgeConfig(l1Conn)
      if (!config) {
        setStats(null)
        return
      }

      const slot = await l1Conn.getSlot()
      const slotsSinceReset = BigInt(slot) - config.lastResetSlot
      const currentDailyVolume = slotsSinceReset > BigInt(DAILY_RESET_SLOTS)
        ? 0
        : Number(config.dailyVolume) / LAMPORTS_PER_SOL

      const dailyLimit = Number(config.dailyLimitLamports) / LAMPORTS_PER_SOL

      setStats({
        paused: config.paused,
        depositNonce: Number(config.depositNonce),
        minDeposit: Number(config.minDepositLamports) / LAMPORTS_PER_SOL,
        maxDeposit: Number(config.maxDepositLamports) / LAMPORTS_PER_SOL,
        dailyLimit,
        dailyVolume: currentDailyVolume,
        dailyRemaining: dailyLimit - currentDailyVolume,
        feeBps: Number(config.bridgeFeeBps),
        totalFeesCollected: Number(config.totalSolFeesCollected) / LAMPORTS_PER_SOL,
      })

      const vaultBalance = await fetchSolVaultBalance(l1Conn)
      setSolVaultTvl(vaultBalance / LAMPORTS_PER_SOL)

      const l2Conn = getL2Connection()
      try {
        const reserveBalance = await fetchBridgeReserveBalance(l2Conn)
        setL2ReserveBalance(reserveBalance / LAMPORTS_PER_MYTH)
      } catch { /* reserve may not exist yet */ }

      try {
        const l2Config = await fetchL2BridgeConfig(l2Conn)
        if (l2Config) setL2Paused(l2Config.paused)
      } catch { /* L2 config may not exist yet */ }
    } catch { /* silently handle */ }
  }, [])

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30_000)
    return () => clearInterval(interval)
  }, [loadStats])

  // ── Load Deposit History ──────────────────────────────────────────────────

  const loadDeposits = useCallback(async () => {
    if (!publicKey) {
      setDeposits([])
      return
    }

    try {
      const l1Conn = getL1Connection()
      const signatures = await l1Conn.getSignaturesForAddress(
        publicKey,
        { limit: 20 },
        'confirmed',
      )

      const bridgeDeposits: DepositRecord[] = []

      for (const sig of signatures) {
        try {
          const tx = await l1Conn.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          })
          if (!tx?.meta || !tx.transaction.message.accountKeys) continue

          const involvesBridge = tx.transaction.message.accountKeys.some(
            (key) => key.pubkey.equals(BRIDGE_L1_PROGRAM_ID),
          )
          if (!involvesBridge) continue

          const logs = tx.meta.logMessages || []
          for (const log of logs) {
            if (log.includes('EVENT:DepositSOL:')) {
              try {
                const jsonStr = log.split('EVENT:DepositSOL:')[1]
                const event = JSON.parse(jsonStr)
                bridgeDeposits.push({
                  signature: sig.signature,
                  amount: event.amount / LAMPORTS_PER_SOL,
                  token: 'SOL',
                  nonce: event.nonce,
                  timestamp: sig.blockTime || 0,
                  status: 'confirmed',
                })
              } catch { /* skip */ }
            }
            if (log.includes('EVENT:Deposit:')) {
              try {
                const jsonStr = log.split('EVENT:Deposit:')[1]
                const event = JSON.parse(jsonStr)
                const tokenSymbol = event.mint === '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump' ? 'MYTH'
                  : event.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC'
                  : 'TOKEN'
                const decimals = tokenSymbol === 'MYTH' || tokenSymbol === 'USDC' ? 6 : 9
                bridgeDeposits.push({
                  signature: sig.signature,
                  amount: event.amount / Math.pow(10, decimals),
                  token: tokenSymbol,
                  nonce: event.nonce,
                  timestamp: sig.blockTime || 0,
                  status: 'confirmed',
                })
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      }

      setDeposits(bridgeDeposits)
    } catch { /* silently handle */ }
  }, [publicKey])

  useEffect(() => {
    if (connected) {
      loadDeposits()
    }
  }, [connected, loadDeposits])

  // ── Calculate Fee ─────────────────────────────────────────────────────────

  const calculateFee = useCallback((amount: number): number => {
    if (!stats || amount <= 0 || stats.feeBps === 0) return 0
    // Fee is calculated on SOL-equivalent value (for SOL deposits)
    // For token deposits, fee is applied in the token's denomination
    const amountSmallest = amount * Math.pow(10, selectedAsset.decimals)
    const computed = (amountSmallest * stats.feeBps) / BPS_DENOMINATOR
    const fee = Math.max(computed, selectedAsset.symbol === 'SOL' ? MIN_FEE_LAMPORTS : 0)
    return fee / Math.pow(10, selectedAsset.decimals)
  }, [stats, selectedAsset])

  // ── Deposit SOL to L2 ────────────────────────────────────────────────────

  const depositSOL = useCallback(async (amountSol: number): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected')
    if (!stats) throw new Error('Bridge stats not loaded')

    setLoading(true)
    setError(null)
    setTxSignature(null)

    try {
      if (stats.paused) throw new Error('Bridge is currently paused')
      if (amountSol < stats.minDeposit) throw new Error(`Minimum deposit is ${stats.minDeposit} SOL`)
      if (amountSol > stats.maxDeposit) throw new Error(`Maximum deposit is ${stats.maxDeposit} SOL`)
      if (amountSol > stats.dailyRemaining) throw new Error(`Daily limit remaining: ${stats.dailyRemaining.toFixed(2)} SOL`)

      const amountLamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL))
      const l1Conn = getL1Connection()

      const tx = await buildDepositSOLTransaction(l1Conn, publicKey, amountLamports)
      const { signature } = await signAndSendTransaction(tx)

      setTxSignature(signature)
      await l1Conn.confirmTransaction(signature, 'confirmed')
      await Promise.all([loadStats(), loadDeposits(), loadTokenBalances(), refreshBalances(publicKey)])

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, stats, signAndSendTransaction, loadStats, loadDeposits, loadTokenBalances, refreshBalances])

  // ── Deposit SPL Token (MYTH / USDC) to L2 ────────────────────────────────

  const depositSPL = useCallback(async (amount: number, asset: BridgeAsset): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected')
    if (!asset.l1Mint) throw new Error('Invalid token — use depositSOL for native SOL')
    if (!stats) throw new Error('Bridge stats not loaded')

    setLoading(true)
    setError(null)
    setTxSignature(null)

    try {
      if (stats.paused) throw new Error('Bridge is currently paused')
      if (amount <= 0) throw new Error('Amount must be greater than zero')

      const userBalance = tokenBalances[asset.symbol] || 0
      if (amount > userBalance) throw new Error(`Insufficient ${asset.symbol} balance`)

      const amountSmallest = BigInt(Math.round(amount * Math.pow(10, asset.decimals)))
      const l1Conn = getL1Connection()

      const tx = await buildDepositSPLTransaction(
        l1Conn,
        publicKey,
        asset.l1Mint,
        amountSmallest,
        asset.isToken2022 || false,
      )
      const { signature } = await signAndSendTransaction(tx)

      setTxSignature(signature)
      await l1Conn.confirmTransaction(signature, 'confirmed')
      await Promise.all([loadStats(), loadDeposits(), loadTokenBalances(), refreshBalances(publicKey)])

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, stats, tokenBalances, signAndSendTransaction, loadStats, loadDeposits, loadTokenBalances, refreshBalances])

  // ── Withdraw from L2 (bridge native MYTH to L1) ────────────────────────

  const withdrawFromL2 = useCallback(async (amountMyth: number, l1Recipient?: PublicKey): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected')

    setLoading(true)
    setError(null)
    setTxSignature(null)

    try {
      if (l2Paused) throw new Error('L2 bridge is currently paused')
      if (amountMyth <= 0) throw new Error('Amount must be greater than zero')

      const amountLamports = BigInt(Math.round(amountMyth * LAMPORTS_PER_MYTH))

      if (amountLamports % BigInt(DECIMAL_SCALING_FACTOR) !== BigInt(0)) {
        throw new Error(`Amount must be divisible by ${DECIMAL_SCALING_FACTOR / LAMPORTS_PER_MYTH} MYTH for L1 compatibility`)
      }

      const l2Conn = getL2Connection()

      const tx = await buildBridgeToL1Transaction(
        l2Conn,
        publicKey,
        amountLamports,
        l1Recipient || publicKey,
      )
      const signedTx = await signTransaction(tx)
      const signature = await l2Conn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
      })

      setTxSignature(signature)
      await l2Conn.confirmTransaction(signature, 'confirmed')
      await Promise.all([loadStats(), loadDeposits(), refreshBalances(publicKey)])

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, l2Paused, signAndSendTransaction, loadStats, loadDeposits, refreshBalances])

  return {
    direction,
    setDirection,
    selectedAsset,
    setSelectedAsset,
    stats,
    l2Paused,
    loading,
    txSignature,
    error,
    deposits,
    solVaultTvl,
    tokenBalances,
    depositSOL,
    depositSPL,
    withdrawFromL2,
    calculateFee,
    clearError: () => setError(null),
    clearTx: () => setTxSignature(null),
    refreshStats: loadStats,
  }
}
