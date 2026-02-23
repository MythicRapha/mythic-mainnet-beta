import type { Metadata } from 'next'
import BridgeCard from '@/components/BridgeCard'

export const metadata: Metadata = {
  title: 'Bridge — Mythic',
  description: 'Bridge assets between Solana L1 and Mythic L2. Deposit and withdraw $MYTH, SOL, and USDC.',
}

export default function BridgePage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] relative">
      {/* Background */}
      <div className="absolute inset-0 grid-overlay opacity-50" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-mythic-purple/5 rounded-full blur-[120px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
            Mythic <span className="gradient-text">Bridge</span>
          </h1>
          <p className="text-mythic-text max-w-md mx-auto">
            Move assets between Solana L1 and Mythic L2 securely.
          </p>
        </div>

        {/* Bridge Card */}
        <BridgeCard />
      </div>
    </div>
  )
}
