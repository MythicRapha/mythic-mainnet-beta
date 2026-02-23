'use client'

import { useState } from 'react'
import { useWalletContext } from '@/providers/WalletProvider'

const assets = [
  { symbol: 'MYTH', name: 'Mythic', icon: 'M' },
  { symbol: 'SOL', name: 'Solana', icon: 'S' },
  { symbol: 'USDC', name: 'USD Coin', icon: 'U' },
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
  { id: '3nP...8bc', asset: 'SOL', amount: '25.5', status: 'confirmed', time: '5 min ago' },
  { id: '9mR...d4e', asset: 'USDC', amount: '500', status: 'complete', time: '12 min ago' },
]

const mockWithdrawals: Transaction[] = [
  { id: '2vL...a1c', asset: 'MYTH', amount: '500', status: 'pending', time: '6d 23h remaining' },
  { id: '8kJ...b3f', asset: 'SOL', amount: '10', status: 'pending', time: '5d 12h remaining' },
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
      <div className="rounded-xl bg-mythic-card border border-mythic-border overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-mythic-border">
          <button
            onClick={() => setTab('deposit')}
            className={`flex-1 py-4 text-sm font-medium transition-colors ${
              tab === 'deposit'
                ? 'text-white border-b-2 border-mythic-purple bg-mythic-purple/5'
                : 'text-mythic-text hover:text-white'
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => setTab('withdraw')}
            className={`flex-1 py-4 text-sm font-medium transition-colors ${
              tab === 'withdraw'
                ? 'text-white border-b-2 border-mythic-cyan bg-mythic-cyan/5'
                : 'text-mythic-text hover:text-white'
            }`}
          >
            Withdraw
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* From */}
          <div className="rounded-lg bg-mythic-bg border border-mythic-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-mythic-text text-xs uppercase tracking-wider">From</span>
              <span className="text-mythic-text text-xs">{fromChain}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-mythic-purple/30 to-mythic-cyan/30 border border-mythic-border flex items-center justify-center">
                <span className="text-xs font-bold text-white">
                  {tab === 'deposit' ? 'S' : 'M'}
                </span>
              </div>
              <span className="text-white font-medium">{fromChain}</span>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center -my-1">
            <div className="w-8 h-8 rounded-full bg-mythic-border flex items-center justify-center">
              <svg className="w-4 h-4 text-mythic-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>

          {/* To */}
          <div className="rounded-lg bg-mythic-bg border border-mythic-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-mythic-text text-xs uppercase tracking-wider">To</span>
              <span className="text-mythic-text text-xs">{toChain}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-mythic-purple/30 to-mythic-cyan/30 border border-mythic-border flex items-center justify-center">
                <span className="text-xs font-bold text-white">
                  {tab === 'deposit' ? 'M' : 'S'}
                </span>
              </div>
              <span className="text-white font-medium">{toChain}</span>
            </div>
          </div>

          {/* Asset Selector */}
          <div className="relative">
            <label className="block text-mythic-text text-xs uppercase tracking-wider mb-2">
              Asset
            </label>
            <button
              onClick={() => setShowAssetDropdown(!showAssetDropdown)}
              className="w-full flex items-center justify-between p-3 rounded-lg bg-mythic-bg border border-mythic-border hover:border-mythic-purple/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-mythic-purple/20 to-mythic-cyan/20 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">{selectedAsset.icon}</span>
                </div>
                <div className="text-left">
                  <div className="text-white text-sm font-medium">{selectedAsset.symbol}</div>
                  <div className="text-mythic-text text-xs">{selectedAsset.name}</div>
                </div>
              </div>
              <svg className="w-4 h-4 text-mythic-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showAssetDropdown && (
              <div className="absolute z-10 w-full mt-1 rounded-lg bg-mythic-card border border-mythic-border shadow-xl">
                {assets.map((asset) => (
                  <button
                    key={asset.symbol}
                    onClick={() => {
                      setSelectedAsset(asset)
                      setShowAssetDropdown(false)
                    }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-mythic-purple/10 transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-mythic-purple/20 to-mythic-cyan/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{asset.icon}</span>
                    </div>
                    <div className="text-left">
                      <div className="text-white text-sm font-medium">{asset.symbol}</div>
                      <div className="text-mythic-text text-xs">{asset.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-mythic-text text-xs uppercase tracking-wider mb-2">
              Amount
            </label>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-mythic-bg border border-mythic-border focus-within:border-mythic-purple/50 transition-colors">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent text-white text-lg outline-none placeholder:text-mythic-text/40"
              />
              <button
                onClick={() => setAmount('1000')}
                className="px-2 py-1 rounded text-xs font-medium text-mythic-cyan bg-mythic-cyan/10 hover:bg-mythic-cyan/20 transition-colors"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Recipient */}
          <div>
            <label className="block text-mythic-text text-xs uppercase tracking-wider mb-2">
              {toChain} Recipient
            </label>
            <input
              type="text"
              placeholder={connected ? shortAddress || '' : 'Connect wallet to auto-fill'}
              defaultValue={connected ? shortAddress || '' : ''}
              className="w-full p-3 rounded-lg bg-mythic-bg border border-mythic-border text-white text-sm outline-none focus:border-mythic-purple/50 transition-colors placeholder:text-mythic-text/40"
            />
          </div>

          {/* Fee estimate */}
          <div className="flex items-center justify-between px-1">
            <span className="text-mythic-text text-xs">Estimated Fee</span>
            <span className="text-mythic-text text-xs">
              {estimatedFee} {selectedAsset.symbol}
            </span>
          </div>

          {/* Challenge period warning */}
          {tab === 'withdraw' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <svg className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-orange-400/90 text-xs leading-relaxed">
                Withdrawals have a <strong>7-day challenge period</strong> before funds are released to Solana L1. This protects against fraud.
              </p>
            </div>
          )}

          {/* Action Button */}
          {connected ? (
            <button className="w-full py-3.5 rounded-lg bg-gradient-to-r from-mythic-purple to-mythic-cyan text-white font-medium hover:shadow-lg hover:shadow-mythic-purple/25 transition-all duration-300 active:scale-[0.98]">
              {tab === 'deposit' ? 'Deposit' : 'Initiate Withdrawal'}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="w-full py-3.5 rounded-lg bg-gradient-to-r from-mythic-purple to-mythic-cyan text-white font-medium hover:shadow-lg hover:shadow-mythic-purple/25 transition-all duration-300 active:scale-[0.98] disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="mt-6 rounded-xl bg-mythic-card border border-mythic-border overflow-hidden">
        <div className="px-6 py-4 border-b border-mythic-border">
          <h3 className="text-white font-medium text-sm">
            {tab === 'deposit' ? 'Recent Deposits' : 'Pending Withdrawals'}
          </h3>
        </div>
        <div className="divide-y divide-mythic-border/50">
          {(tab === 'deposit' ? mockDeposits : mockWithdrawals).map((tx) => (
            <div key={tx.id} className="px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  tx.status === 'complete' ? 'bg-green-400' :
                  tx.status === 'confirmed' ? 'bg-mythic-cyan' :
                  'bg-orange-400 animate-pulse'
                }`} />
                <div>
                  <div className="text-white text-sm">
                    {tx.amount} {tx.asset}
                  </div>
                  <div className="text-mythic-text text-xs">{tx.id}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-medium ${
                  tx.status === 'complete' ? 'text-green-400' :
                  tx.status === 'confirmed' ? 'text-mythic-cyan' :
                  'text-orange-400'
                }`}>
                  {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                </div>
                <div className="text-mythic-text text-xs">{tx.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
