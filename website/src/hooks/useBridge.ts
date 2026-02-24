'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  fetchBridgeConfig,
  fetchL2BridgeConfig,
  fetchSolVaultBalance,
  fetchBridgeReserveBalance,
  buildDepositSOLTransaction,
  buildBridgeToL1Transaction,
  BridgeStats,
  BridgeDirection,
  DepositRecord,
  DAILY_RESET_SLOTS,
  BPS_DENOMINATOR,
  MIN_FEE_LAMPORTS,
  BRIDGE_L1_PROGRAM_ID,
  DECIMAL_SCALING_FACTOR,
  LAMPORTS_PER_MYTH,
} from '@/lib/bridge-sdk'
import { useWalletContext } from '@/providers/WalletProvider'

const L1_RPC = '/api/l1-rpc'
const L2_RPC = 'https://rpc.mythic.sh'

export function useBridge() {
  const { publicKey, connected, signAndSendTransaction, refreshBalances } = useWalletContext()

  const [direction, setDirection] = useState<BridgeDirection>('deposit')
  const [stats, setStats] = useState<BridgeStats | null>(null)
  const [l2Paused, setL2Paused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deposits, setDeposits] = useState<DepositRecord[]>([])
  const [solVaultTvl, setSolVaultTvl] = useState<number>(0)
  const [l2ReserveBalance, setL2ReserveBalance] = useState<number>(0)

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

  // ── Load Bridge Stats ───────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    try {
      // Bridge programs are deployed on L2 (genesis-loaded).
      // Read config and vault from L2 where the programs exist.
      const l2Conn = getL2Connection()
      const config = await fetchBridgeConfig(l2Conn)
      if (!config) {
        setStats(null)
        return
      }

      // Check if daily volume should be reset
      const slot = await l2Conn.getSlot()
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

      // Also load TVL from L2 vault
      const vaultBalance = await fetchSolVaultBalance(l2Conn)
      setSolVaultTvl(vaultBalance / LAMPORTS_PER_SOL)

      // Load L2 bridge reserve balance
      try {
        const reserveBalance = await fetchBridgeReserveBalance(l2Conn)
        setL2ReserveBalance(reserveBalance / LAMPORTS_PER_MYTH)
      } catch {
        // reserve may not exist yet
      }

      // Check L2 bridge pause status
      try {
        const l2Config = await fetchL2BridgeConfig(l2Conn)
        if (l2Config) {
          setL2Paused(l2Config.paused)
        }
      } catch {
        // L2 config may not exist yet
      }
    } catch {
      // silently handle - UI shows loading state
    }
  }, [])

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30_000) // refresh every 30s
    return () => clearInterval(interval)
  }, [loadStats])

  // ── Load Deposit History ──────────────────────────────────────────────────

  const loadDeposits = useCallback(async () => {
    if (!publicKey) {
      setDeposits([])
      return
    }

    try {
      // Bridge programs live on L2 — query deposit history there
      const l2Conn = getL2Connection()
      const signatures = await l2Conn.getSignaturesForAddress(
        publicKey,
        { limit: 20 },
        'confirmed',
      )

      // Filter for bridge program interactions
      const bridgeDeposits: DepositRecord[] = []

      for (const sig of signatures) {
        try {
          const tx = await l2Conn.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          })
          if (!tx?.meta || !tx.transaction.message.accountKeys) continue

          const involvesBridge = tx.transaction.message.accountKeys.some(
            (key) => key.pubkey.equals(BRIDGE_L1_PROGRAM_ID),
          )
          if (!involvesBridge) continue

          // Parse the log messages for deposit events
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
              } catch { /* skip parse errors */ }
            }
          }
        } catch { /* skip individual tx errors */ }
      }

      setDeposits(bridgeDeposits)
    } catch {
      // silently handle - UI shows empty state
    }
  }, [publicKey])

  useEffect(() => {
    if (connected) {
      loadDeposits()
    }
  }, [connected, loadDeposits])

  // ── Calculate Fee ─────────────────────────────────────────────────────────

  const calculateFee = useCallback((amountSol: number): number => {
    if (!stats || amountSol <= 0) return 0
    const amountLamports = amountSol * LAMPORTS_PER_SOL
    const computed = (amountLamports * stats.feeBps) / BPS_DENOMINATOR
    const fee = Math.max(computed, MIN_FEE_LAMPORTS)
    return fee / LAMPORTS_PER_SOL
  }, [stats])

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
      // Bridge programs are on L2 — build and send deposit TX there
      const l2Conn = getL2Connection()

      const tx = await buildDepositSOLTransaction(l2Conn, publicKey, amountLamports)
      const { signature } = await signAndSendTransaction(tx)

      setTxSignature(signature)

      // Wait for confirmation on L2
      await l2Conn.confirmTransaction(signature, 'confirmed')

      // Refresh
      await Promise.all([loadStats(), loadDeposits(), refreshBalances(publicKey)])

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, stats, signAndSendTransaction, loadStats, loadDeposits, refreshBalances])

  // ── Withdraw from L2 (bridge native MYTH to L1) ────────────────────────────
  // User sends native MYTH to the bridge reserve PDA on L2.
  // The relayer watches for EVENT:BridgeToL1 and initiates
  // a withdrawal on L1 after observing the event.

  const withdrawFromL2 = useCallback(async (amountMyth: number, l1Recipient?: PublicKey): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected')

    setLoading(true)
    setError(null)
    setTxSignature(null)

    try {
      if (l2Paused) throw new Error('L2 bridge is currently paused')
      if (amountMyth <= 0) throw new Error('Amount must be greater than zero')

      const amountLamports = BigInt(Math.round(amountMyth * LAMPORTS_PER_MYTH))

      // Validate divisibility for L2→L1 decimal alignment
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
      const { signature } = await signAndSendTransaction(tx)

      setTxSignature(signature)

      // Wait for confirmation on L2
      await l2Conn.confirmTransaction(signature, 'confirmed')

      // Refresh
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
    stats,
    l2Paused,
    loading,
    txSignature,
    error,
    deposits,
    solVaultTvl,
    depositSOL,
    withdrawFromL2,
    calculateFee,
    clearError: () => setError(null),
    clearTx: () => setTxSignature(null),
    refreshStats: loadStats,
  }
}
