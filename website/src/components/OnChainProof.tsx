'use client'

import { useEffect, useState, useCallback } from 'react'

const L1_CONTRACTS = [
  {
    label: 'Bridge Program',
    address: 'oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ',
    desc: 'L1 escrow — locks SOL deposits, releases on withdrawal',
  },
  {
    label: 'Settlement Program',
    address: '4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav',
    desc: 'Posts L2 state roots to Solana L1 for finality',
  },
  {
    label: 'Bridge Config',
    address: '4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9',
    desc: 'Initialized PDA storing bridge parameters',
    isPda: true,
  },
]

const L2_PROGRAMS = [
  { label: 'Bridge L2', address: 'MythBrdgL2111111111111111111111111111111111' },
  { label: 'MYTH Token', address: 'MythToken1111111111111111111111111111111111' },
  { label: 'Swap (AMM)', address: 'MythSwap11111111111111111111111111111111111' },
  { label: 'Launchpad', address: 'MythPad111111111111111111111111111111111111' },
  { label: 'Staking', address: 'MythStak11111111111111111111111111111111111' },
  { label: 'Governance', address: 'MythGov111111111111111111111111111111111111' },
  { label: 'Settlement', address: 'MythSett1ement11111111111111111111111111111' },
  { label: 'AI Precompiles', address: 'CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ' },
  { label: 'Compute Market', address: 'AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh' },
  { label: 'Airdrop', address: 'MythDrop11111111111111111111111111111111111' },
  { label: 'Bridge L1 (mirror)', address: 'MythBrdg11111111111111111111111111111111111' },
]

interface BridgeTx {
  signature: string
  slot: number
  status: string
}

function truncateAddress(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="font-mono text-[0.5rem] tracking-[0.08em] uppercase px-2 py-0.5 border border-white/[0.08] hover:border-mythic-violet/40 text-mythic-text-muted hover:text-mythic-violet transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function OnChainProof() {
  const [bridgeTxs, setBridgeTxs] = useState<BridgeTx[]>([])
  const [l1Status, setL1Status] = useState<Record<string, boolean>>({})
  const [l2Status, setL2Status] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  const verify = useCallback(async () => {
    try {
      // Verify L1 contracts exist on Solana mainnet
      const l1Checks: Record<string, boolean> = {}
      for (const c of L1_CONTRACTS) {
        try {
          const res = await fetch('/api/l1-rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [c.address] }),
          })
          const data = await res.json()
          l1Checks[c.address] = !!data?.result?.value
        } catch { l1Checks[c.address] = false }
      }
      setL1Status(l1Checks)

      // Verify L2 programs exist on Mythic RPC
      const l2Checks: Record<string, boolean> = {}
      for (const p of L2_PROGRAMS) {
        try {
          const res = await fetch('/api/l2-rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [p.address, { encoding: 'base64' }] }),
          })
          const data = await res.json()
          l2Checks[p.address] = !!data?.result?.value
        } catch { l2Checks[p.address] = false }
      }
      setL2Status(l2Checks)

      // Fetch recent bridge transactions from L1
      try {
        const res = await fetch('/api/l1-rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getSignaturesForAddress',
            params: ['oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ', { limit: 5 }],
          }),
        })
        const data = await res.json()
        const txs = (data?.result || [])
          .filter((t: { err: unknown }) => t.err === null)
          .map((t: { signature: string; slot: number; err: unknown }) => ({
            signature: t.signature,
            slot: t.slot,
            status: 'Success' as const,
          }))
        setBridgeTxs(txs)
      } catch { /* ignore */ }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { verify() }, [verify])

  return (
    <section className="py-[80px] sm:py-[100px] border-t border-white/[0.06] bg-[#08080C]/50">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
        {/* Header */}
        <div className="mb-10">
          <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
            On-Chain Verification
          </div>
          <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-2">
            Prove It&apos;s Real
          </h2>
          <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
            Every contract, every transaction, every program — publicly deployed and independently verifiable. Click any address to verify on Solscan or the Mythic Explorer.
          </p>
        </div>

        {/* L1 Contracts on Solana Mainnet */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-2 bg-[#9945FF]" />
            <h3 className="font-display text-white font-semibold text-[1.1rem]">Solana L1 Mainnet Contracts</h3>
            <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20">
              Deployed &amp; Verified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {L1_CONTRACTS.map(c => (
              <div key={c.address} className="bg-[#08080C] border border-white/[0.06] p-5 hover:border-[#9945FF]/20 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-[0.55rem] tracking-[0.12em] uppercase text-mythic-text-muted">{c.label}</span>
                  {!loading && (
                    <span className={`w-2 h-2 ${l1Status[c.address] ? 'bg-[#39FF14]' : 'bg-red-500'}`} />
                  )}
                </div>
                <a
                  href={`https://solscan.io/account/${c.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[0.65rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors break-all leading-relaxed"
                >
                  {c.address}
                </a>
                <p className="text-mythic-text text-[0.72rem] mt-2 leading-relaxed">{c.desc}</p>
                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={`https://solscan.io/account/${c.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[0.5rem] tracking-[0.08em] uppercase px-2 py-0.5 bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20 hover:bg-[#9945FF]/20 transition-colors"
                  >
                    View on Solscan
                  </a>
                  <CopyButton text={c.address} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent L1 Bridge Transactions */}
        {bridgeTxs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 bg-[#39FF14]" />
              <h3 className="font-display text-white font-semibold text-[1.1rem]">Recent Bridge Transactions on Solana L1</h3>
            </div>

            <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Signature</th>
                      <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Slot</th>
                      <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Status</th>
                      <th className="text-right px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Verify</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bridgeTxs.map(tx => (
                      <tr key={tx.signature} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                        <td className="px-5 py-3">
                          <a
                            href={`https://solscan.io/tx/${tx.signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[0.65rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                          >
                            {truncateAddress(tx.signature)}
                          </a>
                        </td>
                        <td className="px-5 py-3 font-mono text-[0.65rem] text-white tabular-nums">
                          {tx.slot.toLocaleString()}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 ${
                            tx.status === 'Success'
                              ? 'bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <a
                            href={`https://solscan.io/tx/${tx.signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[0.5rem] tracking-[0.08em] uppercase text-[#9945FF] hover:text-[#b06aff] transition-colors"
                          >
                            Solscan
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* L2 Programs */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-2 bg-mythic-violet" />
            <h3 className="font-display text-white font-semibold text-[1.1rem]">Mythic L2 Deployed Programs</h3>
            <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-mythic-violet/10 text-mythic-violet border border-mythic-violet/20">
              11 Programs Live
            </span>
          </div>

          <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Program</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Address</th>
                    <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Status</th>
                    <th className="text-right px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {L2_PROGRAMS.map(p => (
                    <tr key={p.address} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                      <td className="px-5 py-2.5 font-display text-white text-[0.78rem] font-medium whitespace-nowrap">
                        {p.label}
                      </td>
                      <td className="px-5 py-2.5">
                        <a
                          href={`https://explorer.mythic.sh/mainnet/address/${p.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[0.6rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                        >
                          <span className="hidden sm:inline">{p.address}</span>
                          <span className="sm:hidden">{truncateAddress(p.address)}</span>
                        </a>
                      </td>
                      <td className="px-5 py-2.5">
                        {loading ? (
                          <span className="w-2 h-2 bg-white/10 inline-block animate-pulse" />
                        ) : (
                          <span className={`font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 ${
                            l2Status[p.address]
                              ? 'bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20'
                              : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                          }`}>
                            {l2Status[p.address] ? 'Live' : 'Not Found'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <a
                          href={`https://explorer.mythic.sh/mainnet/address/${p.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[0.5rem] tracking-[0.08em] uppercase text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                        >
                          Explorer
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Verification Commands */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <h4 className="font-display text-white font-semibold text-[0.85rem] mb-2">
              Verify L2 Is Producing Blocks
            </h4>
            <p className="text-mythic-text text-[0.75rem] mb-3">
              Query the public RPC. Run it twice — the slot number advances every ~400ms.
            </p>
            <div className="bg-black/40 border border-white/[0.06] p-3 font-mono text-[0.62rem] text-[#39FF14] overflow-x-auto whitespace-pre">
{`curl -s -X POST https://rpc.mythic.sh \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' \\
  | python3 -m json.tool`}
            </div>
          </div>

          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <h4 className="font-display text-white font-semibold text-[0.85rem] mb-2">
              Verify Bridge on Solana L1
            </h4>
            <p className="text-mythic-text text-[0.75rem] mb-3">
              Confirm the bridge program exists and is executable on Solana mainnet.
            </p>
            <div className="bg-black/40 border border-white/[0.06] p-3 font-mono text-[0.62rem] text-[#39FF14] overflow-x-auto whitespace-pre">
{`solana program show \\
  oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ \\
  --url mainnet-beta`}
            </div>
          </div>

          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <h4 className="font-display text-white font-semibold text-[0.85rem] mb-2">
              Check Total Transactions
            </h4>
            <p className="text-mythic-text text-[0.75rem] mb-3">
              See the total number of transactions processed on Mythic L2.
            </p>
            <div className="bg-black/40 border border-white/[0.06] p-3 font-mono text-[0.62rem] text-[#39FF14] overflow-x-auto whitespace-pre">
{`curl -s -X POST https://rpc.mythic.sh \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,
       "method":"getTransactionCount"}' \\
  | python3 -m json.tool`}
            </div>
          </div>

          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <h4 className="font-display text-white font-semibold text-[0.85rem] mb-2">
              View Bridge Transactions on Solscan
            </h4>
            <p className="text-mythic-text text-[0.75rem] mb-3">
              See real bridge deposits and withdrawals on Solana L1 — with full transaction details.
            </p>
            <a
              href="https://solscan.io/account/oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-[0.65rem] text-[#9945FF] hover:text-[#b06aff] transition-colors"
            >
              Open on Solscan
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
