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
          '$MYTH as native L2 gas currency with deflationary burn on every transaction',
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
        Mythic L2 testnet is live. Connect at rpc.mythic.sh with any Solana-compatible wallet or CLI. Follow <a href="https://x.com/Mythic_L2" target="_blank" rel="noopener noreferrer" className="text-mythic-violet hover:underline">@Mythic_L2</a> for updates.
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
        $MYTH is the <strong className="text-white">native currency</strong> of the Mythic L2 blockchain — similar to how ETH is native to Ethereum. It is minted at genesis with a fixed supply of 1,000,000,000 tokens, 9 decimal places, and zero inflation. Every transaction on Mythic L2 pays gas fees in $MYTH, and a portion of each fee is permanently burned.
      </Paragraph>

      <InfoBox title="Native L2 Currency vs. PumpFun Token">
        <strong className="text-white">Mythic L2 $MYTH</strong> is the native gas currency of the Mythic L2 chain, created at genesis and used for all on-chain operations (gas, staking, governance, compute payments). It is <em>separate</em> from the $MYTH SPL token traded on PumpFun/Raydium on Solana L1. The PumpFun token represents community access and speculative interest, while the native L2 $MYTH powers the actual blockchain. Users can bridge assets between L1 and L2 — L1 SOL deposits are credited as MYTH on L2, and native L2 $MYTH is used for all transaction fees.
      </InfoBox>

      <SubHeading>Token Details</SubHeading>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Supply', value: '1,000,000,000' },
          { label: 'Token Type', value: 'Native L2 Currency' },
          { label: 'Decimals', value: '9' },
          { label: 'Inflation', value: '0% — Fixed Supply' },
        ].map((item) => (
          <div key={item.label} className="bg-[#08080C] border border-white/[0.06] p-4">
            <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">{item.label}</div>
            <div className="text-white font-semibold text-[0.82rem]">{item.value}</div>
          </div>
        ))}
      </div>

      <SubHeading>Token Utility</SubHeading>
      <ul className="space-y-2 mb-8">
        {[
          'Gas fees — every transaction on Mythic L2 is paid in native $MYTH',
          'Validator staking — validators stake $MYTH to participate in block production',
          'AI compute payments — pay for inference and model verification in $MYTH',
          'Governance voting — stake-weighted governance proposals and votes',
          'Compute marketplace — settlement currency for GPU/CPU/storage listings',
        ].map((item) => (
          <li key={item} className="flex items-start gap-3 text-[0.82rem] text-mythic-text">
            <svg className="w-4 h-4 text-mythic-violet mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {item}
          </li>
        ))}
      </ul>

      <SubHeading>Fee Distribution</SubHeading>
      <Paragraph>
        All fees on Mythic L2 are paid in native $MYTH. Each fee type distributes across three destinations: validators (who run the network), the foundation (which funds development), and the burn address (removing tokens from circulation permanently).
      </Paragraph>

      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-8">
        <TokenomicsTable />
      </div>

      <SubHeading>Staking</SubHeading>
      <Paragraph>
        Validators must stake a minimum amount of native $MYTH to participate in block production and AI verification. Staked $MYTH earns rewards from transaction fees. The staking APY is dynamic, based on the total amount staked and network activity.
      </Paragraph>

      <InfoBox title="Deflationary Model">
        With 30-40% of all fees burned, the circulating supply of native $MYTH decreases with every transaction. As network usage grows, the burn rate accelerates. There are no token unlocks, no team vesting, and no inflationary rewards.
      </InfoBox>
    </section>
  )
}

function BridgeDocsSection() {
  return (
    <section>
      <SectionHeading id="bridge">Bridge</SectionHeading>
      <Paragraph>
        The Mythic Bridge is the core infrastructure that connects Solana L1 and Mythic L2. It enables users to move SOL between the two chains, with deposited SOL credited as MYTH on L2. The bridge uses an optimistic rollup model with fraud proofs, secured by Solana L1 settlement.
      </Paragraph>

      {/* Architecture */}
      <SubHeading>Architecture Overview</SubHeading>
      <Paragraph>
        The bridge consists of two on-chain programs (one on Solana L1, one on Mythic L2), a relayer service that watches for cross-chain events, and a settlement service that posts Merkle state roots to L1 for verification.
      </Paragraph>
      <div id="bridge-architecture" className="scroll-mt-24 bg-[#08080C] border border-white/[0.06] p-6 mb-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-sm font-bold">L1</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">Solana L1 Bridge Program</h4>
            <p className="text-mythic-text text-[0.82rem]">Holds the SOL vault, processes deposit/withdrawal instructions, and verifies settlement state roots. Deployed on Solana mainnet.</p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-sm font-bold">L2</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">Mythic L2 Bridge Program</h4>
            <p className="text-mythic-text text-[0.82rem]">Mints MYTH on L2 when deposits are confirmed, and burns MYTH when withdrawals are initiated. Manages the L2 side of the bridge ledger.</p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-[0.6rem] font-bold">RLY</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">Relayer</h4>
            <p className="text-mythic-text text-[0.82rem]">Watches Solana L1 for deposit events via Yellowstone gRPC, then credits the equivalent MYTH on L2 to the user&apos;s address. Also initiates L1 withdrawals when users burn MYTH on L2.</p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-mythic-violet text-[0.6rem] font-bold">STL</span>
          </div>
          <div>
            <h4 className="text-white font-medium mb-1">Settlement Service</h4>
            <p className="text-mythic-text text-[0.82rem]">Posts Merkle state roots to Solana L1 every 100 slots (~40 seconds). These roots allow anyone to verify the L2 state and submit fraud proofs if an invalid transition is detected.</p>
          </div>
        </div>
      </div>

      {/* Deposit Flow */}
      <div id="bridge-deposit" className="scroll-mt-24">
        <SubHeading>Deposit Flow (L1 → L2)</SubHeading>
      </div>
      <Paragraph>
        Deposits move SOL from Solana L1 to Mythic L2, where it is credited as MYTH. The process is fast -- typically confirmed within ~30 seconds.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">1.</span>
          <span className="text-mythic-text">Connect your Solana wallet on mythic.sh/bridge</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">2.</span>
          <span className="text-mythic-text">Select the amount of SOL to deposit (min 0.01 SOL, max 1,000 SOL)</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">3.</span>
          <span className="text-mythic-text">Confirm the transaction -- SOL is sent to the bridge vault on L1</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">4.</span>
          <span className="text-mythic-text">Relayer detects the deposit event on L1</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">5.</span>
          <span className="text-mythic-text">Relayer mints equivalent MYTH on L2 to your address</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">6.</span>
          <span className="text-mythic-text">Funds appear on Mythic L2 within ~30 seconds</span>
        </div>
      </div>
      <InfoBox title="Deposit Fee">
        A 0.1% (10 bps) fee is applied to deposits. For example, depositing 10 SOL credits ~9.99 MYTH on L2. Fees are distributed through the MYTH fee structure: 50% to validators, 10% to the foundation, and 40% burned.
      </InfoBox>

      {/* Withdrawal Flow */}
      <div id="bridge-withdraw" className="scroll-mt-24">
        <SubHeading>Withdrawal Flow (L2 → L1)</SubHeading>
      </div>
      <Paragraph>
        Withdrawals move assets from Mythic L2 back to Solana L1. Because Mythic uses an optimistic rollup model, withdrawals include a 7-day challenge period to allow fraud proof submission before funds are released.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">1.</span>
          <span className="text-mythic-text">Initiate withdrawal on the Bridge page -- MYTH is burned on L2</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">2.</span>
          <span className="text-mythic-text">Relayer generates a withdrawal proof and initiates the withdrawal on L1</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">3.</span>
          <span className="text-mythic-text">Challenge period begins: 7 days (604,800 seconds)</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">4.</span>
          <span className="text-mythic-text">If unchallenged, the withdrawal is finalized</span>
        </div>
        <div className="flex items-center gap-3 text-[0.82rem]">
          <span className="text-mythic-violet font-mono">5.</span>
          <span className="text-mythic-text">SOL is released from the L1 vault to your wallet</span>
        </div>
      </div>
      <InfoBox title="Challenge Period">
        The 7-day challenge period is a security measure. During this window, any honest observer can submit a fraud proof to the L1 settlement contract if the withdrawal is based on an invalid L2 state. This protects all bridge users from fraudulent state transitions.
      </InfoBox>

      {/* Bridge Addresses */}
      <div id="bridge-addresses" className="scroll-mt-24">
        <SubHeading>Bridge Addresses</SubHeading>
      </div>
      <Paragraph>
        These are the on-chain program addresses for the Mythic bridge infrastructure. Verify these addresses before interacting with the bridge.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Program</th>
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Address</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">L1 Bridge Program</td>
              <td className="py-3.5 px-4 text-mythic-violet font-mono text-[0.72rem] break-all">oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">L2 Bridge Program</td>
              <td className="py-3.5 px-4 text-mythic-violet font-mono text-[0.72rem] break-all">MythBrdgL2111111111111111111111111111111111</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">L1 Config PDA</td>
              <td className="py-3.5 px-4 text-mythic-violet font-mono text-[0.72rem] break-all">4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9</td>
            </tr>
            <tr>
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Settlement Program (L1)</td>
              <td className="py-3.5 px-4 text-mythic-violet font-mono text-[0.72rem] break-all">4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Parameters */}
      <div id="bridge-parameters" className="scroll-mt-24">
        <SubHeading>Parameters</SubHeading>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Min Deposit', value: '0.01 SOL' },
          { label: 'Max Deposit', value: '1,000 SOL' },
          { label: 'Daily Limit', value: '10,000 SOL' },
          { label: 'Challenge Period', value: '7 days' },
          { label: 'Bridge Fee', value: '10 bps (0.1%)' },
          { label: 'Supported Assets', value: 'SOL' },
        ].map((item) => (
          <div key={item.label} className="bg-[#08080C] border border-white/[0.06] p-4">
            <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">{item.label}</div>
            <div className="text-white font-semibold text-[0.82rem]">{item.value}</div>
          </div>
        ))}
      </div>
      <Paragraph>
        Token-2022 compatible asset bridging is planned for a future upgrade, enabling additional tokens to be bridged between L1 and L2.
      </Paragraph>

      {/* How to Bridge */}
      <div id="bridge-how-to" className="scroll-mt-24">
        <SubHeading>How to Bridge</SubHeading>
      </div>
      <Paragraph>
        There are multiple ways to bridge assets between Solana L1 and Mythic L2:
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Method</th>
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Website</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">
                <a href="https://mythic.sh/bridge" className="text-mythic-violet hover:underline">mythic.sh/bridge</a>
              </td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Telegram Bot</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">
                <a href="https://t.me/MythicWalletBot" target="_blank" rel="noopener noreferrer" className="text-mythic-violet hover:underline">@MythicWalletBot</a> → /bridge
              </td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Wallet Extension</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">Built-in Bridge tab in the Mythic Wallet extension</td>
            </tr>
            <tr>
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Web Wallet</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">
                <a href="https://wallet.mythic.sh" target="_blank" rel="noopener noreferrer" className="text-mythic-violet hover:underline">wallet.mythic.sh</a> → Bridge
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Security */}
      <div id="bridge-security" className="scroll-mt-24">
        <SubHeading>Security</SubHeading>
      </div>
      <Paragraph>
        The Mythic Bridge is secured by multiple layers of protection, combining the security of Solana L1 settlement with optimistic fraud proofs and operational safeguards.
      </Paragraph>
      <ul className="space-y-3 mb-6">
        {[
          'Optimistic rollup model -- state transitions are assumed valid unless challenged within the 7-day window',
          'Settlement roots posted to Solana L1 every 100 slots, verifiable by anyone',
          'Any honest observer can submit a fraud proof to the L1 settlement contract',
          'Successful fraud proof challengers are rewarded from the sequencer bond',
          'Emergency pause mechanism allows the bridge admin to halt operations instantly',
          'Bridge admin authority will be transferred to a multisig/Ledger hardware wallet before mainnet launch',
          'Daily withdrawal limit of 10,000 SOL caps exposure in case of exploit',
        ].map((item) => (
          <li key={item} className="flex items-start gap-3 text-[0.82rem] text-mythic-text">
            <svg className="w-4 h-4 text-mythic-violet mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            {item}
          </li>
        ))}
      </ul>
      <InfoBox title="Testnet Notice">
        The bridge is currently running on testnet. During the testnet phase, the bridge admin retains upgrade authority for rapid iteration. Before mainnet launch, upgrade authority will be transferred to a multisig controlled by hardware wallets.
      </InfoBox>

      {/* Fee Structure */}
      <div id="bridge-fees" className="scroll-mt-24">
        <SubHeading>Fee Structure</SubHeading>
      </div>
      <Paragraph>
        Bridge operations incur a 10 basis point (0.1%) fee on deposits. This fee is distributed through the standard MYTH fee allocation model, contributing to network security and deflationary pressure.
      </Paragraph>
      <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Destination</th>
              <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Share</th>
              <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Validators</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">50%</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">Rewards for block production and AI verification</td>
            </tr>
            <tr className="border-b border-white/[0.04]">
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Foundation</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">10%</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">Protocol development and ecosystem grants</td>
            </tr>
            <tr>
              <td className="py-3.5 px-4 text-white text-[0.82rem]">Burned</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">40%</td>
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">Permanently removed from circulation</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Paragraph>
        Bridge fees contribute to the deflationary pressure on $MYTH. With 40% of each bridge fee burned, increased bridge usage directly reduces the circulating supply.
      </Paragraph>
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
              <td className="py-3.5 px-4 text-mythic-text text-[0.82rem]">100,000 MYTH</td>
              <td className="py-3.5 px-4 text-mythic-violet text-[0.82rem]">1,000,000 MYTH</td>
            </tr>
          </tbody>
        </table>
      </div>

      <SubHeading>Validator Setup</SubHeading>
      <CodeBlock>{`# Clone the Mythic validator repository
git clone https://github.com/MythicL2/mythic-validator.git
cd mythic-validator

# Install dependencies (requires Rust 1.93+ and Solana CLI 3.0+)
cargo build --release

# Generate validator identity
solana-keygen new -o validator-keypair.json

# Start the validator (connects to Mythic L2 network)
solana-test-validator \\
  --identity validator-keypair.json \\
  --rpc-url https://rpc.mythic.sh \\
  --log`}</CodeBlock>

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
