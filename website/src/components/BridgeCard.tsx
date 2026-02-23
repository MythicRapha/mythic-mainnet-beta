'use client'

import { useState, useMemo } from 'react'
import { useWalletContext } from '@/providers/WalletProvider'
import { useBridge } from '@/hooks/useBridge'

export default function BridgeCard() {
  const { connected, shortAddress, balance, l2Balance, connect, connecting } = useWalletContext()
  const {
    direction, setDirection,
    stats, l2Paused, loading, txSignature, error, deposits, solVaultTvl,
    depositSOL, calculateFee,
    clearError, clearTx,
  } = useBridge()

  const [amount, setAmount] = useState('')

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ''))
    return isNaN(n) ? 0 : n
  }, [amount])

  const fee = useMemo(() => calculateFee(parsedAmount), [calculateFee, parsedAmount])
  const receiveAmount = useMemo(() => Math.max(0, parsedAmount - fee), [parsedAmount, fee])

  const isPaused = direction === 'deposit' ? stats?.paused : l2Paused
  const fromChain = direction === 'deposit' ? 'Solana L1' : 'Mythic L2'
  const toChain = direction === 'deposit' ? 'Mythic L2' : 'Solana L1'
  const fromBalance = direction === 'deposit' ? balance : l2Balance

  const handleMax = () => {
    if (fromBalance !== null && fromBalance > 0) {
      // Reserve 0.01 for tx fees (SOL on L1, MYTH on L2)
      const max = Math.max(0, fromBalance - 0.01)
      setAmount(max.toFixed(4))
    }
  }

  const handleBridge = async () => {
    if (!connected || parsedAmount <= 0) return
    clearError()
    clearTx()
    try {
      if (direction === 'deposit') {
        await depositSOL(parsedAmount)
        setAmount('')
      }
    } catch {
      // error already set in hook
    }
  }

  const canSubmit = connected && parsedAmount > 0 && !loading && !isPaused
    && (direction === 'deposit'
      ? stats
        ? parsedAmount >= stats.minDeposit && parsedAmount <= stats.maxDeposit && parsedAmount <= stats.dailyRemaining
        : false
      : false)

  return (
    <div className="w-full max-w-lg mx-auto space-y-4">
      {/* Bridge Status Bar */}
      {stats && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#08080C] border border-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 ${isPaused ? 'bg-mythic-error' : 'bg-[#39FF14]'} ${!isPaused ? 'animate-pulse' : ''}`} />
            <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-dim">
              {isPaused ? 'Bridge Paused' : 'Bridge Active'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">TVL</span>
              <span className="font-mono text-[0.65rem] text-white">{solVaultTvl.toFixed(2)} SOL</span>
            </div>
            <div className="text-right">
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">24h Volume</span>
              <span className="font-mono text-[0.65rem] text-white">{stats.dailyVolume.toFixed(2)} SOL</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-white/[0.06]">
          <button
            onClick={() => { setDirection('deposit'); clearError(); clearTx() }}
            className={`flex-1 py-4 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium transition-colors ${
              direction === 'deposit'
                ? 'text-white border-b-2 border-mythic-violet bg-mythic-violet/5'
                : 'text-mythic-text-dim hover:text-white'
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => { setDirection('withdraw'); clearError(); clearTx() }}
            className={`flex-1 py-4 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium transition-colors ${
              direction === 'withdraw'
                ? 'text-white border-b-2 border-mythic-violet bg-mythic-violet/5'
                : 'text-mythic-text-dim hover:text-white'
            }`}
          >
            Withdraw
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* From */}
          <div className="bg-black border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">From</span>
              <span className="font-mono text-[0.55rem] tracking-[0.1em] text-mythic-text-dim">{fromChain}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">
                    {direction === 'deposit' ? 'S' : 'M'}
                  </span>
                </div>
                <span className="text-white font-medium text-[0.9rem]">{fromChain}</span>
              </div>
              {connected && fromBalance !== null && (
                <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                  Balance: {fromBalance.toFixed(4)} {direction === 'deposit' ? 'SOL' : 'MYTH'}
                </span>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center -my-1">
            <div className="w-8 h-8 bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
              <svg className="w-4 h-4 text-mythic-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>

          {/* To */}
          <div className="bg-black border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">To</span>
              <span className="font-mono text-[0.55rem] tracking-[0.1em] text-mythic-text-dim">{toChain}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center">
                <span className="text-xs font-bold text-white">
                  {direction === 'deposit' ? 'M' : 'S'}
                </span>
              </div>
              <span className="text-white font-medium text-[0.9rem]">{toChain}</span>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
              Amount ({direction === 'deposit' ? 'SOL' : 'MYTH'})
            </label>
            <div className="flex items-center gap-2 p-3 bg-black border border-white/[0.06] focus-within:border-mythic-violet/30 transition-colors">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  setAmount(v)
                  clearError()
                }}
                placeholder="0.00"
                className="flex-1 bg-transparent text-white text-lg font-display outline-none placeholder:text-white/20"
              />
              <button
                onClick={handleMax}
                className="px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] font-medium text-mythic-violet bg-mythic-violet/10 hover:bg-mythic-violet/20 transition-colors"
              >
                Max
              </button>
            </div>
          </div>

          {/* Deposit Limits */}
          {stats && direction === 'deposit' && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-black border border-white/[0.06] p-2.5 text-center">
                <span className="block font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Min</span>
                <span className="block font-mono text-[0.65rem] text-white">{stats.minDeposit} SOL</span>
              </div>
              <div className="bg-black border border-white/[0.06] p-2.5 text-center">
                <span className="block font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Max</span>
                <span className="block font-mono text-[0.65rem] text-white">{stats.maxDeposit.toLocaleString()} SOL</span>
              </div>
              <div className="bg-black border border-white/[0.06] p-2.5 text-center">
                <span className="block font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">24h Left</span>
                <span className="block font-mono text-[0.65rem] text-white">{stats.dailyRemaining.toFixed(0)} SOL</span>
              </div>
            </div>
          )}

          {/* Fee + Receive */}
          {parsedAmount > 0 && (
            <div className="space-y-1.5 px-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.6rem] text-mythic-text-dim">Bridge Fee ({stats ? stats.feeBps / 100 : 0.1}%)</span>
                <span className="font-mono text-[0.6rem] text-mythic-text-dim">{fee.toFixed(6)} {direction === 'deposit' ? 'SOL' : 'MYTH'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.6rem] text-white">You Receive</span>
                <span className="font-mono text-[0.6rem] text-white font-medium">{receiveAmount.toFixed(6)} {direction === 'deposit' ? 'MYTH' : 'SOL'}</span>
              </div>
            </div>
          )}

          {/* Challenge period warning */}
          {direction === 'withdraw' && (
            <div className="flex items-start gap-2 p-3 border-l-[3px] border-mythic-amber bg-mythic-amber/5">
              <svg className="w-4 h-4 text-mythic-amber mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-mythic-amber/90 text-[0.75rem] leading-relaxed">
                Withdrawals have a <strong>7-day challenge period</strong> before funds are released to Solana L1.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 border-l-[3px] border-mythic-error bg-mythic-error/5">
              <svg className="w-4 h-4 text-mythic-error mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <p className="text-mythic-error/90 text-[0.75rem] leading-relaxed">{error}</p>
            </div>
          )}

          {/* Success — tx signature */}
          {txSignature && (
            <div className="flex items-start gap-2 p-3 border-l-[3px] border-[#39FF14] bg-[#39FF14]/5">
              <svg className="w-4 h-4 text-[#39FF14] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-[#39FF14]/90 text-[0.75rem] font-medium mb-1">Deposit Submitted</p>
                <a
                  href={`https://explorer.mythic.sh/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[0.6rem] text-mythic-violet hover:text-mythic-violet-bright underline break-all"
                >
                  {txSignature.slice(0, 20)}...{txSignature.slice(-8)}
                </a>
              </div>
            </div>
          )}

          {/* Paused Warning */}
          {isPaused && (
            <div className="flex items-start gap-2 p-3 border-l-[3px] border-mythic-error bg-mythic-error/5">
              <svg className="w-4 h-4 text-mythic-error mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-mythic-error/90 text-[0.75rem] leading-relaxed">
                The bridge is currently <strong>paused</strong> by the admin. Deposits and withdrawals are temporarily disabled.
              </p>
            </div>
          )}

          {/* Action Button */}
          {connected ? (
            <button
              onClick={handleBridge}
              disabled={!canSubmit}
              className="w-full py-3.5 bg-mythic-violet text-white font-display text-[0.8rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing...
                </span>
              ) : direction === 'deposit' ? (
                'Deposit to Mythic L2'
              ) : (
                'Withdraw to Solana L1'
              )}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="w-full py-3.5 bg-mythic-violet text-white font-display text-[0.8rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}

          {/* Connected Wallet Info */}
          {connected && (
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[0.55rem] text-mythic-text-dim">
                Connected: {shortAddress}
              </span>
              <div className="flex items-center gap-3">
                {balance !== null && (
                  <span className="font-mono text-[0.55rem] text-mythic-text-dim">
                    L1: {balance.toFixed(4)} SOL
                  </span>
                )}
                {l2Balance !== null && (
                  <span className="font-mono text-[0.55rem] text-mythic-text-dim">
                    L2: {l2Balance.toFixed(4)} MYTH
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h3 className="font-display text-white font-medium text-[0.9rem]">
            {direction === 'deposit' ? 'Recent Deposits' : 'Pending Withdrawals'}
          </h3>
        </div>

        {direction === 'deposit' && deposits.length > 0 ? (
          <div className="divide-y divide-white/[0.04]">
            {deposits.map((d) => (
              <div key={d.signature} className="px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-1.5 h-1.5 ${
                    d.status === 'minted' ? 'bg-green-400' :
                    d.status === 'confirmed' ? 'bg-mythic-violet' :
                    'bg-mythic-amber animate-pulse'
                  }`} />
                  <div>
                    <div className="text-white text-[0.82rem]">
                      {d.amount.toFixed(4)} {d.token}
                    </div>
                    <a
                      href={`https://explorer.mythic.sh/tx/${d.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-mythic-text-dim text-[0.65rem] hover:text-mythic-violet"
                    >
                      {d.signature.slice(0, 8)}...{d.signature.slice(-4)}
                    </a>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-[0.6rem] uppercase tracking-[0.1em] font-medium ${
                    d.status === 'minted' ? 'text-green-400' :
                    d.status === 'confirmed' ? 'text-mythic-violet' :
                    'text-mythic-amber'
                  }`}>
                    {d.status === 'minted' ? 'Complete' : d.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </div>
                  {d.timestamp > 0 && (
                    <div className="font-mono text-mythic-text-muted text-[0.6rem]">
                      {formatTimeAgo(d.timestamp)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-8 text-center">
            <p className="font-mono text-[0.65rem] text-mythic-text-dim">
              {connected
                ? direction === 'deposit'
                  ? 'No deposits found for this wallet'
                  : 'Withdrawals will appear here after burning wrapped tokens on L2'
                : 'Connect wallet to view transaction history'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
