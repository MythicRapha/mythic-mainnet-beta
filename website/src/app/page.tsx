import Link from 'next/link'
import FeatureCard from '@/components/FeatureCard'
import StatsBar from '@/components/StatsBar'
import TokenomicsTable from '@/components/TokenomicsTable'

export default function HomePage() {
  return (
    <div className="relative">
      {/* ===== HERO SECTION ===== */}
      <section className="relative overflow-hidden">
        {/* Background effects */}
        <div className="hero-particles" />
        <div className="grid-overlay absolute inset-0" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-mythic-purple/10 border border-mythic-purple/20 text-mythic-purple text-sm font-medium mb-8">
              <span className="w-2 h-2 rounded-full bg-mythic-purple animate-pulse" />
              Built on Solana SVM + Firedancer
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
              <span className="gradient-text">The AI-Native</span>
              <br />
              <span className="text-white">Blockchain</span>
            </h1>

            {/* Subheading */}
            <p className="text-lg sm:text-xl text-mythic-text max-w-2xl mx-auto mb-10 leading-relaxed">
              Mythic is a Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute. 1M+ TPS.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/bridge"
                className="w-full sm:w-auto px-8 py-3.5 rounded-lg bg-gradient-to-r from-mythic-purple to-mythic-cyan text-white font-medium hover:shadow-lg hover:shadow-mythic-purple/25 transition-all duration-300 active:scale-[0.98] text-center"
              >
                Launch Bridge
              </Link>
              <Link
                href="/docs"
                className="w-full sm:w-auto px-8 py-3.5 rounded-lg bg-mythic-card border border-mythic-border text-white font-medium hover:border-mythic-purple/50 hover:bg-mythic-purple/5 transition-all duration-300 active:scale-[0.98] text-center"
              >
                Read Docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== STATS BAR ===== */}
      <StatsBar />

      {/* ===== FEATURES SECTION ===== */}
      <section className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Why <span className="gradient-text">Mythic</span>?
            </h2>
            <p className="text-mythic-text max-w-xl mx-auto">
              A new paradigm for blockchain infrastructure, built from the ground up for AI workloads.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={
                <svg className="w-6 h-6 text-mythic-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              }
              title="AI-Native Consensus"
              description="Proof of Useful AI Work. Validators earn $MYTH by running AI inference, not wasting energy. Every block validated contributes to the network's AI compute pool."
            />
            <FeatureCard
              icon={
                <svg className="w-6 h-6 text-mythic-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                </svg>
              }
              title="Decentralized Compute"
              description="Rent GPU, CPU, and storage from the network. Cheaper than AWS, powered by $MYTH. Deploy AI models, run inference, and scale instantly."
            />
            <FeatureCard
              icon={
                <svg className="w-6 h-6 text-mythic-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              }
              title="Built on Firedancer"
              description="The fastest SVM runtime. 1M+ TPS networking from day one. Full Solana program compatibility. No performance compromises."
            />
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="py-20 sm:py-28 border-y border-mythic-border/50 bg-mythic-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              How It Works
            </h2>
            <p className="text-mythic-text max-w-xl mx-auto">
              Get started with Mythic in three simple steps.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connecting line (desktop only) */}
            <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-px bg-gradient-to-r from-mythic-purple via-mythic-cyan to-mythic-purple opacity-30" />

            {/* Step 1 */}
            <div className="text-center relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-mythic-purple to-mythic-cyan flex items-center justify-center mx-auto mb-6 relative z-10">
                <span className="text-white font-bold">1</span>
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Buy $MYTH on Raydium</h3>
              <p className="text-mythic-text text-sm leading-relaxed">
                Swap SOL or USDC for $MYTH on Raydium. The token is fair-launched on PumpFun with zero VC allocation.
              </p>
            </div>

            {/* Step 2 */}
            <div className="text-center relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-mythic-purple to-mythic-cyan flex items-center justify-center mx-auto mb-6 relative z-10">
                <span className="text-white font-bold">2</span>
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Bridge to Mythic L2</h3>
              <p className="text-mythic-text text-sm leading-relaxed">
                Use the Mythic Bridge to deposit $MYTH, SOL, or USDC from Solana L1 to Mythic L2 in seconds.
              </p>
            </div>

            {/* Step 3 */}
            <div className="text-center relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-mythic-purple to-mythic-cyan flex items-center justify-center mx-auto mb-6 relative z-10">
                <span className="text-white font-bold">3</span>
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Use AI & Compute</h3>
              <p className="text-mythic-text text-sm leading-relaxed">
                Run AI inference, deploy models, rent compute, and build on the AI-native blockchain.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ARCHITECTURE SECTION ===== */}
      <section className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Architecture
            </h2>
            <p className="text-mythic-text max-w-xl mx-auto">
              How Mythic L2 processes transactions and settles to Solana.
            </p>
          </div>

          {/* Architecture Diagram */}
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Step 1 - Sequencer */}
              <div className="relative group">
                <div className="rounded-xl bg-mythic-card border border-mythic-border p-6 text-center hover:border-mythic-purple/30 transition-all duration-300 h-full">
                  <div className="w-10 h-10 rounded-lg bg-mythic-purple/10 border border-mythic-purple/20 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-mythic-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                    </svg>
                  </div>
                  <h4 className="text-white font-semibold text-sm mb-1">Sequencer</h4>
                  <p className="text-mythic-text text-xs leading-relaxed">Orders transactions and batches them for execution</p>
                </div>
                {/* Arrow (hidden on mobile) */}
                <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                  <svg className="w-4 h-4 text-mythic-purple/50" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 12h14m-4-4l4 4-4 4" />
                  </svg>
                </div>
              </div>

              {/* Step 2 - SVM Execution */}
              <div className="relative group">
                <div className="rounded-xl bg-mythic-card border border-mythic-border p-6 text-center hover:border-mythic-cyan/30 transition-all duration-300 h-full">
                  <div className="w-10 h-10 rounded-lg bg-mythic-cyan/10 border border-mythic-cyan/20 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-mythic-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
                    </svg>
                  </div>
                  <h4 className="text-white font-semibold text-sm mb-1">SVM Execution</h4>
                  <p className="text-mythic-text text-xs leading-relaxed">Firedancer-based SVM runs Solana-compatible programs</p>
                </div>
                <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                  <svg className="w-4 h-4 text-mythic-cyan/50" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 12h14m-4-4l4 4-4 4" />
                  </svg>
                </div>
              </div>

              {/* Step 3 - AI Verification */}
              <div className="relative group">
                <div className="rounded-xl bg-mythic-card border border-mythic-border p-6 text-center hover:border-mythic-purple/30 transition-all duration-300 h-full">
                  <div className="w-10 h-10 rounded-lg bg-mythic-purple/10 border border-mythic-purple/20 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-mythic-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  </div>
                  <h4 className="text-white font-semibold text-sm mb-1">AI Verification</h4>
                  <p className="text-mythic-text text-xs leading-relaxed">Proof of Useful AI Work validates state transitions</p>
                </div>
                <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                  <svg className="w-4 h-4 text-mythic-purple/50" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 12h14m-4-4l4 4-4 4" />
                  </svg>
                </div>
              </div>

              {/* Step 4 - Settlement */}
              <div className="relative group">
                <div className="rounded-xl bg-mythic-card border border-mythic-border p-6 text-center hover:border-mythic-cyan/30 transition-all duration-300 h-full">
                  <div className="w-10 h-10 rounded-lg bg-mythic-cyan/10 border border-mythic-cyan/20 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-mythic-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                  </div>
                  <h4 className="text-white font-semibold text-sm mb-1">Solana L1 Settlement</h4>
                  <p className="text-mythic-text text-xs leading-relaxed">State roots posted to Solana L1 for final security</p>
                </div>
              </div>
            </div>

            {/* Mobile arrows */}
            <div className="flex lg:hidden flex-col items-center -mt-2">
              {[0, 1, 2].map((i) => (
                <svg key={i} className="w-4 h-4 text-mythic-purple/30 my-1 hidden" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 5v14m-4-4l4 4 4-4" />
                </svg>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== TOKEN SECTION ===== */}
      <section className="py-20 sm:py-28 border-t border-mythic-border/50 bg-mythic-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-mythic-cyan/10 border border-mythic-cyan/20 text-mythic-cyan text-sm font-medium mb-6">
              Tokenomics
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              $MYTH — Fixed Supply, Deflationary
            </h2>
            <p className="text-mythic-text max-w-2xl mx-auto leading-relaxed">
              Every transaction burns $MYTH. No inflation. No VC unlocks. Fair-launched on PumpFun.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Token Info */}
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-mythic-card border border-mythic-border p-5">
                  <div className="text-mythic-text text-xs uppercase tracking-wider mb-1">Total Supply</div>
                  <div className="text-2xl font-bold gradient-text">1,000,000,000</div>
                </div>
                <div className="rounded-xl bg-mythic-card border border-mythic-border p-5">
                  <div className="text-mythic-text text-xs uppercase tracking-wider mb-1">Mechanism</div>
                  <div className="text-2xl font-bold text-orange-400">Burn</div>
                </div>
              </div>

              <div className="rounded-xl bg-mythic-card border border-mythic-border p-6 space-y-4">
                <h3 className="text-white font-semibold">Token Utility</h3>
                <ul className="space-y-3">
                  {[
                    'Gas fees on Mythic L2 (paid in $MYTH)',
                    'Staking for validator rewards',
                    'Payment for AI compute and inference',
                    'Governance voting rights',
                    'Compute marketplace settlement',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-mythic-text">
                      <svg className="w-4 h-4 text-mythic-cyan mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Fee Breakdown Table */}
            <div className="rounded-xl bg-mythic-card border border-mythic-border overflow-hidden">
              <div className="px-6 py-4 border-b border-mythic-border">
                <h3 className="text-white font-semibold">Fee Distribution</h3>
                <p className="text-mythic-text text-sm mt-1">Where your $MYTH fees go</p>
              </div>
              <TokenomicsTable />
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA SECTION ===== */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div className="hero-particles" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to Build on <span className="gradient-text">Mythic</span>?
          </h2>
          <p className="text-mythic-text max-w-xl mx-auto mb-10 leading-relaxed">
            Join the next generation of AI-native blockchain infrastructure. Bridge your assets, deploy your models, and start building.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/bridge"
              className="w-full sm:w-auto px-8 py-3.5 rounded-lg bg-gradient-to-r from-mythic-purple to-mythic-cyan text-white font-medium hover:shadow-lg hover:shadow-mythic-purple/25 transition-all duration-300 active:scale-[0.98] text-center"
            >
              Launch Bridge
            </Link>
            <Link
              href="/docs"
              className="w-full sm:w-auto px-8 py-3.5 rounded-lg bg-mythic-card border border-mythic-border text-white font-medium hover:border-mythic-purple/50 hover:bg-mythic-purple/5 transition-all duration-300 active:scale-[0.98] text-center"
            >
              Read Documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
