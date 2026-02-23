'use client'

import { useWalletContext } from '@/providers/WalletProvider'

export default function WalletButton() {
  const { connected, shortAddress, balance, connecting, connect, disconnect } = useWalletContext()

  if (connecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 bg-[#08080C] border border-white/[0.06] text-mythic-text-dim font-mono text-[0.65rem] tracking-[0.1em] uppercase"
      >
        <span className="inline-block w-3.5 h-3.5 border-2 border-mythic-violet border-t-transparent rounded-full animate-spin" />
        Connecting
      </button>
    )
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-[#08080C] border border-white/[0.06]">
          <span className="font-mono text-[0.65rem] tracking-[0.08em] text-mythic-violet font-medium">{balance?.toFixed(2)} MYTH</span>
        </div>
        <button
          onClick={disconnect}
          className="flex items-center gap-2 px-4 py-2 bg-[#08080C] border border-white/[0.06] text-white font-mono text-[0.65rem] tracking-[0.1em] hover:border-mythic-violet/20 transition-colors"
        >
          <span className="w-1.5 h-1.5 bg-green-400" />
          {shortAddress}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={connect}
      className="px-4 py-2 bg-mythic-violet text-white font-display text-[0.75rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors"
    >
      Connect Wallet
    </button>
  )
}
