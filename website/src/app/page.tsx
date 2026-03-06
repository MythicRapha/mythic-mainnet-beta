import Link from 'next/link'
import FeatureCard from '@/components/FeatureCard'
import StatsBar from '@/components/StatsBar'
import TokenomicsTable from '@/components/TokenomicsTable'
import ExplorerSearch from '@/components/ExplorerSearch'
import LiveProof from '@/components/LiveProof'
import HeroGem from '@/components/HeroGem'

export default function HomePage() {
  return (
    <div className="relative">
      {/* ===== HERO ===== */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="grid-overlay absolute inset-0" />

        <div className="relative max-w-[1280px] mx-auto px-5 sm:px-10 text-center">
          {/* Convergence Crystal */}
          <HeroGem />

          {/* Heading — Sora, uppercase, huge tracking */}
          <h1 className="font-display font-extrabold text-[2.8rem] sm:text-[3.6rem] lg:text-[4.8rem] tracking-[0.18em] uppercase text-white leading-[1.05] mb-6">
            Mythic
          </h1>

          {/* Tagline — Mono, small, wide tracking */}
          <p className="font-mono text-[0.7rem] sm:text-[0.75rem] tracking-[0.35em] uppercase text-mythic-text-dim mb-12">
            Intelligence, Forged On-Chain
          </p>

          {/* Badge — Mono, brand-kit style */}
          <div className="inline-flex items-center gap-2 px-[10px] py-[4px] border border-mythic-violet/40 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-mythic-violet mb-12">
            <span className="w-1.5 h-1.5 bg-mythic-violet animate-pulse" />
            Solana SVM + Firedancer
          </div>

          {/* Description — Inter body */}
          <p className="text-[0.95rem] text-mythic-text max-w-[560px] mx-auto mb-12 leading-relaxed">
            A Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute.{' '}
            <span className="relative inline-flex items-center gap-1 group/tps cursor-default">
              <span className="text-white font-semibold">1M+ peak TPS</span>
              <svg className="w-3.5 h-3.5 text-mythic-text-dim group-hover/tps:text-mythic-violet transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[260px] px-3 py-2 bg-mythic-card border border-white/10 text-[0.65rem] text-mythic-text leading-relaxed opacity-0 group-hover/tps:opacity-100 transition-opacity z-50 font-mono">
                <span className="text-white font-semibold block mb-1">Firedancer Peak Throughput</span>
                Theoretical peak: 1M+ TPS via Firedancer&apos;s optimized networking stack. Live throughput scales with network load, validator count, and transaction complexity. Current load: ~9K TPS.
                <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-white/10" />
              </span>
            </span>
          </p>

          {/* BRIDGE POINTS BANNER — High urgency CTA */}
          <Link
            href="/bridge"
            className="group relative inline-flex items-center gap-3 px-6 py-3 mb-6 border border-mythic-violet/40 bg-mythic-violet/[0.08] hover:bg-mythic-violet/[0.15] hover:border-mythic-violet/60 transition-all"
          >
            <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-[#39FF14] text-black font-mono text-[0.5rem] font-bold tracking-[0.1em] uppercase animate-pulse">LIVE</span>
            <span className="font-mono text-[0.65rem] tracking-[0.08em] text-mythic-violet-bright">
              Bridge now &rarr; Earn up to <span className="text-[#39FF14] font-bold">5x Genesis Points</span>
            </span>
          </Link>

          {/* CTAs — brand-kit .btn pattern */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/bridge"
              className="w-full sm:w-auto px-7 py-3.5 bg-mythic-violet text-white font-display text-[0.85rem] font-bold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors relative overflow-hidden group"
            >
              <span className="relative z-10">Bridge to L2 &mdash; Earn Points</span>
              <span className="absolute inset-0 bg-gradient-to-r from-mythic-violet via-[#9B5FFF] to-mythic-violet opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
            <a
              href="https://pump.fun/coin/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-3 bg-[#39FF14] text-black font-display text-[0.8rem] font-bold tracking-[0.04em] hover:bg-[#66FF44] transition-colors"
            >
              Buy $MYTH on PumpFun
            </a>
            <Link
              href="/docs"
              className="w-full sm:w-auto px-7 py-3 border border-white/[0.12] text-white font-display text-[0.8rem] font-semibold tracking-[0.04em] hover:border-white/[0.24] hover:bg-white/[0.03] transition-colors"
            >
              Read Docs
            </Link>
          </div>

          {/* Trust verification strip */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            <Link
              href="/proof"
              className="inline-flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-[#39FF14]/60 hover:text-[#39FF14] transition-colors"
            >
              <span className="w-1.5 h-1.5 bg-[#39FF14] animate-pulse" />
              Network Verification
            </Link>
            <a
              href="https://mythic.foundation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-mythic-violet/60 hover:text-mythic-violet transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Wyoming DUNA — Filing #2026-001904245
            </a>
            <Link
              href="/whitepaper"
              className="inline-flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-mythic-text-dim hover:text-white transition-colors"
            >
              Whitepaper
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>

          {/* Explorer Search */}
          <ExplorerSearch />
        </div>
      </section>

      {/* ===== STATS ===== */}
      <StatsBar />

      {/* ===== LIVE PROOF ===== */}
      <LiveProof />

      {/* ===== FEATURES ===== */}
      <section className="py-[100px] sm:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          {/* Section header — brand-kit pattern */}
          <div className="mb-16">
            <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
              01 / Features
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
              Why Mythic?
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              A new paradigm for blockchain infrastructure, built from the ground up for AI workloads.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeatureCard
              icon={
                <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              }
              title="AI-Native Consensus"
              description="Proof of Useful AI Work. Validators earn $MYTH by running AI inference, not wasting energy."
            />
            <FeatureCard
              icon={
                <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                </svg>
              }
              title="Decentralized Compute"
              description="Rent GPU, CPU, and storage from the network. Cheaper than AWS, powered by $MYTH."
            />
            <FeatureCard
              icon={
                <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              }
              title="Built on Firedancer"
              description="The fastest SVM runtime. 1M+ TPS peak capacity via Firedancer. Full Solana program compatibility."
            />
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="py-[100px] sm:py-[120px] border-y border-white/[0.06] bg-[#08080C]/50">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          <div className="mb-16">
            <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
              02 / Getting Started
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
              How It Works
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              Get started with Mythic in three simple steps.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-[40px] left-[16%] right-[16%] h-px bg-white/[0.06]" />

            {[
              { num: '01', title: 'Get $MYTH on PumpFun', desc: 'Trade the $MYTH SPL token on PumpFun or Raydium on Solana L1. Zero VC allocation, fair launch.' },
              { num: '02', title: 'Bridge to Mythic L2', desc: 'Bridge assets from Solana L1 to Mythic L2 via the bridge. $MYTH is the native gas currency on L2.' },
              { num: '03', title: 'Use AI & Compute', desc: 'Run AI inference, deploy models, rent compute, and build on the AI-native blockchain. Fees paid in native $MYTH.' },
            ].map((step) => (
              <div key={step.num} className="text-center relative">
                <div className="w-[80px] h-[80px] bg-[#08080C] border border-white/[0.06] flex items-center justify-center mx-auto mb-6 relative z-10">
                  <span className="font-display text-[1.4rem] font-bold text-mythic-violet">{step.num}</span>
                </div>
                <h3 className="font-display text-white font-semibold text-[1rem] mb-2">{step.title}</h3>
                <p className="text-mythic-text text-[0.85rem] leading-relaxed max-w-[280px] mx-auto">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== ARCHITECTURE ===== */}
      <section className="py-[100px] sm:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          <div className="mb-16">
            <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
              03 / Architecture
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
              Transaction Pipeline
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              How Mythic L2 processes transactions and settles to Solana.
            </p>
          </div>

          <div className="max-w-[960px] mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: 'Ingest',
                  title: 'Sequencer',
                  desc: 'Orders transactions and batches them for execution',
                  icon: (
                    <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                    </svg>
                  ),
                },
                {
                  label: 'Execute',
                  title: 'SVM Runtime',
                  desc: 'Firedancer-based SVM runs Solana-compatible programs',
                  icon: (
                    <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
                    </svg>
                  ),
                },
                {
                  label: 'Verify',
                  title: 'AI Validation',
                  desc: 'Proof of Useful AI Work validates state transitions',
                  icon: (
                    <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  ),
                },
                {
                  label: 'Settle',
                  title: 'Solana L1',
                  desc: 'State roots posted to Solana L1 for final security',
                  icon: (
                    <svg className="w-5 h-5 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                  ),
                },
              ].map((step, i) => (
                <div key={step.title} className="relative group">
                  <div className="bg-[#08080C] border border-white/[0.06] p-8 text-center hover:border-mythic-violet/20 transition-colors h-full">
                    <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-4">
                      {step.label}
                    </div>
                    <div className="w-10 h-10 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center mx-auto mb-4">
                      {step.icon}
                    </div>
                    <h4 className="font-display text-white font-semibold text-[0.9rem] mb-2">{step.title}</h4>
                    <p className="text-mythic-text text-[0.75rem] leading-relaxed">{step.desc}</p>
                  </div>
                  {/* Arrow */}
                  {i < 3 && (
                    <div className="hidden lg:flex absolute -right-[10px] top-1/2 -translate-y-1/2 z-10 text-white/10">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== TOKENOMICS ===== */}
      <section className="py-[100px] sm:py-[120px] border-t border-white/[0.06] bg-[#08080C]/50">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          <div className="mb-16">
            <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
              04 / Tokenomics
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
              $MYTH — Native L2 Currency
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              $MYTH is the native gas currency of the Mythic L2 chain. Fixed supply of ~999M. Every transaction burns a portion. No inflation. No VC unlocks.
            </p>
          </div>

          {/* Buy on PumpFun CTA */}
          <div className="mb-12 p-6 bg-[#39FF14]/5 border border-[#39FF14]/20">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-white font-semibold text-[1rem] mb-1">Get $MYTH on Solana L1</h3>
                <p className="text-mythic-text text-[0.82rem]">Trade the $MYTH SPL token on PumpFun or Raydium. Fair-launched with zero VC allocation. Bridge assets to use Mythic L2.</p>
              </div>
              <a
                href="https://pump.fun/coin/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 px-6 py-2.5 bg-[#39FF14] text-black font-display text-[0.75rem] font-bold tracking-[0.04em] hover:bg-[#66FF44] transition-colors"
              >
                Buy on PumpFun
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Token Info */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#08080C] border border-white/[0.06] p-6">
                  <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">Total Supply</div>
                  <div className="font-display text-[2rem] font-bold text-white">~999M</div>
                </div>
                <div className="bg-[#08080C] border border-white/[0.06] p-6">
                  <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">Type</div>
                  <div className="font-display text-[2rem] font-bold text-mythic-green">Native</div>
                </div>
              </div>

              <div className="bg-[#0A0F05] border border-[#39FF14]/15 p-4">
                <div className="flex items-start gap-3">
                  <span className="text-[#39FF14] text-lg mt-0.5">⬡</span>
                  <div>
                    <div className="text-white font-semibold text-[0.85rem] mb-1">Native L2 Gas Currency</div>
                    <p className="text-mythic-text text-[0.78rem] leading-relaxed">
                      $MYTH is minted at genesis as the native currency of Mythic L2 — like ETH on Ethereum. It powers all gas fees, staking, governance, and compute payments. This is separate from any SPL token on Solana L1.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-[#08080C] border border-white/[0.06] p-8 space-y-5">
                <h3 className="font-display text-white font-semibold text-[1rem]">Token Utility</h3>
                <ul className="space-y-3">
                  {[
                    'Native gas currency on Mythic L2 — all tx fees paid in $MYTH',
                    'Validator staking for block production & AI verification',
                    'Payment for AI compute and inference requests',
                    'Governance voting rights (stake-weighted)',
                    'Compute marketplace settlement currency',
                    'Deflationary burn on every transaction (30-40% of fees)',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[0.85rem] text-mythic-text">
                      <svg className="w-4 h-4 text-mythic-violet mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Fee Breakdown Table */}
            <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
              <div className="px-6 py-5 border-b border-white/[0.06]">
                <h3 className="font-display text-white font-semibold text-[1rem]">Fee Distribution</h3>
                <p className="text-mythic-text text-[0.82rem] mt-1">Where your $MYTH fees go</p>
              </div>
              <TokenomicsTable />
            </div>
          </div>
        </div>
      </section>

      {/* ===== ECOSYSTEM ===== */}
      <section className="py-[100px] sm:py-[120px] border-t border-white/[0.06]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          <div className="mb-16">
            <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
              05 / Ecosystem
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-3">
              The Mythic Ecosystem
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              A unified suite of products built on Mythic L2. Trade, launch, bridge, and build.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* mythic.sh — Main */}
            <a href="https://mythic.sh" className="group bg-[#08080C] border border-white/[0.06] p-8 hover:border-[#7B2FFF]/30 transition-colors">
              <div className="w-10 h-10 bg-[#7B2FFF]/10 border border-[#7B2FFF]/20 flex items-center justify-center mb-5">
                <svg className="w-5 h-5 text-[#7B2FFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 003 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </div>
              <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">Network</div>
              <h4 className="font-display text-white font-semibold text-[1rem] mb-2 group-hover:text-[#7B2FFF] transition-colors">mythic.sh</h4>
              <p className="text-mythic-text text-[0.75rem] leading-relaxed">Main network hub. Bridge, docs, and explorer.</p>
            </a>

            {/* MythicSwap — DEX */}
            <a href="https://mythicswap.app" target="_blank" rel="noopener noreferrer" className="group bg-[#08080C] border border-white/[0.06] p-8 hover:border-[#FF9500]/30 transition-colors">
              <div className="w-10 h-10 bg-[#FF9500]/10 border border-[#FF9500]/20 flex items-center justify-center mb-5">
                <svg className="w-5 h-5 text-[#FF9500]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              </div>
              <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">DEX</div>
              <h4 className="font-display text-white font-semibold text-[1rem] mb-2 group-hover:text-[#FF9500] transition-colors">mythicswap.app</h4>
              <p className="text-mythic-text text-[0.75rem] leading-relaxed">AMM DEX. Swap tokens with deep liquidity on Mythic L2.</p>
            </a>

            {/* mythic.money — Launchpad */}
            <a href="https://mythic.money" target="_blank" rel="noopener noreferrer" className="group bg-[#08080C] border border-white/[0.06] p-8 hover:border-[#00E5FF]/30 transition-colors">
              <div className="w-10 h-10 bg-[#00E5FF]/10 border border-[#00E5FF]/20 flex items-center justify-center mb-5">
                <svg className="w-5 h-5 text-[#00E5FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                </svg>
              </div>
              <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">Launchpad</div>
              <h4 className="font-display text-white font-semibold text-[1rem] mb-2 group-hover:text-[#00E5FF] transition-colors">mythic.money</h4>
              <p className="text-mythic-text text-[0.75rem] leading-relaxed">Token launchpad. Bonding curve fair launches on Mythic L2.</p>
            </a>

            {/* mythic.foundation */}
            <a href="https://mythic.foundation" target="_blank" rel="noopener noreferrer" className="group bg-[#08080C] border border-white/[0.06] p-8 hover:border-[#A855F7]/30 transition-colors">
              <div className="w-10 h-10 bg-[#A855F7]/10 border border-[#A855F7]/20 flex items-center justify-center mb-5">
                <svg className="w-5 h-5 text-[#A855F7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                </svg>
              </div>
              <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">Foundation</div>
              <h4 className="font-display text-white font-semibold text-[1rem] mb-2 group-hover:text-[#A855F7] transition-colors">mythic.foundation</h4>
              <p className="text-mythic-text text-[0.75rem] leading-relaxed">Grants, governance, and ecosystem development. A Wyoming DUNA.</p>
            </a>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="py-[100px] sm:py-[120px] relative overflow-hidden">
        <div className="grid-overlay absolute inset-0 opacity-30" />
        <div className="relative max-w-[1280px] mx-auto px-5 sm:px-10 text-center">
          <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
            06 / Get Started
          </div>
          <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-4">
            Ready to Build on Mythic?
          </h2>
          <p className="text-mythic-text text-[0.95rem] max-w-[560px] mx-auto mb-12 leading-relaxed">
            Join the next generation of AI-native blockchain infrastructure. Bridge your assets, deploy your models, and start building.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://pump.fun/coin/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-3 bg-[#39FF14] text-black font-display text-[0.8rem] font-bold tracking-[0.04em] hover:bg-[#66FF44] transition-colors"
            >
              Buy $MYTH on PumpFun
            </a>
            <Link
              href="/bridge"
              className="w-full sm:w-auto px-7 py-3 bg-mythic-violet text-white font-display text-[0.8rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors"
            >
              Bridge to L2
            </Link>
            <Link
              href="/docs"
              className="w-full sm:w-auto px-7 py-3 border border-white/[0.12] text-white font-display text-[0.8rem] font-semibold tracking-[0.04em] hover:border-white/[0.24] hover:bg-white/[0.03] transition-colors"
            >
              Read Documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
