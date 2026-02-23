'use client'

import { useState } from 'react'
import { useWalletContext } from '@/providers/WalletProvider'

const assets = [
  { symbol: 'MYTH', name: 'Mythic', icon: 'M' },
]

interface Transaction {
  id: string
  asset: string
  amount: string
  status: 'pending' | 'confirmed' | 'complete'
  time: string
}

const mockDeposits: Transaction[] = [
  { id: '7xK...f2a', asset: 'MYTH', amount: '1,000', status: 'complete', time: '2 min ago' },
  { id: '3nP...8bc', asset: 'MYTH', amount: '2,500', status: 'confirmed', time: '5 min ago' },
  { id: '9mR...d4e', asset: 'MYTH', amount: '500', status: 'complete', time: '12 min ago' },
]

const mockWithdrawals: Transaction[] = [
  { id: '2vL...a1c', asset: 'MYTH', amount: '500', status: 'pending', time: '6d 23h remaining' },
  { id: '8kJ...b3f', asset: 'MYTH', amount: '1,200', status: 'pending', time: '5d 12h remaining' },
]

export default function BridgeCard() {
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [selectedAsset, setSelectedAsset] = useState(assets[0])
  const [amount, setAmount] = useState('')
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)
  const { connected, shortAddress, connect, connecting } = useWalletContext()

  const fromChain = tab === 'deposit' ? 'Solana L1' : 'Mythic L2'
  const toChain = tab === 'deposit' ? 'Mythic L2' : 'Solana L1'

  const estimatedFee = amount ? (parseFloat(amount.replace(/,/g, '')) * 0.001).toFixed(4) : '0.0000'

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Main Card */}
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-white/[0.06]">
          <button
            onClick={() => setTab('deposit')}
            className={`flex-1 py-4 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium transition-colors ${
              tab === 'deposit'
                ? 'text-white border-b-2 border-mythic-violet bg-mythic-violet/5'
                : 'text-mythic-text-dim hover:text-white'
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => setTab('withdraw')}
            className={`flex-1 py-4 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium transition-colors ${
              tab === 'withdraw'
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
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center">
                <span className="text-xs font-bold text-white">
                  {tab === 'deposit' ? 'S' : 'M'}
                </span>
              </div>
              <span className="text-white font-medium text-[0.9rem]">{fromChain}</span>
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
                  {tab === 'deposit' ? 'M' : 'S'}
                </span>
              </div>
              <span className="text-white font-medium text-[0.9rem]">{toChain}</span>
            </div>
          </div>

          {/* Asset Selector */}
          <div className="relative">
            <label className="block font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
              Asset
            </label>
            <button
              onClick={() => setShowAssetDropdown(!showAssetDropdown)}
              className="w-full flex items-center justify-between p-3 bg-black border border-white/[0.06] hover:border-mythic-violet/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">{selectedAsset.icon}</span>
                </div>
                <div className="text-left">
                  <div className="text-white text-[0.82rem] font-medium">{selectedAsset.symbol}</div>
                  <div className="text-mythic-text-dim text-[0.7rem]">{selectedAsset.name}</div>
                </div>
              </div>
              <svg className="w-4 h-4 text-mythic-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showAssetDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-[#08080C] border border-white/[0.06] shadow-xl">
                {assets.map((asset) => (
                  <button
                    key={asset.symbol}
                    onClick={() => {
                      setSelectedAsset(asset)
                      setShowAssetDropdown(false)
                    }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="w-7 h-7 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{asset.icon}</span>
                    </div>
                    <div className="text-left">
                      <div className="text-white text-[0.82rem] font-medium">{asset.symbol}</div>
                      <div className="text-mythic-text-dim text-[0.7rem]">{asset.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <label className="block font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
              Amount
            </label>
            <div className="flex items-center gap-2 p-3 bg-black border border-white/[0.06] focus-within:border-mythic-violet/30 transition-colors">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent text-white text-lg font-display outline-none placeholder:text-white/20"
              />
              <button
                onClick={() => setAmount('1000')}
                className="px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] font-medium text-mythic-violet bg-mythic-violet/10 hover:bg-mythic-violet/20 transition-colors"
              >
                Max
              </button>
            </div>
          </div>

          {/* Recipient */}
          <div>
            <label className="block font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
              {toChain} Recipient
            </label>
            <input
              type="text"
              placeholder={connected ? shortAddress || '' : 'Connect wallet to auto-fill'}
              defaultValue={connected ? shortAddress || '' : ''}
              className="w-full p-3 bg-black border border-white/[0.06] text-white text-[0.82rem] outline-none focus:border-mythic-violet/30 transition-colors placeholder:text-white/20"
            />
          </div>

          {/* Fee estimate */}
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[0.6rem] text-mythic-text-dim">Estimated Fee</span>
            <span className="font-mono text-[0.6rem] text-mythic-text-dim">
              {estimatedFee} {selectedAsset.symbol}
            </span>
          </div>

          {/* Challenge period warning */}
          {tab === 'withdraw' && (
            <div className="flex items-start gap-2 p-3 border-l-[3px] border-mythic-amber bg-mythic-amber/5">
              <svg className="w-4 h-4 text-mythic-amber mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-mythic-amber/90 text-[0.75rem] leading-relaxed">
                Withdrawals have a <strong>7-day challenge period</strong> before funds are released to Solana L1.
              </p>
            </div>
          )}

          {/* Action Button */}
          {connected ? (
            <button className="w-full py-3.5 bg-mythic-violet text-white font-display text-[0.8rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors">
              {tab === 'deposit' ? 'Deposit' : 'Initiate Withdrawal'}
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
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="mt-4 bg-[#08080C] border border-white/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h3 className="font-display text-white font-medium text-[0.9rem]">
            {tab === 'deposit' ? 'Recent Deposits' : 'Pending Withdrawals'}
          </h3>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {(tab === 'deposit' ? mockDeposits : mockWithdrawals).map((tx) => (
            <div key={tx.id} className="px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 ${
                  tx.status === 'complete' ? 'bg-green-400' :
                  tx.status === 'confirmed' ? 'bg-mythic-violet' :
                  'bg-mythic-amber animate-pulse'
                }`} />
                <div>
                  <div className="text-white text-[0.82rem]">
                    {tx.amount} {tx.asset}
                  </div>
                  <div className="font-mono text-mythic-text-dim text-[0.65rem]">{tx.id}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-[0.6rem] uppercase tracking-[0.1em] font-medium ${
                  tx.status === 'complete' ? 'text-green-400' :
                  tx.status === 'confirmed' ? 'text-mythic-violet' :
                  'text-mythic-amber'
                }`}>
                  {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                </div>
                <div className="font-mono text-mythic-text-muted text-[0.6rem]">{tx.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
