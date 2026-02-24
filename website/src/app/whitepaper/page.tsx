import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Whitepaper',
  description: 'Mythic Network Whitepaper — A Solana SVM Layer 2 with AI consensus, decentralized compute, and 1M+ TPS.',
}

/* ===== Reusable Typography ===== */

function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-display text-[2.4rem] sm:text-[3rem] font-extrabold tracking-[-0.02em] text-white mb-4 leading-tight">
      {children}
    </h1>
  )
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="font-display text-[1.6rem] sm:text-[1.9rem] font-bold tracking-[-0.02em] text-white mb-5 mt-16 scroll-mt-24 border-b border-white/[0.06] pb-3">
      {children}
    </h2>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-[1.05rem] sm:text-[1.15rem] font-semibold text-white mt-8 mb-3">
      {children}
    </h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-mythic-text text-[0.88rem] leading-[1.75] mb-4">
      {children}
    </p>
  )
}

function Callout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-l-[3px] border-mythic-violet bg-mythic-violet/5 p-5 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 bg-mythic-violet" />
        <span className="text-mythic-violet font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium">{label}</span>
      </div>
      <div className="text-mythic-text text-[0.84rem] leading-relaxed">{children}</div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-[#08080C] border border-white/[0.06] p-5 text-center">
      <div className="text-mythic-violet font-display text-[1.4rem] font-bold mb-1">{value}</div>
      <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">{label}</div>
    </div>
  )
}

/* ===== Table of Contents ===== */

const TOC = [
  { id: 'abstract', label: 'Abstract' },
  { id: 'introduction', label: '1. Introduction' },
  { id: 'architecture', label: '2. Architecture' },
  { id: 'consensus', label: '3. Consensus — PoUAIW' },
  { id: 'tokenomics', label: '4. Tokenomics' },
  { id: 'bridge', label: '5. Bridge & Settlement' },
  { id: 'ai-precompiles', label: '6. AI Precompiles' },
  { id: 'compute-marketplace', label: '7. Compute Marketplace' },
  { id: 'security', label: '8. Security Model' },
  { id: 'governance', label: '9. Governance' },
  { id: 'roadmap', label: '10. Roadmap' },
  { id: 'conclusion', label: '11. Conclusion' },
]

/* ===== PAGE ===== */

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06]">
        <div className="max-w-[860px] mx-auto px-5 sm:px-10 pt-20 pb-12">
          <div className="flex items-center gap-3 mb-6">
            <span className="px-2 py-0.5 font-mono text-[0.55rem] tracking-[0.12em] uppercase font-medium bg-mythic-violet/15 text-mythic-violet border border-mythic-violet/20">
              Whitepaper v1.0
            </span>
            <span className="font-mono text-[0.6rem] tracking-[0.08em] text-mythic-text-muted">
              February 2026
            </span>
          </div>
          <H1>Mythic Network</H1>
          <p className="text-mythic-text text-[1.05rem] leading-relaxed max-w-[640px] mb-6">
            A Solana SVM Layer 2 built on Firedancer with AI consensus, decentralized compute, and 1M+ TPS throughput.
          </p>
          <p className="font-mono text-[0.7rem] tracking-[0.06em] text-mythic-text-dim">
            Mythic Labs &mdash; <a href="https://mythic.sh" className="text-mythic-violet hover:underline">mythic.sh</a>
          </p>
        </div>
      </div>

      <div className="max-w-[860px] mx-auto px-5 sm:px-10 py-12">
        {/* Table of Contents */}
        <div className="bg-[#08080C] border border-white/[0.06] p-6 mb-12">
          <h3 className="font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium mb-4">Table of Contents</h3>
          <ol className="columns-1 sm:columns-2 gap-8 space-y-1.5">
            {TOC.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="text-mythic-text hover:text-mythic-violet transition-colors text-[0.84rem]">
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </div>

        {/* =============== ABSTRACT =============== */}
        <H2 id="abstract">Abstract</H2>
        <P>
          Mythic is a high-performance Layer 2 network built on the Solana Virtual Machine (SVM) using the Firedancer client. It introduces <strong className="text-white">Proof of Useful AI Work (PoUAIW)</strong> — a novel consensus mechanism where validators earn rewards by performing real AI inference tasks rather than solving arbitrary computational puzzles. Every block produced on Mythic simultaneously advances the blockchain and contributes verifiable compute to a decentralized AI marketplace.
        </P>
        <P>
          The network achieves throughput exceeding 1,000,000 transactions per second with 400ms block times by leveraging Firedancer&apos;s zero-copy networking architecture on dedicated hardware. All existing Solana programs deploy without modification on Mythic L2, providing immediate compatibility with the Solana ecosystem while adding native AI precompiles for inference, model verification, and logit validation at the execution layer.
        </P>
        <P>
          Settlement occurs on Solana L1 through an optimistic rollup model with fraud proofs, ensuring that the full security of Solana&apos;s validator set serves as the final arbiter of Mythic L2 state. $MYTH, the native currency, powers gas fees, validator staking, AI compute payments, and on-chain governance with a fixed supply and deflationary burn mechanism.
        </P>

        {/* Key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-8">
          <Stat value="1M+" label="TPS Throughput" />
          <Stat value="400ms" label="Block Time" />
          <Stat value="1B" label="Fixed Supply" />
          <Stat value="~60%" label="Lower Compute Cost" />
        </div>

        {/* =============== 1. INTRODUCTION =============== */}
        <H2 id="introduction">1. Introduction</H2>
        <P>
          The intersection of artificial intelligence and blockchain technology has produced a wave of projects that bolt AI capabilities onto existing chains as afterthoughts. Most of these integrations suffer from fundamental architectural constraints: smart contract platforms were never designed to handle the data throughput, memory requirements, or latency demands of AI inference workloads.
        </P>
        <P>
          Mythic takes a different approach. Rather than adding AI to an existing blockchain, we have built a blockchain that is AI-native from the ground up. The execution environment, consensus mechanism, validator economics, and system-level precompiles are all designed around the dual objective of processing transactions and serving AI compute — in the same pipeline, using the same hardware.
        </P>

        <H3>1.1 The Problem</H3>
        <P>
          Current decentralized compute networks face three interrelated challenges:
        </P>
        <ul className="space-y-3 mb-6 pl-1">
          {[
            ['Verification gap', 'There is no trustless way to verify that a remote GPU actually ran the claimed inference correctly. Existing networks rely on reputation or economic bonds, neither of which provides cryptographic guarantees.'],
            ['Latency mismatch', 'Blockchain settlement is too slow for interactive AI workloads. If every inference must wait for block finality, the user experience is orders of magnitude worse than centralized alternatives.'],
            ['Economic misalignment', 'Traditional proof-of-work wastes energy on puzzles that serve no useful purpose. Proof-of-stake secures the chain but does not utilize validator hardware for productive compute during idle periods.'],
          ].map(([title, desc]) => (
            <li key={title} className="flex items-start gap-3 text-[0.84rem]">
              <span className="text-mythic-violet mt-1 flex-shrink-0">—</span>
              <span className="text-mythic-text"><strong className="text-white">{title}:</strong> {desc}</span>
            </li>
          ))}
        </ul>

        <H3>1.2 The Solution</H3>
        <P>
          Mythic addresses each challenge through architecture-level decisions:
        </P>
        <ul className="space-y-3 mb-6 pl-1">
          {[
            ['PoUAIW consensus', 'Validators verify AI outputs by re-executing inference with deterministic sampling. The verification itself is useful work — checked outputs are cached and resold through the compute marketplace.'],
            ['Firedancer-speed execution', 'Sub-second soft confirmations via the Firedancer sequencer allow AI applications to achieve latency comparable to centralized APIs while retaining on-chain settlement guarantees.'],
            ['Unified economics', 'Validators earn $MYTH from both transaction fees and AI compute payments. Hardware required for block production (high-end GPUs, fast networking) is the same hardware required for inference — there is no idle capacity.'],
          ].map(([title, desc]) => (
            <li key={title} className="flex items-start gap-3 text-[0.84rem]">
              <span className="text-mythic-violet mt-1 flex-shrink-0">—</span>
              <span className="text-mythic-text"><strong className="text-white">{title}:</strong> {desc}</span>
            </li>
          ))}
        </ul>

        {/* =============== 2. ARCHITECTURE =============== */}
        <H2 id="architecture">2. Architecture</H2>
        <P>
          Mythic L2 uses a modular architecture that separates transaction ordering, execution, AI verification, and L1 settlement into distinct layers. Each component can be scaled and upgraded independently while maintaining end-to-end security through Solana L1 as the data availability and settlement layer.
        </P>

        <H3>2.1 Execution Layer — Firedancer SVM</H3>
        <P>
          The execution layer is a modified Firedancer client running the Solana Virtual Machine. Firedancer&apos;s zero-copy networking, io_uring-based I/O, and NUMA-aware memory allocation deliver throughput exceeding 1M TPS on commodity server hardware. Mythic extends the standard Firedancer runtime with three additions:
        </P>
        <ul className="space-y-2 mb-6 pl-1">
          {[
            'AI precompile programs (RunInference, VerifyLogits, RegisterModel) loaded as native system programs',
            'Modified tile layout with dedicated GPU inference tiles alongside standard networking and execution tiles',
            'Extended transaction metadata for AI job routing, model versioning, and compute attestation',
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 text-[0.84rem] text-mythic-text">
              <svg className="w-3.5 h-3.5 text-mythic-violet mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {item}
            </li>
          ))}
        </ul>

        <H3>2.2 Sequencer</H3>
        <P>
          The sequencer receives user transactions, orders them by priority fee, and creates batches for execution. It provides soft confirmations within 400ms — the user receives a provisional receipt before the batch is committed to an L2 block. The sequencer is currently centralized (operated by Mythic Labs) with a planned transition to decentralized sequencer rotation in Phase 4.
        </P>

        <H3>2.3 Data Availability</H3>
        <P>
          Transaction data is posted to Solana L1 in compressed form using erasure coding. This ensures that the complete L2 state can be reconstructed from L1 data alone, even if the Mythic sequencer goes offline. Full nodes can independently verify the L2 state by replaying L1 data.
        </P>

        <H3>2.4 Settlement on Solana L1</H3>
        <P>
          State roots are posted to the Mythic settlement contract on Solana L1 at regular intervals. The settlement contract validates state root commitments and manages the fraud proof challenge window. Any honest observer can submit a fraud proof within 7 days to challenge an invalid state transition, with successful challengers rewarded from the sequencer&apos;s bond.
        </P>

        <Callout label="Full Solana Compatibility">
          Any program compiled for the Solana Virtual Machine deploys and runs on Mythic L2 without modification. This includes SPL tokens, Metaplex NFT programs, Marinade staking, and all standard Solana program libraries. Developers do not need to learn a new language or rewrite contracts.
        </Callout>

        {/* =============== 3. CONSENSUS =============== */}
        <H2 id="consensus">3. Consensus — Proof of Useful AI Work</H2>
        <P>
          Proof of Useful AI Work (PoUAIW) is the core innovation of the Mythic network. It replaces the wasted computation of traditional proof-of-work with verifiable AI inference tasks, and augments the passive security of proof-of-stake with active utilization of validator hardware.
        </P>

        <H3>3.1 How It Works</H3>
        <div className="bg-[#08080C] border border-white/[0.06] p-6 mb-6 space-y-4">
          {[
            ['Block Proposal', 'The current leader proposes a block containing ordered transactions. A subset of transactions include AI inference requests (submitted via the RunInference precompile).'],
            ['Inference Execution', 'The leader executes all AI inferences using the registered model weights and deterministic sampling parameters. Inference results (output tokens, logit hashes, confidence scores) are included in the block.'],
            ['Validator Re-execution', 'A quorum of validators independently re-execute the same inferences using their local copies of the model weights. Each validator computes the KL divergence between their logit distribution and the leader\'s claimed output.'],
            ['Attestation', 'Validators submit attestation transactions if the divergence is below the acceptable threshold. If a supermajority attests, the block is finalized. If divergence exceeds the threshold, a fraud proof is generated and the leader is slashed.'],
          ].map(([title, desc], i) => (
            <div key={title} className="flex items-start gap-4">
              <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-mythic-violet text-sm font-bold">{i + 1}</span>
              </div>
              <div>
                <h4 className="text-white font-medium text-[0.88rem] mb-1">{title}</h4>
                <p className="text-mythic-text text-[0.82rem] leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <H3>3.2 Deterministic Inference</H3>
        <P>
          AI inference is not inherently deterministic — floating-point operations can produce different results on different hardware. Mythic solves this by requiring validators to use quantized model weights (INT8/INT4) and fixed random seeds for sampling. The combination of quantized weights and deterministic sampling ensures that independent executions produce identical logit distributions within a tolerance of ε = 10⁻⁵.
        </P>

        <H3>3.3 Model Registry</H3>
        <P>
          All models available for on-chain inference must be registered through the RegisterModel precompile. Registration includes a SHA-256 hash of the quantized model weights, an IPFS or Arweave URI for retrieval, and a minimum stake requirement for validators serving that model. Validators download and cache model weights locally; models are not stored on-chain.
        </P>

        {/* =============== 4. TOKENOMICS =============== */}
        <H2 id="tokenomics">4. Tokenomics</H2>
        <P>
          $MYTH is the native currency of the Mythic L2 blockchain. It is minted at genesis with a fixed supply of 1,000,000,000 tokens, 9 decimal places, and zero inflation. There are no team vesting schedules, no investor unlock cliffs, and no inflationary rewards. The supply can only decrease through burns.
        </P>

        <H3>4.1 Token Utility</H3>
        <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-4 font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Function</th>
                <th className="text-left py-3 px-4 font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Gas fees', 'Every L2 transaction pays gas in native $MYTH'],
                ['Validator staking', 'Validators bond $MYTH to participate in block production and AI verification'],
                ['AI compute', 'Inference requests and model verification are priced in $MYTH'],
                ['Governance', 'Stake-weighted voting on protocol parameters and upgrades'],
                ['Compute marketplace', 'Settlement currency for GPU/CPU/storage resource listings'],
                ['Sequencer bond', 'The sequencer stakes $MYTH as collateral against invalid state transitions'],
              ].map(([fn, desc]) => (
                <tr key={fn} className="border-b border-white/[0.04]">
                  <td className="py-3 px-4 text-white text-[0.82rem] font-medium whitespace-nowrap">{fn}</td>
                  <td className="py-3 px-4 text-mythic-text text-[0.82rem]">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H3>4.2 Fee Distribution</H3>
        <P>
          All fees on Mythic L2 are denominated in native $MYTH. Each fee is split across three destinations:
        </P>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#08080C] border border-white/[0.06] p-4 text-center">
            <div className="text-mythic-violet font-display text-[1.2rem] font-bold">60%</div>
            <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-mythic-text-muted mt-1">Validators</div>
          </div>
          <div className="bg-[#08080C] border border-white/[0.06] p-4 text-center">
            <div className="text-mythic-violet font-display text-[1.2rem] font-bold">10%</div>
            <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-mythic-text-muted mt-1">Foundation</div>
          </div>
          <div className="bg-[#08080C] border border-white/[0.06] p-4 text-center">
            <div className="text-[#FF2D78] font-display text-[1.2rem] font-bold">30%</div>
            <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-mythic-text-muted mt-1">Burned</div>
          </div>
        </div>

        <H3>4.3 Deflationary Mechanism</H3>
        <P>
          With 30–40% of all fees permanently burned, the circulating supply of $MYTH monotonically decreases. As network usage grows, the burn rate accelerates — creating reflexive scarcity. At projected mainnet throughput of 10,000 TPS average utilization, the annual burn rate exceeds 2% of total supply. There are no offsetting emissions; the supply curve is strictly decreasing.
        </P>

        <Callout label="PumpFun Token vs. Native L2 $MYTH">
          The $MYTH SPL token traded on PumpFun and Raydium on Solana L1 represents early community access. The native L2 $MYTH is the gas currency of the Mythic blockchain, created at genesis and used for all on-chain operations. Users can bridge assets between L1 and L2. These are economically linked but technically distinct tokens.
        </Callout>

        {/* =============== 5. BRIDGE =============== */}
        <H2 id="bridge">5. Bridge &amp; Settlement</H2>
        <P>
          The Mythic Bridge is a trust-minimized system for moving assets between Solana L1 and Mythic L2. It currently supports SOL, with additional assets (including USDC and Token-2022 tokens) added through governance.
        </P>

        <H3>5.1 Deposits (L1 → L2)</H3>
        <P>
          Deposits are processed within seconds. Users send assets to the bridge contract on Solana L1. The Mythic sequencer monitors the bridge contract and credits the equivalent amount to the user&apos;s L2 address. Deposited SOL is credited as $MYTH at the current exchange rate. Deposits benefit from Solana L1&apos;s ~400ms finality — funds are available on L2 within approximately 10 seconds.
        </P>

        <H3>5.2 Withdrawals (L2 → L1)</H3>
        <P>
          Withdrawals use an optimistic model with a 7-day challenge period. The user initiates a withdrawal on L2, which burns the L2 tokens and generates a withdrawal proof. After the challenge period expires without a successful fraud proof, the user claims their tokens on Solana L1. This delay ensures that any invalid state transition can be detected and challenged before funds are released.
        </P>

        <H3>5.3 Settlement Contract</H3>
        <P>
          The Mythic settlement contract (deployed on Solana L1) serves three functions: it records L2 state roots, manages the fraud proof challenge window, and releases bridged assets after the challenge period. The contract is secured by Solana L1&apos;s validator set — the most economically secure proof-of-stake network in production.
        </P>

        {/* =============== 6. AI PRECOMPILES =============== */}
        <H2 id="ai-precompiles">6. AI Precompiles</H2>
        <P>
          Mythic includes three native AI precompiles — system-level programs compiled into the execution layer that provide AI inference and verification capabilities to any Solana program running on the network.
        </P>

        <div className="space-y-6 mb-6">
          {[
            {
              name: 'RunInference',
              id: 'MythAI1111111111111111111111111111111111111',
              desc: 'Execute AI model inference on-chain. Submit input data and a model identifier, receive the model output as part of the transaction result. Supports LLM, vision, audio, and embedding models.',
            },
            {
              name: 'VerifyLogits',
              id: 'MythAI2222222222222222222222222222222222222',
              desc: 'Verify that a given model output matches expected logit distributions. Used during PoUAIW consensus to validate inference results. Returns a boolean validity flag and KL divergence score.',
            },
            {
              name: 'RegisterModel',
              id: 'MythAI3333333333333333333333333333333333333',
              desc: 'Register a new AI model on the network. Stores the SHA-256 hash of quantized weights, the retrieval URI (IPFS/Arweave), model type, and minimum validator stake. Models must be registered before use with RunInference.',
            },
          ].map((precompile) => (
            <div key={precompile.name} className="bg-[#08080C] border border-white/[0.06] p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2 py-0.5 font-mono text-[0.55rem] tracking-[0.1em] uppercase font-medium bg-mythic-violet/15 text-mythic-violet border border-mythic-violet/20">
                  {precompile.name}
                </span>
              </div>
              <p className="font-mono text-[0.65rem] text-mythic-text-dim mb-2 break-all">{precompile.id}</p>
              <p className="text-mythic-text text-[0.82rem] leading-relaxed">{precompile.desc}</p>
            </div>
          ))}
        </div>

        {/* =============== 7. COMPUTE MARKETPLACE =============== */}
        <H2 id="compute-marketplace">7. Compute Marketplace</H2>
        <P>
          The Mythic Compute Marketplace is a decentralized exchange for GPU, CPU, and storage resources. Providers register their hardware, set pricing in $MYTH per compute unit, and receive payment as consumers use their resources. All settlement occurs on-chain through escrow contracts.
        </P>

        <H3>7.1 Provider Economics</H3>
        <P>
          Providers stake $MYTH as a quality bond and submit hardware attestations (GPU model, VRAM, CPU cores, storage capacity). The marketplace uses these attestations to match consumer requests with qualified providers. Providers are penalized (slashed) for failed job completions or incorrect outputs, ensuring reliability.
        </P>

        <H3>7.2 Pricing</H3>
        <P>
          By aggregating spare compute capacity from a global pool of providers, Mythic achieves prices 55–65% below centralized cloud providers for equivalent resources. Pricing is market-driven — providers compete on cost and reliability, and consumers benefit from transparent, on-chain price discovery.
        </P>
        <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-4 font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Resource</th>
                <th className="text-center py-3 px-4 font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">AWS</th>
                <th className="text-center py-3 px-4 font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Mythic</th>
                <th className="text-center py-3 px-4 font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Savings</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['A100 80GB GPU/hr', '$3.67', '~$1.50', '~59%'],
                ['H100 80GB GPU/hr', '$8.20', '~$3.50', '~57%'],
                ['64-core CPU/hr', '$2.45', '~$0.90', '~63%'],
                ['1TB Storage/mo', '$23.00', '~$8.00', '~65%'],
              ].map(([resource, aws, mythic, savings]) => (
                <tr key={resource} className="border-b border-white/[0.04]">
                  <td className="py-3 px-4 text-white text-[0.82rem]">{resource}</td>
                  <td className="py-3 px-4 text-center text-mythic-text text-[0.82rem]">{aws}</td>
                  <td className="py-3 px-4 text-center text-mythic-violet text-[0.82rem]">{mythic}</td>
                  <td className="py-3 px-4 text-center text-green-400 text-[0.82rem]">{savings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* =============== 8. SECURITY =============== */}
        <H2 id="security">8. Security Model</H2>
        <P>
          Mythic&apos;s security derives from three independent layers, each providing defense-in-depth against different attack vectors.
        </P>

        <H3>8.1 Solana L1 Settlement Security</H3>
        <P>
          The Mythic settlement contract on Solana L1 is the ultimate source of truth for L2 state. Any state transition posted to L1 can be challenged within 7 days by submitting a fraud proof. The challenge bond is set high enough to deter frivolous challenges while remaining accessible to honest observers. Successful challengers receive the sequencer&apos;s bond as a reward.
        </P>

        <H3>8.2 AI Verification Security</H3>
        <P>
          PoUAIW provides a second layer of security: validators independently verify AI inference results, catching any attempt to return fabricated outputs. Because verification uses the same model weights and deterministic sampling, an attacker would need to compromise a supermajority of validators simultaneously — an attack that is economically equivalent to a 67% stake attack on the entire network.
        </P>

        <H3>8.3 Economic Security</H3>
        <P>
          Validators and the sequencer stake $MYTH as collateral. Malicious behavior results in slashing: partial or total loss of staked tokens. The slashing penalty is calibrated to exceed the expected profit from any attack, ensuring that honest participation is always the dominant strategy. Slashed tokens are burned, further reducing supply and benefiting all remaining token holders.
        </P>

        {/* =============== 9. GOVERNANCE =============== */}
        <H2 id="governance">9. Governance</H2>
        <P>
          Mythic governance is stake-weighted: one $MYTH staked equals one vote. Governance proposals can modify protocol parameters (fee rates, burn percentages, challenge periods), approve new bridged assets, adjust validator requirements, and schedule protocol upgrades. All governance actions are executed on-chain through the governance program.
        </P>
        <P>
          The governance system will be activated in Phase 4 (Full Decentralization). Until then, protocol parameters are managed by Mythic Labs with community input through public RFCs and temperature checks.
        </P>

        {/* =============== 10. ROADMAP =============== */}
        <H2 id="roadmap">10. Roadmap</H2>

        <div className="space-y-5 mt-6 mb-8">
          {[
            {
              phase: 'Phase 1',
              subtitle: 'Foundation',
              title: 'Network Genesis',
              status: 'active',
              items: [
                '$MYTH token launch on PumpFun (fair launch, no presale)',
                'Firedancer-based SVM L2 testnet deployment',
                'Bridge contract on Solana L1',
                'Block explorer, RPC infrastructure, and developer SDK',
                'Initial validator onboarding',
              ],
            },
            {
              phase: 'Phase 2',
              subtitle: 'AI Integration',
              title: 'AI Precompiles & Consensus',
              status: 'upcoming',
              items: [
                'RunInference, VerifyLogits, RegisterModel precompiles go live',
                'Proof of Useful AI Work consensus mechanism activation',
                'AI model registry with IPFS/Arweave storage',
                'Mainnet beta launch with optimistic fraud proofs',
                'Bridge v2 with fast finality mode',
              ],
            },
            {
              phase: 'Phase 3',
              subtitle: 'Compute Marketplace',
              title: 'Decentralized Cloud',
              status: 'upcoming',
              items: [
                'Compute marketplace launch (GPU, CPU, storage)',
                'Provider registration and hardware attestation',
                'Automated matching and escrow system',
                'SDK for programmatic compute requests',
                'Integration with major AI frameworks (PyTorch, TensorFlow)',
              ],
            },
            {
              phase: 'Phase 4',
              subtitle: 'Full Decentralization',
              title: 'Autonomous Network',
              status: 'upcoming',
              items: [
                'Decentralized sequencer rotation',
                'On-chain governance via $MYTH voting',
                'Cross-chain AI compute (EVM chains, Cosmos)',
                'ZK proofs for instant withdrawal finality',
                'Community-governed protocol upgrades',
              ],
            },
          ].map((phase) => (
            <div key={phase.phase} className="relative pl-8 border-l-2 border-mythic-violet/30">
              <div className={`absolute -left-[5px] top-0 w-2 h-2 ${phase.status === 'active' ? 'bg-mythic-violet animate-pulse' : 'bg-mythic-violet/40'}`} />
              <div className="bg-[#08080C] border border-white/[0.06] p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-0.5 font-mono text-[0.55rem] tracking-[0.1em] uppercase font-medium border ${phase.status === 'active' ? 'bg-mythic-violet/20 text-mythic-violet border-mythic-violet/30' : 'bg-white/[0.03] text-mythic-text-dim border-white/[0.06]'}`}>
                    {phase.phase}
                  </span>
                  <span className="text-mythic-text-dim text-[0.78rem]">{phase.subtitle}</span>
                  {phase.status === 'active' && (
                    <span className="ml-auto px-2 py-0.5 font-mono text-[0.5rem] tracking-[0.1em] uppercase font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                      Current
                    </span>
                  )}
                </div>
                <h4 className="text-white font-display font-semibold text-[0.95rem] mb-2">{phase.title}</h4>
                <ul className="space-y-1.5">
                  {phase.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[0.8rem] text-mythic-text">
                      <span className="text-mythic-violet mt-0.5">—</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* =============== 11. CONCLUSION =============== */}
        <H2 id="conclusion">11. Conclusion</H2>
        <P>
          Mythic represents a fundamental rethinking of what a blockchain can be. By making AI inference a first-class primitive of the execution environment and consensus mechanism, we eliminate the artificial boundary between &ldquo;blockchain&rdquo; and &ldquo;compute network.&rdquo; Every block produced on Mythic advances the chain, verifies AI outputs, and contributes capacity to a decentralized compute marketplace — simultaneously.
        </P>
        <P>
          The combination of Firedancer&apos;s raw throughput (1M+ TPS), Solana L1&apos;s settlement security, a fixed-supply deflationary token model, and purpose-built AI precompiles creates a platform where AI applications can achieve performance comparable to centralized providers while inheriting the censorship resistance, transparency, and composability of a public blockchain.
        </P>
        <P>
          Mythic is infrastructure for the next generation of AI — built on-chain, verified on-chain, and accessible to everyone.
        </P>

        {/* Back to top + docs link */}
        <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/docs" className="text-mythic-violet hover:text-mythic-violet-bright transition-colors text-[0.84rem] font-medium">
            ← Read the Documentation
          </Link>
          <a href="#abstract" className="text-mythic-text-dim hover:text-white transition-colors text-[0.78rem] font-mono tracking-[0.05em]">
            Back to top ↑
          </a>
        </div>
      </div>
    </div>
  )
}
