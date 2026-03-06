'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  fetchBridgeConfig,
  fetchL2BridgeConfig,
  fetchSolVaultBalance,
  fetchBridgeReserveBalance,
  deriveSolVault,
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
  L1_MYTH_MINT,
} from '@/lib/bridge-sdk'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { useWalletContext } from '@/providers/WalletProvider'

const L2_RPC = process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh'

export function useBridge() {
  const { publicKey, connected, signTransaction, refreshBalances } = useWalletContext()

  const [direction, setDirection] = useState<BridgeDirection>('deposit')
  const [selectedAsset, setSelectedAsset] = useState<BridgeAsset>(SUPPORTED_ASSETS[0]) // SOL default
  const [stats, setStats] = useState<BridgeStats | null>(null)
  const [l2Paused, setL2Paused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deposits, setDeposits] = useState<DepositRecord[]>([])
  const [globalDeposits, setGlobalDeposits] = useState<DepositRecord[]>([])
  const [solVaultTvl, setSolVaultTvl] = useState<number>(0)
  const [l2ReserveBalance, setL2ReserveBalance] = useState<number>(0)
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({})
  const [exitMode, setExitMode] = useState<'fast' | 'standard'>('fast')
  const [statsError, setStatsError] = useState<string | null>(null)

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

  // Raw RPC helper — bypasses Solana Connection class which can hang in browsers
  const rpcFetch = useCallback(async (rpcUrl: string, method: string, params: unknown[]) => {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const json = await res.json()
    if (json?.error) throw new Error(json.error.message || 'RPC error')
    return json.result
  }, [])

  const loadStats = useCallback(async () => {
    try {
      console.log('[Bridge] loadStats: starting...')
      setStatsError(null)

      const l1Rpc = typeof window !== 'undefined' ? window.location.origin + '/api/l1-rpc' : ''
      const l1Conn = getL1Connection()

      // Fetch config via raw fetch (proven reliable)
      const config = await fetchBridgeConfig(l1Conn)
      if (!config) {
        console.warn('[Bridge] loadStats: fetchBridgeConfig returned null')
        setStats(null)
        setStatsError('Bridge config account not found')
        return
      }
      console.log('[Bridge] config loaded, paused:', config.paused, 'nonce:', Number(config.depositNonce))

      // Get slot via raw fetch (bypasses Connection class)
      let slot: number
      try {
        const slotResult = await rpcFetch(l1Rpc, 'getSlot', [{ commitment: 'confirmed' }])
        slot = slotResult
      } catch (e) {
        console.warn('[Bridge] getSlot raw fetch failed, trying Connection:', e)
        slot = await l1Conn.getSlot()
      }

      const slotsSinceReset = BigInt(slot) - config.lastResetSlot
      const currentDailyVolume = slotsSinceReset > BigInt(DAILY_RESET_SLOTS)
        ? 0
        : Number(config.dailyVolume) / LAMPORTS_PER_SOL

      const dailyLimit = Number(config.dailyLimitLamports) / LAMPORTS_PER_SOL

      const newStats = {
        paused: config.paused,
        depositNonce: Number(config.depositNonce),
        minDeposit: Number(config.minDepositLamports) / LAMPORTS_PER_SOL,
        maxDeposit: Number(config.maxDepositLamports) / LAMPORTS_PER_SOL,
        dailyLimit,
        dailyVolume: currentDailyVolume,
        dailyRemaining: dailyLimit - currentDailyVolume,
        feeBps: 0, // on-chain config does not store fee bps
        totalFeesCollected: 0,
      }
      console.log('[Bridge] stats set:', JSON.stringify(newStats))
      setStats(newStats)
      setStatsError(null)

      // Non-critical: vault balance + L2 config (don't block stats)
      try {
        const vaultResult = await rpcFetch(l1Rpc, 'getBalance', [
          deriveSolVault()[0].toBase58(), { commitment: 'confirmed' },
        ])
        setSolVaultTvl((vaultResult?.value || 0) / LAMPORTS_PER_SOL)
      } catch { /* non-critical */ }

      const l2Conn = getL2Connection()
      try {
        const reserveBalance = await fetchBridgeReserveBalance(l2Conn)
        setL2ReserveBalance(reserveBalance / LAMPORTS_PER_MYTH)
      } catch { /* reserve may not exist yet */ }

      try {
        const l2Config = await fetchL2BridgeConfig(l2Conn)
        if (l2Config) setL2Paused(l2Config.paused)
      } catch { /* L2 config may not exist yet */ }
    } catch (e) {
      console.error('[Bridge] loadStats failed:', e)
      setStatsError(e instanceof Error ? e.message : String(e))
    }
  }, [rpcFetch])

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
                const mint = event.token_mint || event.mint || ''
                const tokenSymbol = mint === '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump' ? 'MYTH'
                  : mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC'
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

  // ── Load ALL Bridge Transactions (global feed, no wallet required) ─────────

  const loadGlobalDeposits = useCallback(async () => {
    try {
      const l1Conn = getL1Connection()
      // Fetch more signatures to cover failed relayer retries that dilute the results
      const signatures = await l1Conn.getSignaturesForAddress(
        BRIDGE_L1_PROGRAM_ID,
        { limit: 200 },
        'confirmed',
      )

      // Filter out failed transactions (no events to parse)
      const successSigs = signatures.filter(s => !s.err)

      const allDeposits: DepositRecord[] = []

      // Batch fetch in groups of 5 to avoid rate limits
      for (let i = 0; i < successSigs.length; i += 5) {
        const batch = successSigs.slice(i, i + 5)
        const results = await Promise.allSettled(
          batch.map(sig => l1Conn.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          }))
        )

        for (let j = 0; j < results.length; j++) {
          const result = results[j]
          if (result.status !== 'fulfilled' || !result.value) continue
          const tx = result.value
          const sig = batch[j]
          if (!tx.meta || !tx.transaction.message.accountKeys) continue

          const senderKey = tx.transaction.message.accountKeys[0]?.pubkey?.toBase58() || 'Unknown'
          const logs = tx.meta.logMessages || []

          for (const log of logs) {
            if (log.includes('EVENT:DepositSOL:')) {
              try {
                const jsonStr = log.split('EVENT:DepositSOL:')[1]
                const event = JSON.parse(jsonStr)
                allDeposits.push({
                  signature: sig.signature,
                  amount: event.amount / LAMPORTS_PER_SOL,
                  token: 'SOL',
                  nonce: event.nonce,
                  timestamp: sig.blockTime || 0,
                  status: 'confirmed',
                  sender: senderKey,
                })
              } catch { /* skip */ }
            }
            if (log.includes('EVENT:Deposit:')) {
              try {
                const jsonStr = log.split('EVENT:Deposit:')[1]
                const event = JSON.parse(jsonStr)
                const mint = event.token_mint || event.mint || ''
                const tokenSymbol = mint === '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump' ? 'MYTH'
                  : mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC'
                  : 'TOKEN'
                const decimals = tokenSymbol === 'MYTH' || tokenSymbol === 'USDC' ? 6 : 9
                allDeposits.push({
                  signature: sig.signature,
                  amount: event.amount / Math.pow(10, decimals),
                  token: tokenSymbol,
                  nonce: event.nonce,
                  timestamp: sig.blockTime || 0,
                  status: 'confirmed',
                  sender: senderKey,
                })
              } catch { /* skip */ }
            }
          }
        }
      }

      setGlobalDeposits(allDeposits)
    } catch { /* silently handle */ }
  }, [])

  useEffect(() => {
    loadGlobalDeposits()
    const interval = setInterval(loadGlobalDeposits, 15_000) // refresh every 15s
    return () => clearInterval(interval)
  }, [loadGlobalDeposits])

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

  // ── Fast Exit Constants & Helpers ──────────────────────────────────────────

  const FAST_EXIT_MAX_SOL = 10
  const FAST_EXIT_MIN_FEE_SOL = 0.001

  const fastExitEligible = useCallback((amountMyth: number): boolean => {
    // Fast exits available for withdrawals <= 10 SOL equivalent
    // Since L2 is MYTH-denominated and we approximate 1 MYTH ~ 1 lamport-value for now,
    // we use the amount in MYTH directly. In production this would use an oracle price.
    return amountMyth > 0 && amountMyth <= FAST_EXIT_MAX_SOL
  }, [])

  const calculateFastExitFee = useCallback((amountMyth: number): number => {
    if (amountMyth <= 0) return 0
    let bps: number
    if (amountMyth <= 1) bps = 30       // 0.3%
    else if (amountMyth <= 5) bps = 20  // 0.2%
    else bps = 10                        // 0.1%
    const fee = (amountMyth * bps) / 10000
    return Math.max(fee, FAST_EXIT_MIN_FEE_SOL)
  }, [])

  // ── Deposit SOL to L2 (swap SOL → MYTH on PumpSwap → bridge MYTH) ─────
  // Every SOL bridge = market buy MYTH = buying pressure + MYTH locked in PDA

  const depositSOL = useCallback(async (amountSol: number): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected')
    if (!stats) throw new Error('Bridge stats not loaded')

    setLoading(true)
    setError(null)
    setTxSignature(null)

    let sig: string | null = null

    try {
      if (stats.paused) throw new Error('Bridge is currently paused')

      const l1Conn = getL1Connection()
      const amountLamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL))

      // Single tx: deposit SOL into bridge vault, relayer credits MYTH on L2
      // Use signTransaction + manual sendRawTransaction to avoid extension RPC routing
      // issues that cause "message port closed" errors
      const tx = await buildDepositSOLTransaction(l1Conn, publicKey, amountLamports)
      const signedTx = await signTransaction(tx)
      const signature = await l1Conn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      sig = signature
      setTxSignature(signature)

      // Fire-and-forget: confirmation + refresh
      l1Conn.confirmTransaction(signature, 'confirmed').catch(() => {}).finally(() => {
        Promise.all([loadStats(), loadDeposits(), loadTokenBalances(), refreshBalances(publicKey)]).catch(() => {})
      })

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed'
      if (!sig) setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, stats, signTransaction, loadStats, loadDeposits, loadTokenBalances, refreshBalances])

  // ── Deposit SPL Token (MYTH / USDC) to L2 ────────────────────────────────

  const depositSPL = useCallback(async (amount: number, asset: BridgeAsset): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected')
    if (!asset.l1Mint) throw new Error('Invalid token — use depositSOL for native SOL')
    if (!stats) throw new Error('Bridge stats not loaded')

    setLoading(true)
    setError(null)
    setTxSignature(null)

    let sig: string | null = null

    try {
      if (stats.paused) throw new Error('Bridge is currently paused')
      if (amount <= 0) throw new Error('Amount must be greater than zero')

      const userBalance = tokenBalances[asset.symbol] || 0
      if (amount > userBalance) throw new Error(`Insufficient ${asset.symbol} balance`)

      const amountSmallest = BigInt(Math.round(amount * Math.pow(10, asset.decimals)))
      const l1Conn = getL1Connection()

      // Use signTransaction + manual sendRawTransaction to avoid extension RPC routing
      // issues that cause "message port closed" errors
      const tx = await buildDepositSPLTransaction(
        l1Conn,
        publicKey,
        asset.l1Mint,
        amountSmallest,
        asset.isToken2022 || false,
      )
      const signedTx = await signTransaction(tx)
      const signature = await l1Conn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      sig = signature
      setTxSignature(signature)

      l1Conn.confirmTransaction(signature, 'confirmed').catch(() => {}).finally(() => {
        Promise.all([loadStats(), loadDeposits(), loadTokenBalances(), refreshBalances(publicKey)]).catch(() => {})
      })

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed'
      if (!sig) setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, stats, tokenBalances, signTransaction, loadStats, loadDeposits, loadTokenBalances, refreshBalances])

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

      // Fire-and-forget: confirmation + refresh (avoids 30s timeout on L2)
      l2Conn.confirmTransaction(signature, 'confirmed').catch(() => {}).finally(() => {
        Promise.all([loadStats(), loadDeposits(), refreshBalances(publicKey)]).catch(() => {})
      })

      return signature
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [publicKey, l2Paused, signTransaction, loadStats, loadDeposits, refreshBalances])

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
    globalDeposits,
    solVaultTvl,
    tokenBalances,
    depositSOL,
    depositSPL,
    withdrawFromL2,
    calculateFee,
    statsError,
    exitMode,
    setExitMode,
    fastExitEligible,
    calculateFastExitFee,
    clearError: () => setError(null),
    clearTx: () => setTxSignature(null),
    refreshStats: loadStats,
  }
}
