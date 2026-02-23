import type { Metadata } from 'next'
import BridgeCard from '@/components/BridgeCard'

export const metadata: Metadata = {
  title: 'Bridge — Mythic',
  description: 'Bridge $MYTH from PumpFun / Solana L1 to Mythic L2. Move your liquidity to the AI-native chain.',
}

export default function BridgePage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] relative">
      {/* Background */}
      <div className="absolute inset-0 grid-overlay opacity-30" />

      <div className="relative max-w-[1280px] mx-auto px-5 sm:px-10 py-16 sm:py-20">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
            Bridge
          </div>
          <h1 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
            Mythic Bridge
          </h1>
          <p className="text-mythic-text text-[0.95rem] max-w-[480px] mx-auto mb-6">
            Bridge $MYTH from Solana L1 to Mythic L2. Buy on PumpFun, then bridge to access the full Mythic ecosystem.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#39FF14]/30 bg-[#39FF14]/5">
            <span className="w-1.5 h-1.5 bg-[#39FF14] animate-pulse" />
            <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-[#39FF14]">
              Currently supporting $MYTH only — SOL &amp; USDC coming soon
            </span>
          </div>
        </div>

        {/* Bridge Card */}
        <BridgeCard />
      </div>
    </div>
  )
}
