'use client'

import { useWalletContext } from '@/providers/WalletProvider'

export default function WalletButton() {
  const { connected, shortAddress, balance, connecting, connect, disconnect } = useWalletContext()

  if (connecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-mythic-card border border-mythic-border text-mythic-text text-sm"
      >
        <span className="inline-block w-4 h-4 border-2 border-mythic-purple border-t-transparent rounded-full animate-spin" />
        Connecting...
      </button>
    )
  }

  if (connected) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-mythic-card border border-mythic-border text-sm">
          <span className="text-mythic-cyan font-medium">{balance?.toFixed(2)} MYTH</span>
        </div>
        <button
          onClick={disconnect}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-mythic-card border border-mythic-border text-white text-sm hover:border-mythic-purple/50 transition-smooth"
        >
          <span className="w-2 h-2 rounded-full bg-green-400" />
          {shortAddress}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={connect}
      className="px-4 py-2 rounded-lg bg-gradient-to-r from-mythic-purple to-mythic-cyan text-white text-sm font-medium hover:shadow-lg hover:shadow-mythic-purple/25 transition-smooth"
    >
      Connect Wallet
    </button>
  )
}
