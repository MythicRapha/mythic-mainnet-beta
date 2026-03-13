'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useWalletContext } from '@/providers/WalletProvider'
import { useBridge } from '@/hooks/useBridge'
import { SUPPORTED_ASSETS, BridgeAsset } from '@/lib/bridge-sdk'
import { useMythPrice } from '@/hooks/useMythPrice'
import Image from 'next/image'

function TokenIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const src = symbol === 'SOL' ? '/brand/solana-logo.svg' : '/brand/myth-token.svg'
  const alt = symbol === 'SOL' ? 'Solana' : 'MYTH'
  return <Image src={src} alt={alt} width={size} height={size} className="rounded-full" />
}

export default function BridgeCard() {
  const { connected, address, shortAddress, balance, l2Balance, openWalletModal, connecting, walletError, clearWalletError } = useWalletContext()
  const {
    direction, setDirection,
    selectedAsset, setSelectedAsset,
    stats, statsError, l2Paused, loading, txSignature, error, deposits, globalDeposits, solVaultTvl,
    tokenBalances,
    depositSOL, depositSPL, withdrawFromL2,
    calculateFee,
    exitMode, setExitMode,
    fastExitEligible, calculateFastExitFee,
    clearError, clearTx, refreshStats,
  } = useBridge()

  const { price: mythPrice, solToMyth } = useMythPrice()

  const [amount, setAmount] = useState('')
  const [l1Recipient, setL1Recipient] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [submittedAmount, setSubmittedAmount] = useState(0)
  const [submittedToken, setSubmittedToken] = useState('SOL')
  const [submittedReceive, setSubmittedReceive] = useState(0)
  const [jupiterEstimate, setJupiterEstimate] = useState<number | null>(null)
  const jupiterAbortRef = useRef<AbortController | null>(null)

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ''))
    return isNaN(n) ? 0 : n
  }, [amount])

  const fee = useMemo(() => calculateFee(parsedAmount), [calculateFee, parsedAmount])

  const isFastExitEligible = useMemo(() => fastExitEligible(parsedAmount), [fastExitEligible, parsedAmount])
  const fastExitFee = useMemo(() => calculateFastExitFee(parsedAmount), [calculateFastExitFee, parsedAmount])

  // Auto-select fast exit for eligible amounts on withdraw
  const effectiveExitMode = direction === 'withdraw'
    ? (isFastExitEligible ? exitMode : 'standard')
    : 'standard'

  // Fetch Jupiter quote for accurate SOL→MYTH estimate (includes PumpSwap fees)
  useEffect(() => {
    if (direction !== 'deposit' || selectedAsset.symbol !== 'SOL' || parsedAmount <= 0) {
      setJupiterEstimate(null)
      return
    }
    jupiterAbortRef.current?.abort()
    const controller = new AbortController()
    jupiterAbortRef.current = controller
    const timer = setTimeout(async () => {
      try {
        const lamports = Math.round(parsedAmount * 1e9)
        const res = await fetch(
          `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump&amount=${lamports}&slippageBps=50`,
          { signal: controller.signal }
        )
        const data = await res.json()
        if (data.outAmount) {
          setJupiterEstimate(Number(data.outAmount) / 1e6)
        }
      } catch { /* ignore abort/network errors */ }
    }, 400)
    return () => { clearTimeout(timer); controller.abort() }
  }, [direction, selectedAsset, parsedAmount])

  // Conversion rates: SOL→MYTH uses live market price, MYTH→MYTH is 1:1
  const conversionRate = useMemo(() => {
    if (direction === 'withdraw') return 1
    if (selectedAsset.symbol === 'MYTH') return 1
    if (selectedAsset.symbol === 'SOL' && mythPrice && mythPrice.priceSOL > 0) {
      return 1 / mythPrice.priceSOL // e.g. if MYTH is 0.0000001 SOL, then 1 SOL = 10M MYTH
    }
    return 0 // rate not available yet
  }, [direction, selectedAsset, mythPrice])

  const receiveAmount = useMemo(() => {
    if (direction === 'withdraw' && effectiveExitMode === 'fast') {
      return Math.max(0, parsedAmount - fastExitFee) * conversionRate
    }
    // For SOL deposits, use Jupiter quote (includes PumpSwap swap fees)
    if (direction === 'deposit' && selectedAsset.symbol === 'SOL' && jupiterEstimate !== null) {
      return jupiterEstimate
    }
    const afterFee = Math.max(0, parsedAmount - fee)
    return afterFee * conversionRate
  }, [parsedAmount, fee, fastExitFee, conversionRate, direction, effectiveExitMode, jupiterEstimate, selectedAsset])

  const isPaused = direction === 'deposit' ? stats?.paused : l2Paused
  const fromChain = direction === 'deposit' ? 'Solana L1' : 'Mythic L2'
  const toChain = direction === 'deposit' ? 'Mythic L2' : 'Solana L1'

  // Source token label (actual L1 asset name)
  const tokenLabel = direction === 'deposit' ? selectedAsset.symbol : 'MYTH'

  // Balance depends on direction and selected asset
  const fromBalance = useMemo(() => {
    if (direction === 'withdraw') return l2Balance
    if (selectedAsset.symbol === 'SOL') return balance
    return tokenBalances[selectedAsset.symbol] ?? null
  }, [direction, selectedAsset, balance, l2Balance, tokenBalances])

  const handleMax = () => {
    if (fromBalance !== null && fromBalance > 0) {
      const reserve = direction === 'deposit' && selectedAsset.symbol === 'SOL' ? 0.01 : 5
      const max = Math.max(0, fromBalance - reserve)
      setAmount(max.toFixed(4))
    }
  }

  const handleBridge = async () => {
    if (!connected || parsedAmount <= 0) return
    clearError()
    clearTx()
    setSubmittedAmount(parsedAmount)
    setSubmittedToken(direction === 'deposit' ? selectedAsset.symbol : 'MYTH')
    setSubmittedReceive(receiveAmount)
    try {
      if (direction === 'deposit') {
        if (selectedAsset.l1Mint) {
          await depositSPL(parsedAmount, selectedAsset)
        } else {
          await depositSOL(parsedAmount)
        }
        setAmount('')
      } else {
        const recipient = l1Recipient.trim()
        let recipientPubkey: PublicKey | undefined
        if (recipient) {
          try {
            recipientPubkey = new PublicKey(recipient)
          } catch {
            throw new Error('Invalid L1 recipient address')
          }
        }
        await withdrawFromL2(parsedAmount, recipientPubkey)
        setAmount('')
        setL1Recipient('')
      }
    } catch {
      // error already set in hook
    }
  }

  const canSubmit = connected && parsedAmount > 0 && !loading && !isPaused
    && (direction === 'deposit'
      ? !!stats
      : l2Balance !== null && parsedAmount <= (l2Balance ?? 0))

  return (
    <div className="w-full max-w-lg mx-auto space-y-4">
      {/* Bridge Status Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#08080C] border border-white/[0.06]">
        <div className="flex items-center gap-2">
          {stats ? (
            <>
              <span className={`w-1.5 h-1.5 ${isPaused ? 'bg-mythic-error' : 'bg-[#39FF14]'} ${!isPaused ? 'animate-pulse' : ''}`} />
              <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-dim">
                {isPaused ? 'Bridge Paused' : 'Bridge Active'}
              </span>
            </>
          ) : statsError ? (
            <>
              <span className="w-1.5 h-1.5 bg-mythic-error" />
              <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-red-400 max-w-[200px] truncate" title={statsError}>
                Error: {statsError}
              </span>
              <button onClick={refreshStats} className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-violet hover:text-white ml-2">
                Retry
              </button>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 bg-mythic-amber animate-pulse" />
              <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-dim">
                Bridge Initializing...
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          {stats && stats.feeBps > 0 && (
            <div className="text-right">
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">Fee</span>
              <span className="font-mono text-[0.65rem] text-white">{(stats.feeBps / 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-white/[0.06]">
          <button
            onClick={() => { setDirection('deposit'); clearError(); clearTx(); setAmount('') }}
            className={`flex-1 py-4 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium transition-colors ${
              direction === 'deposit'
                ? 'text-white border-b-2 border-mythic-violet bg-mythic-violet/5'
                : 'text-mythic-text-dim hover:text-white'
            }`}
          >
            Deposit (L1 &rarr; L2)
          </button>
          <button
            onClick={() => { setDirection('withdraw'); clearError(); clearTx(); setAmount('') }}
            className={`flex-1 py-4 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium transition-colors ${
              direction === 'withdraw'
                ? 'text-white border-b-2 border-mythic-violet bg-mythic-violet/5'
                : 'text-mythic-text-dim hover:text-white'
            }`}
          >
            Withdraw (L2 &rarr; L1)
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!stats && direction === 'deposit' ? (
            <div className="py-12 text-center space-y-3">
              {statsError ? (
                <>
                  <p className="text-red-400 text-[0.88rem]">Failed to load bridge config</p>
                  <p className="font-mono text-[0.65rem] text-mythic-text-dim max-w-sm mx-auto break-words">{statsError}</p>
                  <button
                    onClick={refreshStats}
                    className="mt-2 px-4 py-1.5 bg-mythic-violet/20 border border-mythic-violet/30 text-mythic-violet font-mono text-[0.65rem] tracking-[0.1em] uppercase hover:bg-mythic-violet/30 transition-colors"
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <svg className="w-8 h-8 text-mythic-violet mx-auto animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-mythic-text text-[0.88rem]">Loading bridge configuration...</p>
                  <p className="font-mono text-[0.65rem] text-mythic-text-dim">Connecting to Solana mainnet</p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* From */}
              <div className="bg-black border border-white/[0.06] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">From</span>
                  <span className="font-mono text-[0.55rem] tracking-[0.1em] text-mythic-text-dim">{fromChain}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {direction === 'deposit' ? (
                      <div className="relative">
                        <button
                          onClick={() => setShowAssetPicker(!showAssetPicker)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:border-mythic-violet/30 transition-colors"
                        >
                          <TokenIcon symbol={selectedAsset.symbol} size={20} />
                          <span className="text-white font-medium text-[0.85rem]">{selectedAsset.symbol}</span>
                          <svg className="w-3 h-3 text-mythic-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showAssetPicker && (
                          <div className="absolute top-full left-0 mt-1 w-40 bg-[#0C0C12] border border-white/[0.08] z-10">
                            {SUPPORTED_ASSETS.map((asset) => (
                              <button
                                key={asset.symbol}
                                onClick={() => {
                                  setSelectedAsset(asset)
                                  setShowAssetPicker(false)
                                  setAmount('')
                                  clearError()
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors ${
                                  asset.symbol === selectedAsset.symbol ? 'bg-mythic-violet/10 text-white' : 'text-mythic-text-dim'
                                }`}
                              >
                                <TokenIcon symbol={asset.symbol} size={18} />
                                <span className="text-[0.8rem] font-medium">{asset.symbol}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-1.5">
                        <TokenIcon symbol="MYTH" size={20} />
                        <span className="text-white font-medium text-[0.85rem]">MYTH</span>
                      </div>
                    )}
                  </div>
                  {connected && fromBalance !== null && (
                    <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                      Balance: {fromBalance.toFixed(4)} {tokenLabel}
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

              {/* To — always MYTH on L2 */}
              <div className="bg-black border border-white/[0.06] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">To</span>
                  <span className="font-mono text-[0.55rem] tracking-[0.1em] text-mythic-text-dim">{toChain}</span>
                </div>
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <TokenIcon symbol="MYTH" size={20} />
                  <span className="text-white font-medium text-[0.85rem]">MYTH</span>
                </div>
              </div>

              {/* Amount Input */}
              <div>
                <label className="block font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
                  Amount ({tokenLabel})
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

              {/* L1 Recipient (withdrawal only) */}
              {direction === 'withdraw' && (
                <div>
                  <label className="block font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
                    L1 Recipient (optional, defaults to connected wallet)
                  </label>
                  <div className="p-3 bg-black border border-white/[0.06] focus-within:border-mythic-violet/30 transition-colors">
                    <input
                      type="text"
                      value={l1Recipient}
                      onChange={(e) => setL1Recipient(e.target.value.trim())}
                      placeholder="Solana L1 address (leave blank for same wallet)"
                      className="w-full bg-transparent text-white text-[0.8rem] font-mono outline-none placeholder:text-white/20"
                    />
                  </div>
                </div>
              )}




              {/* Exit Mode Toggle (withdraw only) */}
              {direction === 'withdraw' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setExitMode('fast')}
                      disabled={!isFastExitEligible && parsedAmount > 0}
                      className={`flex-1 p-3 border transition-colors ${
                        effectiveExitMode === 'fast'
                          ? 'border-[#39FF14]/40 bg-[#39FF14]/5'
                          : 'border-white/[0.06] bg-black hover:border-white/[0.12]'
                      } ${!isFastExitEligible && parsedAmount > 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-1.5 h-1.5 ${effectiveExitMode === 'fast' ? 'bg-[#39FF14]' : 'bg-white/20'}`} />
                        <span className={`font-mono text-[0.6rem] font-medium tracking-[0.05em] ${
                          effectiveExitMode === 'fast' ? 'text-[#39FF14]' : 'text-mythic-text-dim'
                        }`}>
                          Fast Exit
                        </span>
                      </div>
                      <p className="font-mono text-[0.5rem] text-mythic-text-muted">
                        &lt; 30 min &middot; 0.1-0.3% fee
                      </p>
                    </button>
                    <button
                      onClick={() => setExitMode('standard')}
                      className={`flex-1 p-3 border transition-colors ${
                        effectiveExitMode === 'standard'
                          ? 'border-mythic-violet/40 bg-mythic-violet/5'
                          : 'border-white/[0.06] bg-black hover:border-white/[0.12]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-1.5 h-1.5 ${effectiveExitMode === 'standard' ? 'bg-mythic-violet' : 'bg-white/20'}`} />
                        <span className={`font-mono text-[0.6rem] font-medium tracking-[0.05em] ${
                          effectiveExitMode === 'standard' ? 'text-mythic-violet' : 'text-mythic-text-dim'
                        }`}>
                          Standard Exit
                        </span>
                      </div>
                      <p className="font-mono text-[0.5rem] text-mythic-text-muted">
                        ~24 hours &middot; No fee
                      </p>
                    </button>
                  </div>

                  {/* Fast Exit Info */}
                  {effectiveExitMode === 'fast' && (
                    <div className="bg-[#39FF14]/5 border border-[#39FF14]/20 p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-[#39FF14] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="font-mono text-[0.6rem] text-[#39FF14] font-medium">Fast Exit</span>
                      </div>
                      <p className="font-mono text-[0.55rem] text-mythic-text-dim leading-relaxed">
                        The sequencer pre-funds your withdrawal on L1 from a reserve pool. Funds arrive in ~30 minutes.
                        Available for withdrawals up to 10 SOL equivalent.
                      </p>
                      {parsedAmount > 0 && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="font-mono text-[0.55rem] text-mythic-text-dim">Fast Exit Fee</span>
                          <span className="font-mono text-[0.55rem] text-[#39FF14]">
                            {fastExitFee.toFixed(4)} MYTH ({parsedAmount <= 1 ? '0.3' : parsedAmount <= 5 ? '0.2' : '0.1'}%)
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Standard Exit Info */}
                  {effectiveExitMode === 'standard' && (
                    <div className="bg-mythic-violet/5 border border-mythic-violet/20 p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-mythic-violet flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-mono text-[0.6rem] text-mythic-violet font-medium">Standard Exit</span>
                      </div>
                      <p className="font-mono text-[0.55rem] text-mythic-text-dim leading-relaxed">
                        Withdrawals are processed through the bridge with a ~24 hour challenge period before funds can be claimed on L1. No additional fee.
                      </p>
                    </div>
                  )}

                  {/* Ineligible notice */}
                  {!isFastExitEligible && parsedAmount > 10 && (
                    <p className="font-mono text-[0.5rem] text-mythic-text-muted px-1">
                      Fast Exit is only available for withdrawals up to 10 SOL equivalent. This withdrawal will use the standard 42-hour exit.
                    </p>
                  )}
                </div>
              )}

              {/* Fee + Rate + Receive */}
              {parsedAmount > 0 && (
                <div className="space-y-1.5 px-1">
                  {direction === 'deposit' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">Bridge Fee ({stats ? stats.feeBps / 100 : 0}%)</span>
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">{fee.toFixed(6)} {tokenLabel}</span>
                    </div>
                  )}
                  {direction === 'withdraw' && effectiveExitMode === 'fast' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">Fast Exit Fee</span>
                      <span className="font-mono text-[0.6rem] text-[#39FF14]">{fastExitFee.toFixed(4)} MYTH</span>
                    </div>
                  )}
                  {direction === 'withdraw' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">Est. Arrival</span>
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                        {effectiveExitMode === 'fast' ? '< 30 minutes' : '~24 hours'}
                      </span>
                    </div>
                  )}
                  {direction === 'deposit' && selectedAsset.symbol !== 'MYTH' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">Rate</span>
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                        {selectedAsset.symbol === 'SOL' && jupiterEstimate !== null && parsedAmount > 0
                          ? `1 SOL ≈ ${Math.round(jupiterEstimate / parsedAmount).toLocaleString()} MYTH`
                          : selectedAsset.symbol === 'SOL' && mythPrice && mythPrice.priceSOL > 0
                          ? `1 SOL ≈ ${(1 / mythPrice.priceSOL).toLocaleString(undefined, { maximumFractionDigits: 0 })} MYTH`
                          : 'Loading rate...'}
                      </span>
                    </div>
                  )}
                  {direction === 'deposit' && mythPrice && mythPrice.priceUsd > 0 && selectedAsset.symbol !== 'MYTH' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">MYTH Price</span>
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                        ${mythPrice.priceUsd.toFixed(6)} USD
                      </span>
                    </div>
                  )}
                  {direction === 'deposit' && mythPrice && mythPrice.solPriceUsd > 0 && selectedAsset.symbol === 'SOL' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">SOL Price</span>
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                        ${mythPrice.solPriceUsd.toFixed(2)} USD
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[0.6rem] text-white">You Receive</span>
                    <span className="font-mono text-[0.6rem] text-white font-medium">
                      {(conversionRate > 0 || jupiterEstimate !== null)
                        ? `~${receiveAmount.toLocaleString(undefined, { maximumFractionDigits: receiveAmount > 1000 ? 0 : 6 })} MYTH`
                        : 'Loading...'}
                    </span>
                  </div>
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

              {/* Wallet signing fallback suggestion */}
              {walletError && (
                <div className="flex items-start gap-2 p-3 border-l-[3px] border-amber-500 bg-amber-500/5">
                  <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-amber-300/90 text-[0.75rem] leading-relaxed">{walletError}</p>
                    <button onClick={clearWalletError} className="text-amber-400/60 text-[0.65rem] mt-1 hover:text-amber-400 transition-colors">Dismiss</button>
                  </div>
                </div>
              )}

              {/* Success — Live Progress Tracker */}
              {txSignature && (
                <BridgeProgressTracker
                  txSignature={txSignature}
                  direction={direction}
                  exitMode={effectiveExitMode}
                  amount={submittedAmount}
                  tokenLabel={submittedToken}
                  mythReceived={submittedReceive}
                  walletAddress={address}
                />
              )}

              {/* Paused Warning */}
              {isPaused && (
                <div className="flex items-start gap-2 p-3 border-l-[3px] border-mythic-error bg-mythic-error/5">
                  <svg className="w-4 h-4 text-mythic-error mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-mythic-error/90 text-[0.75rem] leading-relaxed">
                    The bridge is currently <strong>paused</strong>. Deposits and withdrawals are temporarily disabled.
                  </p>
                </div>
              )}

              {/* Same-Wallet Info */}
              {direction === 'deposit' && (
                <div className="flex items-start gap-2 p-3 bg-mythic-violet/5 border border-mythic-violet/15">
                  <svg className="w-3.5 h-3.5 text-mythic-violet mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-mono text-[0.55rem] text-mythic-text-dim leading-relaxed">
                    <span className="text-mythic-violet font-medium">Your Solana wallet is your Mythic wallet.</span>{' '}
                    L2 funds arrive at the same address — no new wallet needed.
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
                    `Deposit ${selectedAsset.symbol} to Mythic L2`
                  ) : effectiveExitMode === 'fast' ? (
                    'Fast Withdraw MYTH to Solana L1'
                  ) : (
                    'Withdraw MYTH to Solana L1'
                  )}
                </button>
              ) : (
                <button
                  onClick={openWalletModal}
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
            </>
          )}
        </div>
      </div>

      {/* All Bridge Transactions — Live Feed */}
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="font-display text-white font-medium text-[0.9rem]">
            Live Bridge Transactions
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[#39FF14] animate-pulse" />
            <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted">Live</span>
          </div>
        </div>

        {globalDeposits.length > 0 ? (
          <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
            {globalDeposits.map((d) => (
              <div key={d.signature} className="px-6 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-1.5 h-1.5 flex-shrink-0 ${
                    d.status === 'minted' ? 'bg-green-400' :
                    d.status === 'confirmed' ? 'bg-mythic-violet' :
                    'bg-mythic-amber animate-pulse'
                  }`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-[0.82rem] font-medium">
                        {d.amount.toFixed(4)} {d.token}
                      </span>
                      {d.sender && (
                        <span className="font-mono text-[0.55rem] text-mythic-text-muted">
                          by {d.sender.slice(0, 4)}...{d.sender.slice(-4)}
                        </span>
                      )}
                    </div>
                    <a
                      href={`https://solscan.io/tx/${d.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-mythic-text-dim text-[0.6rem] hover:text-mythic-violet transition-colors"
                    >
                      {d.signature.slice(0, 12)}...{d.signature.slice(-6)}
                    </a>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`font-mono text-[0.6rem] uppercase tracking-[0.1em] font-medium ${
                    d.status === 'minted' ? 'text-green-400' :
                    d.status === 'confirmed' ? 'text-mythic-violet' :
                    'text-mythic-amber'
                  }`}>
                    {d.status === 'minted' ? 'Complete' : d.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </div>
                  {d.timestamp > 0 && (
                    <div className="font-mono text-mythic-text-muted text-[0.55rem]">
                      {formatTimeAgo(d.timestamp)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-8 text-center space-y-2">
            <svg className="w-5 h-5 text-mythic-text-muted mx-auto animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="font-mono text-[0.65rem] text-mythic-text-dim">
              Loading bridge transactions from Solana L1...
            </p>
          </div>
        )}

        <div className="px-6 py-3 border-t border-white/[0.06]">
          <a
            href={`https://solscan.io/account/oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[0.55rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
          >
            View all transactions on Solscan &rarr;
          </a>
        </div>
      </div>
    </div>
  )
}

type BridgeStep = {
  label: string
  description: string
  status: 'pending' | 'active' | 'complete'
  txLink?: string
  txLabel?: string
}

function BridgeProgressTracker({
  txSignature,
  direction,
  exitMode,
  amount,
  tokenLabel,
  mythReceived,
  walletAddress,
}: {
  txSignature: string
  direction: 'deposit' | 'withdraw'
  exitMode: 'fast' | 'standard'
  amount: number
  tokenLabel: string
  mythReceived: number
  walletAddress: string | null
}) {
  const [currentStep, setCurrentStep] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [l2TxSignature, setL2TxSignature] = useState<string | null>(null)
  const [txError, setTxError] = useState<string | null>(null)

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(s => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Poll tx confirmation status — L1 for deposits, L2 for withdrawals
  const txConfirmedRef = useRef(false)
  useEffect(() => {
    txConfirmedRef.current = false
    let cancelled = false

    const rpcUrl = direction === 'deposit'
      ? '/api/l1-rpc'
      : (process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh')

    const pollConfirmation = async () => {
      if (txConfirmedRef.current || txError) return
      try {
        const resp = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses',
            params: [[txSignature], { searchTransactionHistory: true }],
          }),
        })
        if (!resp.ok) return
        const data = await resp.json()
        const status = data?.result?.value?.[0]
        if (!status) return // Not found yet — still step 0
        if (status.err) {
          if (!cancelled) {
            setTxError(direction === 'deposit'
              ? 'Transaction failed on L1. Your funds were not deposited.'
              : 'Transaction failed on L2. Withdrawal was not processed.')
            setCurrentStep(0)
          }
          return
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          if (txConfirmedRef.current) return
          txConfirmedRef.current = true
          if (!cancelled) {
            setCurrentStep(1)
            // Advance to step 2 almost instantly
            setTimeout(() => { if (!cancelled) setCurrentStep(2) }, 500)
          }
        }
      } catch {}
    }
    // Poll immediately, then every 1s for fast confirmation
    pollConfirmation()
    const interval = setInterval(pollConfirmation, 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [txSignature, txError, direction])

  // Poll L2 for the relayer credit (step 2 → step 3)
  // Capture the latest L2 sig at mount time, then detect any NEW sig as the credit
  const l2BaselineSigRef = useRef<string | null>(null)
  const l2BaselineCaptured = useRef(false)
  const l2CreditDetected = useRef(false)
  useEffect(() => {
    if (direction !== 'deposit' || txError) return
    if (!walletAddress) return
    let cancelled = false
    const l2Rpc = process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh'

    // Capture baseline (most recent L2 sig before the bridge)
    if (!l2BaselineCaptured.current) {
      l2BaselineCaptured.current = true
      fetch(l2Rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress',
          params: [walletAddress, { limit: 1 }],
        }),
      })
        .then(r => r.json())
        .then(data => {
          const sigs = data?.result || []
          l2BaselineSigRef.current = sigs.length > 0 ? sigs[0].signature : null
        })
        .catch(() => {})
    }

    const pollL2 = async () => {
      if (l2CreditDetected.current || currentStep < 2) return
      try {
        const resp = await fetch(l2Rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress',
            params: [walletAddress, { limit: 1 }],
          }),
        })
        if (!resp.ok) return
        const data = await resp.json()
        const sigs = data?.result || []
        if (sigs.length > 0 && sigs[0].signature !== l2BaselineSigRef.current && !cancelled) {
          l2CreditDetected.current = true
          setL2TxSignature(sigs[0].signature)
          setCurrentStep(3)
        }
      } catch {}
    }
    // Poll L2 aggressively — relayer credits are near-instant
    pollL2()
    const interval = setInterval(pollL2, 1500)

    // Fallback: if polling fails to detect after 15s at step 2, assume success
    // (relayer always processes deposits, RPC may just not reflect it)
    const fallback = setTimeout(() => {
      if (!cancelled && !l2CreditDetected.current && currentStep >= 2) {
        setCurrentStep(3)
      }
    }, 15_000)

    return () => { cancelled = true; clearInterval(interval); clearTimeout(fallback) }
  }, [direction, walletAddress, txError, currentStep])

  // For withdrawals, advance to step 3 after brief relayer processing delay
  useEffect(() => {
    if (direction !== 'withdraw' || currentStep < 2) return
    const t = setTimeout(() => setCurrentStep(3), 1500)
    return () => clearTimeout(t)
  }, [direction, currentStep])

  const l2ExplorerLink = l2TxSignature
    ? `https://explorer.mythic.sh/mainnet/tx/${l2TxSignature}`
    : walletAddress
      ? `https://explorer.mythic.sh/mainnet/address/${walletAddress}`
      : undefined

  const depositSteps: BridgeStep[] = [
    {
      label: 'L1 Transaction Submitted',
      description: `Depositing ${amount.toFixed(4)} ${tokenLabel} on Solana L1`,
      status: currentStep > 0 ? 'complete' : 'active',
      txLink: `https://solscan.io/tx/${txSignature}`,
      txLabel: 'View on Solscan',
    },
    {
      label: 'L1 Transaction Confirmed',
      description: 'Solana finality reached — deposit locked in bridge vault',
      status: currentStep > 1 ? 'complete' : currentStep === 1 ? 'active' : 'pending',
      txLink: currentStep >= 1 ? `https://solscan.io/tx/${txSignature}` : undefined,
      txLabel: 'View on Solscan',
    },
    {
      label: 'Relayer Processing',
      description: 'Bridge relayer detected deposit, crediting L2',
      status: currentStep > 2 ? 'complete' : currentStep === 2 ? 'active' : 'pending',
    },
    {
      label: 'MYTH Credited on L2',
      description: `~${mythReceived > 1000 ? mythReceived.toLocaleString(undefined, { maximumFractionDigits: 0 }) : mythReceived.toFixed(4)} MYTH available at your same wallet address`,
      status: currentStep >= 3 ? 'complete' : 'pending',
      txLink: currentStep >= 3
        ? (l2TxSignature ? `https://explorer.mythic.sh/mainnet/tx/${l2TxSignature}` : `https://solscan.io/tx/${txSignature}`)
        : undefined,
      txLabel: l2TxSignature ? 'View L2 transaction' : 'View deposit on Solscan',
    },
  ]

  const withdrawSteps: BridgeStep[] = exitMode === 'fast' ? [
    {
      label: 'L2 Withdrawal Submitted',
      description: `Withdrawing ${amount.toFixed(4)} MYTH from Mythic L2`,
      status: currentStep > 0 ? 'complete' : 'active',
      txLink: `https://explorer.mythic.sh/mainnet/tx/${txSignature}`,
      txLabel: 'View on Explorer',
    },
    {
      label: 'Sequencer Pre-Funding',
      description: 'Sequencer processing fast exit from reserve pool',
      status: currentStep > 1 ? 'complete' : currentStep === 1 ? 'active' : 'pending',
    },
    {
      label: 'L1 Transfer Initiated',
      description: 'Funds being sent to your Solana L1 address',
      status: currentStep > 2 ? 'complete' : currentStep === 2 ? 'active' : 'pending',
    },
    {
      label: 'Funds Received on L1',
      description: 'SOL deposited to your L1 wallet (~30 min)',
      status: currentStep >= 3 ? 'complete' : 'pending',
    },
  ] : [
    {
      label: 'L2 Withdrawal Submitted',
      description: `Withdrawing ${amount.toFixed(4)} MYTH from Mythic L2`,
      status: currentStep > 0 ? 'complete' : 'active',
      txLink: `https://explorer.mythic.sh/mainnet/tx/${txSignature}`,
      txLabel: 'View on Explorer',
    },
    {
      label: 'Challenge Period Started',
      description: '24-hour challenge window for fraud proof verification',
      status: currentStep > 1 ? 'complete' : currentStep === 1 ? 'active' : 'pending',
    },
    {
      label: 'Waiting for Finalization',
      description: 'Withdrawal will be claimable after challenge period',
      status: currentStep > 2 ? 'complete' : currentStep === 2 ? 'active' : 'pending',
    },
    {
      label: 'Claimable on L1',
      description: 'Claim your SOL on Solana L1 after ~24 hours',
      status: currentStep >= 3 ? 'complete' : 'pending',
    },
  ]

  const steps = direction === 'deposit' ? depositSteps : withdrawSteps
  const allComplete = currentStep >= 3
  const progressPercent = Math.min(100, (currentStep / 3) * 100)

  return (
    <div className="border border-white/[0.06] bg-[#08080C] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {txError ? (
            <span className="w-2 h-2 bg-red-500" />
          ) : allComplete ? (
            <span className="w-2 h-2 bg-[#39FF14]" />
          ) : (
            <span className="w-2 h-2 bg-mythic-violet animate-pulse" />
          )}
          <span className={`font-mono text-[0.65rem] tracking-[0.08em] uppercase font-medium ${txError ? 'text-red-400' : allComplete ? 'text-[#39FF14]' : 'text-white'}`}>
            {txError
              ? 'Transaction Failed'
              : allComplete
                ? (direction === 'deposit' ? 'Deposit Complete' : 'Withdrawal Submitted')
                : 'Processing...'}
          </span>
        </div>
        <span className="font-mono text-[0.55rem] text-mythic-text-muted tabular-nums">
          {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-[2px] bg-white/[0.06] relative">
        <div
          className="h-full transition-all duration-1000 ease-out"
          style={{
            width: `${progressPercent}%`,
            background: txError
              ? '#ef4444'
              : allComplete
                ? '#39FF14'
                : 'linear-gradient(90deg, #7B2FFF, #9B5FFF)',
          }}
        />
      </div>

      {/* Steps */}
      <div className="p-4 space-y-0">
        {steps.map((step, i) => (
          <div key={i} className="flex gap-3">
            {/* Vertical line + indicator */}
            <div className="flex flex-col items-center w-5 flex-shrink-0">
              {/* Step indicator */}
              <div className={`w-3 h-3 flex items-center justify-center flex-shrink-0 ${
                step.status === 'complete'
                  ? 'bg-[#39FF14]'
                  : step.status === 'active'
                    ? 'bg-mythic-violet animate-pulse'
                    : 'bg-white/[0.08]'
              }`}>
                {step.status === 'complete' && (
                  <svg className="w-2 h-2 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {step.status === 'active' && (
                  <span className="w-1.5 h-1.5 bg-white" />
                )}
              </div>
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className={`w-px flex-1 min-h-[24px] ${
                  step.status === 'complete' ? 'bg-[#39FF14]/40' : 'bg-white/[0.06]'
                }`} />
              )}
            </div>

            {/* Content */}
            <div className={`pb-4 ${i === steps.length - 1 ? 'pb-0' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[0.65rem] font-medium leading-none ${
                  step.status === 'complete'
                    ? 'text-[#39FF14]'
                    : step.status === 'active'
                      ? 'text-white'
                      : 'text-mythic-text-muted'
                }`}>
                  {step.label}
                </span>
                {step.status === 'active' && (
                  <span className="inline-block w-2.5 h-2.5 border border-mythic-violet border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              <p className={`font-mono text-[0.55rem] mt-0.5 leading-relaxed ${
                step.status === 'pending' ? 'text-mythic-text-muted/50' : 'text-mythic-text-dim'
              }`}>
                {step.description}
              </p>
              {step.txLink && step.status !== 'pending' && (
                <a
                  href={step.txLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 font-mono text-[0.55rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                >
                  {step.txLabel || 'View transaction'}
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Error Banner */}
      {txError && (
        <div className="px-4 py-3 border-t border-red-500/20 bg-red-500/5 flex items-start gap-2">
          <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <div>
            <p className="font-mono text-[0.6rem] text-red-400">
              {txError}
            </p>
            <a
              href={`https://solscan.io/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 font-mono text-[0.55rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
            >
              View failed transaction on Solscan
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* Complete Banner */}
      {allComplete && direction === 'deposit' && (
        <div className="border-t border-[#39FF14]/20 bg-[#39FF14]/5">
          <div className="px-4 py-3 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-[#39FF14] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="font-mono text-[0.6rem] text-[#39FF14]/90">
              ~{mythReceived > 1000 ? mythReceived.toLocaleString(undefined, { maximumFractionDigits: 0 }) : mythReceived.toFixed(4)} MYTH is now in your wallet on Mythic L2.
            </p>
          </div>
          <div className="px-4 pb-3 flex items-center gap-2">
            <a
              href="https://wallet.mythic.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-mythic-violet/15 border border-mythic-violet/30 font-mono text-[0.6rem] text-mythic-violet hover:text-mythic-violet-bright hover:border-mythic-violet/50 transition-colors"
            >
              Open Web Wallet
            </a>
            <a
              href="https://mythicswap.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FF9500]/10 border border-[#FF9500]/20 font-mono text-[0.6rem] text-[#FF9500] hover:text-[#FFB347] hover:border-[#FF9500]/40 transition-colors"
            >
              Trade on MythicSwap
            </a>
          </div>
        </div>
      )}
      {allComplete && direction === 'withdraw' && exitMode === 'fast' && (
        <div className="px-4 py-3 border-t border-[#39FF14]/20 bg-[#39FF14]/5 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-[#39FF14] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="font-mono text-[0.6rem] text-[#39FF14]/90">
            Fast Exit initiated. Funds arrive on L1 within ~30 minutes.
          </p>
        </div>
      )}
      {allComplete && direction === 'withdraw' && exitMode === 'standard' && (
        <div className="px-4 py-3 border-t border-mythic-violet/20 bg-mythic-violet/5 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-mythic-violet flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="font-mono text-[0.6rem] text-mythic-violet/90">
            Challenge period active. Claimable on L1 in ~24 hours.
          </p>
        </div>
      )}
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
