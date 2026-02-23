'use client'

import { useState, useCallback } from 'react'
import DocsSidebar from '@/components/DocsSidebar'
import TokenomicsTable from '@/components/TokenomicsTable'

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-6 scroll-mt-24">
      {children}
    </h2>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-[1.1rem] sm:text-[1.2rem] font-semibold text-white mt-8 mb-4">
      {children}
    </h3>
  )
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-mythic-text text-[0.88rem] leading-relaxed mb-4">
      {children}
    </p>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-black border border-white/[0.06] p-4 overflow-x-auto mb-6">
      <code className="text-[0.78rem] text-mythic-violet font-mono">{children}</code>
    </pre>
  )
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-[3px] border-mythic-violet bg-mythic-violet/5 p-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-mythic-violet font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium">{title}</span>
      </div>
      <div className="text-mythic-text text-[0.82rem] leading-relaxed">{children}</div>
    </div>
  )
}

/* ========================= SECTIONS ========================= */

function OverviewSection() {
  return (
    <section>
      <SectionHeading id="overview">Overview</SectionHeading>
      <Paragraph>
        Mythic is a Solana Virtual Machine (SVM) Layer 2 blockchain built on the Firedancer runtime. It is designed from the ground up to serve as infrastructure for AI-native decentralized computing, combining the speed and composability of Solana with purpose-built AI consensus and a decentralized compute marketplace.
      </Paragraph>
      <Paragraph>
        Unlike general-purpose Layer 2 networks, Mythic introduces Proof of Useful AI Work (PoUAIW) as its consensus mechanism. Validators do not simply attest to block validity -- they earn $MYTH by performing real AI inference tasks that contribute to the network. This means every block produced on Mythic advances both the blockchain and the AI compute available to users.
      </Paragraph>

      <SubHeading>Key Features</SubHeading>
      <ul className="space-y-3 mb-6">
        {[
          '1,000,000+ TPS throughput via Firedancer networking stack',
          '400ms block times for near-instant confirmation',
          'Full Solana program compatibility (deploy existing Solana programs without modification)',
          'AI-native precompiles for inference, model verification, and logit validation',
          'Decentralized compute marketplace for GPU, CPU, and storage',
          'Native bridge to Solana L1 with optimistic fraud proofs',
          '$MYTH token with deflationary burn mechanism on every transaction',
        ].map((item) => (
          <li key={item} className="flex items-start gap-3 text-[0.82rem] text-mythic-text">
            <svg className="w-4 h-4 text-mythic-violet mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {item}
          </li>
        ))}
      </ul>

      <InfoBox title="Network Status">
        Mythic L2 is currently in active development. Testnet is coming soon. Follow <a href="https://twitter.com/MythicL2" target="_blank" rel="noopener noreferrer" className="text-mythic-violet hover:underline">@MythicL2</a> for updates.
      </InfoBox>
    </section>
  )
}

function ArchitectureSection() {
  return (
    <section>
      <SectionHeading id="architecture">Architecture</SectionHeading>
      <Paragraph>
        Mythic L2 uses a modular architecture that separates transaction ordering, execution, verification, and settlement into distinct layers. This allows each component to be optimized independently while maintaining security guarantees through Solana L1 settlement.
      </Paragraph>

      <SubHeading>Transaction Lifecycle</SubHeading>
      <div className="bg-[#08080C] border border-white/[0.06] p-6 mb-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-sm font-bold">1</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">Sequencer</h4>
            <p className="text-mythic-text text-[0.82rem]">Receives user transactions, orders them by priority fee, and creates transaction batches. The sequencer provides soft confirmations within 400ms.</p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-sm font-bold">2</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">SVM Execution (Firedancer)</h4>
            <p className="text-mythic-text text-[0.82rem]">Batches are executed by the Firedancer-based SVM runtime. All standard Solana programs work natively. AI precompiles are available as system programs for inference and verification tasks.</p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-sm font-bold">3</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">AI Verification</h4>
            <p className="text-mythic-text text-[0.82rem]">Validators running AI inference validate the state transitions. Proof of Useful AI Work ensures that validation itself contributes compute to the network. Invalid state transitions can be challenged via fraud proofs.</p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-sm font-bold">4</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">Solana L1 Settlement</h4>
            <p className="text-mythic-text text-[0.82rem]">State roots and data availability commitments are posted to Solana L1 periodically. This provides the security of Solana&apos;s validator set as the final arbiter of Mythic L2 state.</p>
          </div>
        </div>
      </div>

      <SubHeading>Data Availability</SubHeading>
      <Paragraph>
        Transaction data is posted to Solana L1 in compressed form. The Mythic sequencer uses erasure coding to ensure data availability even if some L1 slots are missed. Full nodes can reconstruct the entire L2 state from L1 data alone.
      </Paragraph>

      <SubHeading>Fraud Proofs</SubHeading>
      <Paragraph>
        Mythic uses an optimistic rollup model. State transitions are assumed valid unless challenged within a 7-day window. Any node can submit a fraud proof to the L1 settlement contract, proving that a specific state transition was invalid. Successful challengers are rewarded from the sequencer&apos;s bond.
      </Paragraph>
    </section>
  )
}

function TokenomicsSection() {
  return (
    <section>
      <SectionHeading id="tokenomics">$MYTH Token</SectionHeading>
      <Paragraph>
        $MYTH is the native token of the Mythic L2 network. It has a fixed total supply of 1,000,000,000 tokens with no inflation mechanism. Every transaction on Mythic burns a portion of the fee, making the token deflationary over time.
      </Paragraph>

      <SubHeading>Token Details</SubHeading>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Supply', value: '1,000,000,000' },
          { label: 'Token Type', value: 'SPL (Solana)' },
          { label: 'Launch', value: 'PumpFun Fair Launch' },
          { label: 'VC Allocation', value: '0%' },
        ].map((item) => (
          <div key={item.label} className="bg-[#08080C] border border-white/[0.06] p-4">
            <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">{item.label}</div>
            <div className="text-white font-semibold text-[0.82rem]">{item.value}</div>
          </div>
        ))}
      </div>

      <SubHeading>Fee Distribution</SubHeading>
      <Paragraph>
        All fees on Mythic L2 are paid in $MYTH. Each fee type distributes across three destinations: validators (who run the network), the foundation (which funds development), and the burn address (removing tokens from circulation permanently).
      </Paragraph>

      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-8">
        <TokenomicsTable />
      </div>

      <SubHeading>Staking</SubHeading>
      <Paragraph>
        Validators must stake a minimum amount of $MYTH to participate in block production and AI verification. Staked $MYTH earns rewards from transaction fees. The staking APY is dynamic, based on the total amount staked and network activity.
      </Paragraph>

      <InfoBox title="Deflationary Model">
        With 30-40% of all fees burned, the circulating supply of $MYTH decreases with every transaction. As network usage grows, the burn rate accelerates. There are no token unlocks, no team vesting, and no inflationary rewards.
      </InfoBox>
    </section>
  )
}

function BridgeDocsSection() {
  return (
    <section>
      <SectionHeading id="bridge">Bridge</SectionHeading>
      <Paragraph>
        The Mythic Bridge allows users to move assets between Solana L1 and Mythic L2. It supports $MYTH, SOL, and USDC with more assets coming soon.
      </Paragraph>

      <SubHeading>Depositing (L1 to L2)</SubHeading>
      <Paragraph>
        Deposits are processed within seconds. When you deposit assets to Mythic L2, the bridge contract on Solana L1 locks your tokens and the Mythic sequencer credits the equivalent amount to your L2 address.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">1.</span>
          <span className="text-mythic-text">Connect your Solana wallet on the Bridge page</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">2.</span>
          <span className="text-mythic-text">Select asset and enter amount</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">3.</span>
          <span className="text-mythic-text">Confirm the deposit transaction in your wallet</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">4.</span>
          <span className="text-mythic-text">Funds appear on Mythic L2 within ~10 seconds</span>
        </div>
      </div>

      <SubHeading>Withdrawing (L2 to L1)</SubHeading>
      <Paragraph>
        Withdrawals use an optimistic model with a 7-day challenge period. This delay ensures that any fraudulent state transitions can be detected and challenged before funds are released on L1.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">1.</span>
          <span className="text-mythic-text">Initiate withdrawal on the Bridge page</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">2.</span>
          <span className="text-mythic-text">L2 tokens are burned, withdrawal proof is generated</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">3.</span>
          <span className="text-mythic-text">Wait 7-day challenge period</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">4.</span>
          <span className="text-mythic-text">Claim tokens on Solana L1</span>
        </div>
      </div>

      <InfoBox title="Bridge Security">
        The bridge contract is secured by the Solana L1 validator set. Withdrawal proofs are verified on-chain, and the 7-day challenge period allows any honest observer to submit fraud proofs if the withdrawal is based on an invalid L2 state.
      </InfoBox>
    </section>
  )
}

function AIPrecompilesSection() {
  return (
    <section>
      <SectionHeading id="ai-precompiles">AI Precompiles</SectionHeading>
      <Paragraph>
        Mythic L2 includes native AI precompiles -- system-level programs that provide AI inference and verification capabilities directly in the execution layer. These are available to any Solana program running on Mythic.
      </Paragraph>

      <SubHeading>RunInference</SubHeading>
      <Paragraph>
        Execute AI model inference on-chain. Submit input data and a model identifier, and receive the model output as part of the transaction result.
      </Paragraph>
      <CodeBlock>{`// RunInference precompile
// Program ID: MythAI1111111111111111111111111111111111111

Instruction Data:
  - model_id: [32 bytes]     // Registered model identifier
  - input_data: [variable]   // Model input (tokenized)
  - max_tokens: u32          // Maximum output tokens
  - temperature: f32         // Sampling temperature

Returns:
  - output_data: [variable]  // Model output
  - confidence: f32          // Output confidence score
  - compute_units: u64       // CU consumed`}</CodeBlock>

      <SubHeading>VerifyLogits</SubHeading>
      <Paragraph>
        Verify that a given model output matches expected logit distributions. Used for validating AI inference results during the consensus process.
      </Paragraph>
      <CodeBlock>{`// VerifyLogits precompile
// Program ID: MythAI2222222222222222222222222222222222222

Instruction Data:
  - model_id: [32 bytes]     // Model that produced the output
  - input_data: [variable]   // Original input
  - output_data: [variable]  // Output to verify
  - logits_hash: [32 bytes]  // Expected logits hash

Returns:
  - valid: bool              // Whether output matches
  - divergence: f32          // KL divergence from expected`}</CodeBlock>

      <SubHeading>RegisterModel</SubHeading>
      <Paragraph>
        Register a new AI model on the Mythic network. Models must be registered before they can be used with RunInference.
      </Paragraph>
      <CodeBlock>{`// RegisterModel precompile
// Program ID: MythAI3333333333333333333333333333333333333

Instruction Data:
  - model_hash: [32 bytes]   // SHA-256 of model weights
  - model_uri: String        // IPFS or Arweave URI
  - model_type: enum         // LLM, Vision, Audio, etc.
  - min_stake: u64           // Min validator stake to serve

Returns:
  - model_id: [32 bytes]     // Assigned model identifier
  - registered_at: i64       // Timestamp`}</CodeBlock>
    </section>
  )
}

function ComputeMarketplaceSection() {
  return (
    <section>
      <SectionHeading id="compute-marketplace">Compute Marketplace</SectionHeading>
      <Paragraph>
        The Mythic Compute Marketplace is a decentralized marketplace for GPU, CPU, and storage resources. Providers register their hardware and set pricing; consumers rent compute by paying $MYTH.
      </Paragraph>

      <SubHeading>For Providers</SubHeading>
      <Paragraph>
        Anyone with spare compute capacity can register as a provider. The registration process involves staking $MYTH and submitting a hardware attestation.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">1.</span>
          <span className="text-mythic-text">Stake minimum required $MYTH as a provider bond</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">2.</span>
          <span className="text-mythic-text">Submit hardware attestation (GPU model, VRAM, CPU cores, storage)</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">3.</span>
          <span className="text-mythic-text">Set your pricing in $MYTH per compute unit</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">4.</span>
          <span className="text-mythic-text">Receive $MYTH payments as consumers use your resources</span>
        </div>
      </div>

      <SubHeading>For Consumers</SubHeading>
      <Paragraph>
        Request compute resources by specifying requirements (GPU type, VRAM, duration) and a maximum price. The marketplace matches you with the best available provider.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">1.</span>
          <span className="text-mythic-text">Specify compute requirements and budget</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">2.</span>
          <span className="text-mythic-text">Marketplace matches you with a provider</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">3.</span>
          <span className="text-mythic-text">$MYTH payment is escrowed in the marketplace contract</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">4.</span>
          <span className="text-mythic-text">Provider delivers compute, payment is released upon completion</span>
        </div>
      </div>

      <SubHeading>Pricing Comparison</SubHeading>
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Resource</th>
              <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">AWS</th>
              <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Mythic</th>
              <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Savings</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">A100 80GB GPU/hr</td>
              <td className="py-3.5 px-4 text-center text-mythic-text text-[0.82rem]">$3.67</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">~$1.50</td>
              <td className="py-3.5 px-4 text-center text-green-400 text-[0.82rem]">~59%</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">H100 80GB GPU/hr</td>
              <td className="py-3.5 px-4 text-center text-mythic-text text-[0.82rem]">$8.20</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">~$3.50</td>
              <td className="py-3.5 px-4 text-center text-green-400 text-[0.82rem]">~57%</td>
            </tr>
            <tr>
              <td className="py-3.5 px-4 text-white text-[0.82rem]">1TB Storage/mo</td>
              <td className="py-3.5 px-4 text-center text-mythic-text text-[0.82rem]">$23.00</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">~$8.00</td>
              <td className="py-3.5 px-4 text-center text-green-400 text-[0.82rem]">~65%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ValidatorsSection() {
  return (
    <section>
      <SectionHeading id="validators">Validators</SectionHeading>
      <Paragraph>
        Mythic validators are the backbone of the network. They produce blocks, validate AI inference results, and maintain the state of the L2 chain. In return, they earn $MYTH from transaction fees.
      </Paragraph>

      <SubHeading>Requirements</SubHeading>
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Component</th>
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Minimum</th>
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Recommended</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">GPU</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">RTX 4090 (24GB)</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">A100 80GB</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">CPU</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">16 cores</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">32+ cores</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">RAM</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">64 GB</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">128+ GB</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Storage</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">2 TB NVMe SSD</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">4+ TB NVMe</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Network</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">1 Gbps</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">10 Gbps</td>
            </tr>
            <tr>
              <td className="py-3.5 px-4 text-white text-[0.82rem]">$MYTH Stake</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">TBD</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">TBD</td>
            </tr>
          </tbody>
        </table>
      </div>

      <SubHeading>Validator Setup</SubHeading>
      <CodeBlock>{`# Install Mythic validator software
curl -sSf https://mythic.sh/install.sh | sh

# Initialize validator
mythic-validator init \\
  --identity keypair.json \\
  --stake-account stake.json \\
  --rpc-url https://rpc.mythic.sh

# Start validator
mythic-validator start \\
  --gpu-enabled \\
  --ai-models llama3,mistral \\
  --log-level info`}</CodeBlock>

      <SubHeading>Rewards</SubHeading>
      <Paragraph>
        Validators earn rewards from two sources: transaction fee distribution (60% of gas fees go to validators) and AI compute payments (for serving inference requests). Higher-staked validators are selected more frequently for block production.
      </Paragraph>
    </section>
  )
}

function RoadmapSection() {
  return (
    <section>
      <SectionHeading id="roadmap">Roadmap</SectionHeading>
      <Paragraph>
        Mythic development is organized into four major phases, from initial network launch to full AI compute decentralization.
      </Paragraph>

      <div className="space-y-6 mt-8">
        {/* Phase 1 */}
        <div className="relative pl-8 border-l-2 border-mythic-violet/30">
          <div className="absolute -left-[5px] top-0 w-2 h-2 bg-mythic-violet" />
          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium bg-mythic-violet/20 text-mythic-violet">Phase 1</span>
              <span className="text-mythic-text text-[0.82rem]">Foundation</span>
            </div>
            <h4 className="text-white font-display font-semibold mb-2">Network Genesis</h4>
            <ul className="space-y-2">
              {[
                '$MYTH token launch on PumpFun (fair launch, no presale)',
                'Firedancer-based SVM L2 testnet deployment',
                'Basic bridge contract on Solana L1',
                'Block explorer and RPC infrastructure',
                'Initial validator onboarding',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[0.82rem] text-mythic-text">
                  <span className="text-mythic-violet mt-1">--</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Phase 2 */}
        <div className="relative pl-8 border-l-2 border-mythic-violet/30">
          <div className="absolute -left-[5px] top-0 w-2 h-2 bg-mythic-violet" />
          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium bg-mythic-violet/20 text-mythic-violet">Phase 2</span>
              <span className="text-mythic-text text-[0.82rem]">AI Integration</span>
            </div>
            <h4 className="text-white font-display font-semibold mb-2">AI Precompiles & Consensus</h4>
            <ul className="space-y-2">
              {[
                'RunInference, VerifyLogits, RegisterModel precompiles go live',
                'Proof of Useful AI Work consensus mechanism activation',
                'AI model registry with IPFS/Arweave storage',
                'Mainnet beta launch with optimistic fraud proofs',
                'Bridge v2 with fast finality mode',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[0.82rem] text-mythic-text">
                  <span className="text-mythic-violet mt-1">--</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Phase 3 */}
        <div className="relative pl-8 border-l-2 border-mythic-violet/30">
          <div className="absolute -left-[5px] top-0 w-2 h-2 bg-mythic-violet" />
          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium bg-mythic-violet/20 text-mythic-violet">Phase 3</span>
              <span className="text-mythic-text text-[0.82rem]">Compute Marketplace</span>
            </div>
            <h4 className="text-white font-display font-semibold mb-2">Decentralized Cloud</h4>
            <ul className="space-y-2">
              {[
                'Compute marketplace launch (GPU, CPU, storage)',
                'Provider registration and hardware attestation',
                'Automated matching and escrow system',
                'SDK for programmatic compute requests',
                'Integration with major AI frameworks (PyTorch, TensorFlow)',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[0.82rem] text-mythic-text">
                  <span className="text-mythic-violet mt-1">--</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Phase 4 */}
        <div className="relative pl-8 border-l-2 border-mythic-violet/30">
          <div className="absolute -left-[5px] top-0 w-2 h-2 bg-mythic-violet" />
          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium bg-mythic-violet/20 text-mythic-violet">Phase 4</span>
              <span className="text-mythic-text text-[0.82rem]">Full Decentralization</span>
            </div>
            <h4 className="text-white font-display font-semibold mb-2">Autonomous Network</h4>
            <ul className="space-y-2">
              {[
                'Decentralized sequencer rotation',
                'On-chain governance via $MYTH voting',
                'Cross-chain AI compute (EVM chains, Cosmos)',
                'ZK proofs for instant withdrawal finality',
                'Community-governed protocol upgrades',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[0.82rem] text-mythic-text">
                  <span className="text-mythic-violet mt-1">--</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ========================= MAIN PAGE ========================= */

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('overview')

  const handleSectionClick = useCallback((id: string) => {
    setActiveSection(id)
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <DocsSidebar activeSection={activeSection} onSectionClick={handleSectionClick} />

      <div className="flex-1 max-w-[960px] mx-auto px-5 sm:px-10 py-16 lg:pl-8">
        <div className="space-y-16">
          <OverviewSection />
          <hr className="border-white/[0.06]" />
          <ArchitectureSection />
          <hr className="border-white/[0.06]" />
          <TokenomicsSection />
          <hr className="border-white/[0.06]" />
          <BridgeDocsSection />
          <hr className="border-white/[0.06]" />
          <AIPrecompilesSection />
          <hr className="border-white/[0.06]" />
          <ComputeMarketplaceSection />
          <hr className="border-white/[0.06]" />
          <ValidatorsSection />
          <hr className="border-white/[0.06]" />
          <RoadmapSection />
        </div>
      </div>
    </div>
  )
}
