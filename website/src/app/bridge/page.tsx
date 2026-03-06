import type { Metadata } from 'next'
import BridgeCard from '@/components/BridgeCard'
import BridgeLiveStats from '@/components/BridgeLiveStats'
import BridgeTutorialModal from '@/components/BridgeTutorialModal'
import BridgeBonuses from '@/components/BridgeBonuses'

export const metadata: Metadata = {
  title: 'Bridge',
  description: 'Bridge SOL from Solana L1 to Mythic L2. Deposit SOL, receive MYTH tokens, and earn Season 1 points with up to 3x multiplier.',
  openGraph: {
    title: 'Bridge to Mythic L2',
    description: 'Deposit SOL · Receive MYTH · Earn Points',
    images: [{
      url: '/brand/og-bridge.png',
      width: 1200,
      height: 630,
      alt: 'Bridge to Mythic L2 — Deposit SOL, Receive MYTH, Earn Points',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bridge to Mythic L2',
    description: 'Deposit SOL · Receive MYTH · Earn Points',
    images: ['/brand/og-bridge.png'],
  },
}

export default function BridgePage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] relative">
      {/* Background */}
      <div className="absolute inset-0 grid-overlay opacity-30" />

      <div className="relative max-w-[1280px] mx-auto px-5 sm:px-10 py-16 sm:py-20">

        {/* Points banner — immediately visible */}
        <div className="mb-10 p-4 sm:p-5 border border-[#39FF14]/30 bg-[#39FF14]/[0.04] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 bg-[#39FF14] animate-pulse flex-shrink-0" />
            <span className="font-mono text-[0.7rem] sm:text-[0.8rem] text-[#39FF14] font-bold tracking-wide">
              SEASON 1 LIVE — 3x Points Multiplier Active
            </span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <a
              href="#points"
              className="px-5 py-2 bg-[#39FF14] text-black font-mono text-[0.65rem] font-bold tracking-[0.08em] uppercase hover:bg-[#66FF44] transition-colors"
            >
              Points Info &darr;
            </a>
            <a
              href="https://mythic.foundation/points"
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2 border border-[#7B2FFF]/40 bg-[#7B2FFF]/10 text-[#7B2FFF] font-mono text-[0.65rem] font-bold tracking-[0.08em] uppercase hover:bg-[#7B2FFF]/20 transition-colors"
            >
              My Points &rarr;
            </a>
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-12">
          <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
            Bridge
          </div>
          <h1 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
            Mythic Bridge
          </h1>
          <p className="text-mythic-text text-[0.95rem] max-w-[520px] mx-auto mb-3">
            Bridge SOL from Solana L1 to receive MYTH on Mythic L2. Every bridge is a market buy of $MYTH.
          </p>
          {/* Status + Points info */}
          <div className="inline-flex flex-col sm:flex-row items-center gap-4 mb-6">
            <div className="flex items-center gap-2 px-4 py-2 border border-mythic-violet/30 bg-mythic-violet/[0.05]">
              <span className="w-1.5 h-1.5 bg-mythic-violet animate-pulse" />
              <span className="font-mono text-[0.6rem] tracking-[0.08em] text-mythic-violet-bright font-bold">
                On-Chain Verified &bull; Trustless &amp; Permissionless &bull; Non-Custodial
              </span>
            </div>
            <BridgeTutorialModal />
          </div>
        </div>

        {/* Bridge Card */}
        <BridgeCard />

        {/* Points Program */}
        <div id="points">
          <BridgeBonuses />
        </div>

        {/* Contract Verification */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[720px] mx-auto">
          <a
            href="https://solscan.io/account/oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#08080C] border border-white/[0.06] p-4 hover:border-[#9945FF]/20 transition-colors group"
          >
            <div className="font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted mb-1.5">L1 Bridge Contract</div>
            <div className="font-mono text-[0.6rem] text-mythic-violet group-hover:text-mythic-violet-bright transition-colors break-all">
              oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ
            </div>
            <div className="mt-2 font-mono text-[0.48rem] tracking-[0.08em] uppercase text-[#9945FF]">
              Verify on Solscan &rarr;
            </div>
          </a>
          <a
            href="https://solscan.io/account/4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#08080C] border border-white/[0.06] p-4 hover:border-[#9945FF]/20 transition-colors group"
          >
            <div className="font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted mb-1.5">L1 Bridge Config</div>
            <div className="font-mono text-[0.6rem] text-mythic-violet group-hover:text-mythic-violet-bright transition-colors break-all">
              4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9
            </div>
            <div className="mt-2 font-mono text-[0.48rem] tracking-[0.08em] uppercase text-[#9945FF]">
              Verify on Solscan &rarr;
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}
