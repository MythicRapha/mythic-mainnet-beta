'use client'

import { useState, useMemo } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useWalletContext } from '@/providers/WalletProvider'
import { useBridge } from '@/hooks/useBridge'
import { SUPPORTED_ASSETS, BridgeAsset } from '@/lib/bridge-sdk'
import { useMythPrice } from '@/hooks/useMythPrice'
import Image from 'next/image'

function TokenIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const src = symbol === 'SOL' ? '/brand/solana-logo.svg'
    : symbol === 'USDC' ? '/brand/usdc-logo.svg'
    : '/brand/myth-token.svg'
  const alt = symbol === 'SOL' ? 'Solana' : symbol === 'USDC' ? 'USDC' : 'MYTH'
  return <Image src={src} alt={alt} width={size} height={size} className="rounded-full" />
}

export default function BridgeCard() {
  const { connected, shortAddress, balance, l2Balance, openWalletModal, connecting } = useWalletContext()
  const {
    direction, setDirection,
    selectedAsset, setSelectedAsset,
    stats, l2Paused, loading, txSignature, error, deposits, solVaultTvl,
    tokenBalances,
    depositSOL, depositSPL, withdrawFromL2,
    calculateFee,
    clearError, clearTx,
  } = useBridge()

  const { price: mythPrice, solToMyth } = useMythPrice()

  const [amount, setAmount] = useState('')
  const [l1Recipient, setL1Recipient] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ''))
    return isNaN(n) ? 0 : n
  }, [amount])

  const fee = useMemo(() => calculateFee(parsedAmount), [calculateFee, parsedAmount])

  // Conversion rates: SOL→MYTH and USDC→MYTH use live market price, MYTH→MYTH is 1:1
  const conversionRate = useMemo(() => {
    if (direction === 'withdraw') return 1
    if (selectedAsset.symbol === 'MYTH') return 1
    if (selectedAsset.symbol === 'SOL' && mythPrice && mythPrice.priceSOL > 0) {
      return 1 / mythPrice.priceSOL // e.g. if MYTH is 0.0000001 SOL, then 1 SOL = 10M MYTH
    }
    if (selectedAsset.symbol === 'USDC' && mythPrice && mythPrice.priceUsd > 0) {
      return 1 / mythPrice.priceUsd
    }
    return 0 // rate not available yet
  }, [direction, selectedAsset, mythPrice])

  const receiveAmount = useMemo(() => {
    const afterFee = Math.max(0, parsedAmount - fee)
    return afterFee * conversionRate
  }, [parsedAmount, fee, conversionRate])

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
      const reserve = direction === 'deposit' && selectedAsset.symbol === 'SOL' ? 0.01 : 0.001
      const max = Math.max(0, fromBalance - reserve)
      setAmount(max.toFixed(4))
    }
  }

  const handleBridge = async () => {
    if (!connected || parsedAmount <= 0) return
    clearError()
    clearTx()
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
      ? stats
        ? parsedAmount >= stats.minDeposit && parsedAmount <= stats.maxDeposit && parsedAmount <= stats.dailyRemaining
        : false
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
          {l2Slot !== null && (
            <div className="text-right">
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">L2 Slot</span>
              <span className="font-mono text-[0.65rem] text-white">{l2Slot.toLocaleString()}</span>
            </div>
          )}
          {l2Latency !== null && (
            <div className="text-right">
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">Deposits</span>
              <span className="font-mono text-[0.65rem] text-white">{stats.depositNonce}</span>
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
              <svg className="w-8 h-8 text-mythic-violet mx-auto animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-mythic-text text-[0.88rem]">Loading bridge configuration...</p>
              <p className="font-mono text-[0.65rem] text-mythic-text-dim">Connecting to Solana mainnet</p>
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




              {/* Withdrawal Info */}
              {direction === 'withdraw' && (
                <div className="bg-mythic-violet/5 border border-mythic-violet/20 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-mythic-violet flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-mono text-[0.6rem] text-mythic-violet font-medium">Withdrawal Info</span>
                  </div>
                  <p className="font-mono text-[0.55rem] text-mythic-text-dim leading-relaxed">
                    Withdrawals send MYTH from L2 to the bridge reserve. The relayer initiates a withdrawal on L1 with a ~42 hour challenge period before funds can be claimed.
                  </p>
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
                  {direction === 'deposit' && selectedAsset.symbol !== 'MYTH' && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">Rate</span>
                      <span className="font-mono text-[0.6rem] text-mythic-text-dim">
                        {selectedAsset.symbol === 'SOL' && mythPrice && mythPrice.priceSOL > 0
                          ? `1 SOL ≈ ${(1 / mythPrice.priceSOL).toLocaleString(undefined, { maximumFractionDigits: 0 })} MYTH`
                          : selectedAsset.symbol === 'USDC' && mythPrice && mythPrice.priceUsd > 0
                            ? `1 USDC ≈ ${(1 / mythPrice.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })} MYTH`
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
                      {conversionRate > 0
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

              {/* Success */}
              {txSignature && (
                <div className="flex items-start gap-2 p-3 border-l-[3px] border-[#39FF14] bg-[#39FF14]/5">
                  <svg className="w-4 h-4 text-[#39FF14] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="text-[#39FF14]/90 text-[0.75rem] font-medium mb-1">
                      {direction === 'deposit' ? 'Deposit Submitted' : 'Withdrawal Submitted'}
                    </p>
                    <a
                      href={direction === 'deposit'
                        ? `https://solscan.io/tx/${txSignature}`
                        : `https://explorer.mythic.sh/tx/${txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[0.6rem] text-mythic-violet hover:text-mythic-violet-bright underline break-all"
                    >
                      {txSignature.slice(0, 20)}...{txSignature.slice(-8)}
                    </a>
                    {direction === 'withdraw' && (
                      <p className="font-mono text-[0.55rem] text-mythic-text-dim mt-1">
                        The relayer will process this withdrawal on L1. Challenge period: ~42 hours.
                      </p>
                    )}
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
                    The bridge is currently <strong>paused</strong>. Deposits and withdrawals are temporarily disabled.
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

      {/* Recent Transactions */}
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h3 className="font-display text-white font-medium text-[0.9rem]">
            Recent Bridge Transactions
          </h3>
        </div>

        {deposits.length > 0 ? (
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
                      href={`https://solscan.io/tx/${d.signature}`}
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
                ? 'No bridge transactions found for this wallet'
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
