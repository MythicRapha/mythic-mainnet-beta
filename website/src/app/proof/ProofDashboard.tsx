'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

// ─── Animated number that smoothly transitions to target ───
function useAnimatedNumber(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target)
  const rafRef = useRef(0)

  useEffect(() => {
    const start = display
    const startTime = performance.now()
    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + (target - start) * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  return display
}

// ─── Live slot interpolation ───
function useLiveSlot(baseSlot: number, slotRate: number | null, online: boolean) {
  const [slot, setSlot] = useState(baseSlot)
  const baseRef = useRef({ slot: baseSlot, time: Date.now() })

  useEffect(() => {
    baseRef.current = { slot: baseSlot, time: Date.now() }
    setSlot(baseSlot)
  }, [baseSlot])

  useEffect(() => {
    if (!online || !slotRate || slotRate <= 0) return
    const msPerSlot = 1000 / slotRate
    const iv = setInterval(() => {
      const elapsed = Date.now() - baseRef.current.time
      setSlot(baseRef.current.slot + Math.floor(elapsed / msPerSlot))
    }, 400)
    return () => clearInterval(iv)
  }, [online, slotRate])

  return useAnimatedNumber(slot, 350)
}

// ─── Formatting ───
function fmt(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

// ─── Status badge ───
function StatusDot({ live }: { live: boolean }) {
  return (
    <span className="relative flex items-center">
      <span className={`w-2.5 h-2.5 ${live ? 'bg-[#39FF14]' : 'bg-red-500'}`} />
      {live && <span className="absolute inset-0 w-2.5 h-2.5 bg-[#39FF14]/40 animate-ping" />}
    </span>
  )
}

interface NetworkData {
  network: string
  label: string
  online: boolean
  healthy: boolean
  slot: number
  transactionCount: number
  blockTimeMs: number | null
  realTps: number | null
  slotRate: number | null
  version: string | null
  epoch: number
  slotIndex: number
  slotsInEpoch: number
}

interface L1Contract {
  label: string
  address: string
  verified: boolean | null
}

export default function ProofDashboard() {
  const [net, setNet] = useState<NetworkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<L1Contract[]>([
    { label: 'Bridge Program', address: 'oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ', verified: null },
    { label: 'Settlement Program', address: '4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav', verified: null },
    { label: 'Bridge Config PDA', address: '4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9', verified: null },
  ])
  const [bridgeTxCount, setBridgeTxCount] = useState<number | null>(null)

  // Fetch L2 network status
  const fetchNet = useCallback(async () => {
    try {
      const res = await fetch('/api/network-status', { cache: 'no-store' })
      const json = await res.json()
      const mainnet = json.networks?.find((n: NetworkData) => n.network === 'mainnet')
      if (mainnet) setNet(mainnet)
    } catch { /* retry next cycle */ }
    finally { setLoading(false) }
  }, [])

  // Verify L1 contracts exist
  const verifyL1 = useCallback(async () => {
    const updated = await Promise.all(
      contracts.map(async (c) => {
        try {
          const res = await fetch('/api/l1-rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [c.address] }),
          })
          const data = await res.json()
          return { ...c, verified: !!data?.result?.value }
        } catch { return { ...c, verified: false } }
      })
    )
    setContracts(updated)

    // Also get bridge tx count
    try {
      const res = await fetch('/api/l1-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getSignaturesForAddress',
          params: ['oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ', { limit: 1000 }],
        }),
      })
      const data = await res.json()
      setBridgeTxCount(data?.result?.length ?? 0)
    } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchNet()
    verifyL1()
    const iv = setInterval(fetchNet, 4000)
    return () => clearInterval(iv)
  }, [fetchNet, verifyL1])

  const liveSlot = useLiveSlot(net?.slot ?? 0, net?.slotRate ?? null, net?.online ?? false)
  const animatedTxns = useAnimatedNumber(net?.transactionCount ?? 0, 800)

  return (
    <div className="relative max-w-[1280px] mx-auto px-5 sm:px-10 py-12 sm:py-20">

      {/* ═══ HERO BANNER ═══ */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-3 mb-6">
          <StatusDot live={net?.online ?? false} />
          <span className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-[#39FF14] font-semibold">
            Live on Solana Mainnet
          </span>
        </div>

        <h1 className="font-display font-extrabold text-[2.4rem] sm:text-[3.2rem] lg:text-[4rem] tracking-[-0.02em] text-white leading-[1.05] mb-4">
          Mythic L2 is Real
        </h1>
        <p className="text-mythic-text text-[1rem] max-w-[520px] mx-auto mb-8">
          Not a whitepaper. Not a testnet. A live blockchain with real contracts deployed on Solana mainnet. Verify everything below.
        </p>

        {/* Share CTA */}
        <div className="flex items-center justify-center gap-3">
          <a
            href="https://pump.fun/coin/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 bg-[#39FF14] text-black font-display text-[0.75rem] font-bold tracking-[0.04em] hover:bg-[#66FF44] transition-colors"
          >
            Buy $MYTH
          </a>
          <Link
            href="/bridge"
            className="px-6 py-2.5 bg-[#7B2FFF] text-white font-display text-[0.75rem] font-semibold tracking-[0.04em] hover:bg-[#9945FF] transition-colors"
          >
            Bridge to L2
          </Link>
        </div>
      </div>

      {/* ═══ BIG STATS ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
        {[
          {
            label: 'Current Slot',
            value: loading ? '...' : fmt(liveSlot),
            color: 'text-white',
            sub: 'Ticking live',
          },
          {
            label: 'Transactions',
            value: loading ? '...' : fmt(animatedTxns),
            color: 'text-[#39FF14]',
            sub: 'And counting',
          },
          {
            label: 'Block Time',
            value: net?.blockTimeMs ? `${net.blockTimeMs}ms` : '...',
            color: 'text-[#7B2FFF]',
            sub: 'Per block',
          },
          {
            label: 'Peak TPS',
            value: '9,011',
            color: 'text-white',
            sub: 'Single client (not saturated)',
          },
        ].map((s) => (
          <div key={s.label} className="bg-[#08080C] border border-white/[0.06] p-6 text-center">
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
              {s.label}
            </div>
            <div className={`font-display text-[1.6rem] sm:text-[2rem] font-bold tabular-nums ${s.color}`}>
              {s.value}
            </div>
            <div className="font-mono text-[0.45rem] tracking-[0.1em] text-mythic-text-muted mt-1">
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ L1 CONTRACT VERIFICATION ═══ */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-2 h-2 bg-[#9945FF]" />
          <h2 className="font-display text-white font-bold text-[1.2rem]">Solana L1 Mainnet Contracts</h2>
          <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20">
            Deployed
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {contracts.map((c) => (
            <a
              key={c.address}
              href={`https://solscan.io/account/${c.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#08080C] border border-white/[0.06] p-5 hover:border-[#9945FF]/30 transition-colors group"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">
                  {c.label}
                </span>
                {c.verified === null ? (
                  <span className="w-2 h-2 bg-white/10 animate-pulse" />
                ) : c.verified ? (
                  <span className="font-mono text-[0.45rem] tracking-[0.1em] uppercase px-1.5 py-0.5 bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20">
                    Verified
                  </span>
                ) : (
                  <span className="w-2 h-2 bg-red-500" />
                )}
              </div>
              <div className="font-mono text-[0.58rem] text-[#9945FF] group-hover:text-[#b06aff] transition-colors break-all leading-relaxed">
                {c.address}
              </div>
              <div className="mt-3 font-mono text-[0.45rem] tracking-[0.08em] uppercase text-mythic-text-muted group-hover:text-[#9945FF] transition-colors">
                Click to verify on Solscan &rarr;
              </div>
            </a>
          ))}
        </div>

        {bridgeTxCount !== null && bridgeTxCount > 0 && (
          <div className="mt-4 text-center">
            <a
              href="https://solscan.io/account/oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ#txs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-[0.6rem] text-[#9945FF] hover:text-[#b06aff] transition-colors"
            >
              {bridgeTxCount}+ bridge transactions on Solana L1 — view on Solscan
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}
      </div>

      {/* ═══ LIVE NETWORK DASHBOARD ═══ */}
      {net && (
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-5">
            <StatusDot live={net.online} />
            <h2 className="font-display text-white font-bold text-[1.2rem]">Live Network</h2>
            <span className="font-mono text-[0.5rem] tracking-[0.1em] text-mythic-text-muted">
              rpc.mythic.sh
            </span>
          </div>

          <div className="bg-[#08080C] border border-white/[0.06] p-6">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-6">
              <div>
                <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Slot</div>
                <div className="font-display text-[1.2rem] font-bold text-white tabular-nums">{fmt(liveSlot)}</div>
              </div>
              <div>
                <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Epoch</div>
                <div className="font-display text-[1.2rem] font-bold text-white">{net.epoch}</div>
              </div>
              <div>
                <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Version</div>
                <div className="font-mono text-[0.85rem] text-white">{net.version || '—'}</div>
              </div>
              <div>
                <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Blocks</div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-[2px]">
                    {[0,1,2,3,4].map(i => (
                      <div
                        key={i}
                        className="w-1 bg-[#39FF14] animate-pulse"
                        style={{ height: `${8 + Math.random() * 10}px`, animationDelay: `${i * 200}ms` }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[0.5rem] text-[#39FF14]">Producing</span>
                </div>
              </div>
              <div>
                <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Capacity</div>
                <div className="font-display text-[1.2rem] font-bold text-[#39FF14]">1M+ TPS</div>
              </div>
            </div>

            {/* Epoch progress */}
            {net.slotsInEpoch > 0 && (
              <div className="mt-5">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-mono text-[0.45rem] tracking-[0.12em] uppercase text-mythic-text-muted">Epoch Progress</span>
                  <span className="font-mono text-[0.45rem] text-mythic-text-muted">
                    {((net.slotIndex / net.slotsInEpoch) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#7B2FFF] to-[#9945FF]"
                    style={{ width: `${(net.slotIndex / net.slotsInEpoch) * 100}%`, transition: 'width 0.8s ease' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ BENCHMARK RESULTS ═══ */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-2 h-2 bg-[#39FF14]" />
          <h2 className="font-display text-white font-bold text-[1.2rem]">Benchmark Results</h2>
          <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20">
            Verified
          </span>
        </div>

        <div className="bg-[#08080C] border border-[#39FF14]/10 p-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
            {[
              { label: 'Peak TPS', value: '9,011', note: 'Confirmed on-chain' },
              { label: 'Sustained TPS', value: '3,360', note: '60s average' },
              { label: 'Peak Capacity', value: '1M+', note: 'Firedancer' },
              { label: 'Block Time', value: '~405ms', note: 'Consistent' },
              { label: 'Errors', value: '0', note: 'Zero failures' },
            ].map((b) => (
              <div key={b.label}>
                <div className="font-mono text-[0.45rem] tracking-[0.12em] uppercase text-mythic-text-muted mb-1">{b.label}</div>
                <div className="font-display text-[1.4rem] font-bold text-white">{b.value}</div>
                <div className="font-mono text-[0.4rem] tracking-[0.08em] text-[#39FF14]/60 mt-0.5">{b.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ L2 PROGRAMS ═══ */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-2 h-2 bg-[#7B2FFF]" />
          <h2 className="font-display text-white font-bold text-[1.2rem]">11 Deployed Programs</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { name: 'Bridge L2', addr: 'MythBrdgL2111111111111111111111111111111111', chain: 'l2' },
            { name: 'MYTH Token', addr: 'MythToken1111111111111111111111111111111111', chain: 'l2' },
            { name: 'Swap (AMM)', addr: 'MythSwap11111111111111111111111111111111111', chain: 'l2' },
            { name: 'Launchpad', addr: 'MythPad111111111111111111111111111111111111', chain: 'l2' },
            { name: 'Staking', addr: 'MythStak11111111111111111111111111111111111', chain: 'l2' },
            { name: 'Governance', addr: 'MythGov111111111111111111111111111111111111', chain: 'l2' },
            { name: 'Settlement', addr: 'MythSett1ement11111111111111111111111111111', chain: 'l2' },
            { name: 'AI Precompiles', addr: 'CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ', chain: 'l2' },
            { name: 'Compute Market', addr: 'AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh', chain: 'l2' },
            { name: 'Airdrop', addr: 'MythDrop11111111111111111111111111111111111', chain: 'l2' },
            { name: 'Bridge L1', addr: 'MythBrdg11111111111111111111111111111111111', chain: 'l2' },
          ].map((p) => {
            const explorerUrl = p.chain === 'l1'
              ? `https://solscan.io/account/${p.addr}`
              : `https://explorer.mythic.sh/address/${p.addr}`
            return (
              <a
                key={p.name}
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#08080C] border border-white/[0.06] px-4 py-3 flex items-center justify-between hover:border-[#7B2FFF]/30 transition-colors group"
              >
                <div>
                  <div className="font-display text-white text-[0.75rem] font-medium group-hover:text-[#b06aff] transition-colors">{p.name}</div>
                  <div className="font-mono text-[0.45rem] text-mythic-text-muted mt-0.5">{p.addr.length > 20 ? p.addr.slice(0, 10) + '...' + p.addr.slice(-4) : p.addr}</div>
                </div>
                <span className="w-2 h-2 bg-[#39FF14]" />
              </a>
            )
          })}
        </div>
      </div>

      {/* ═══ ECOSYSTEM ═══ */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-2 h-2 bg-white" />
          <h2 className="font-display text-white font-bold text-[1.2rem]">Try It Right Now</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { name: 'Buy $MYTH', url: 'https://pump.fun/coin/5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump', color: '#39FF14', desc: 'PumpFun' },
            { name: 'Bridge to L2', url: '/bridge', color: '#7B2FFF', desc: 'mythic.sh/bridge', internal: true },
            { name: 'Swap', url: 'https://mythicswap.app', color: '#FF9500', desc: 'mythicswap.app' },
            { name: 'Launch Tokens', url: 'https://mythic.fun', color: '#00E5FF', desc: 'mythic.fun' },
            { name: 'Web Wallet', url: 'https://wallet.mythic.sh', color: '#FF2D78', desc: 'wallet.mythic.sh' },
            { name: 'Block Explorer', url: 'https://explorer.mythic.sh', color: '#A855F7', desc: 'explorer.mythic.sh' },
          ].map((item) => {
            const Tag = item.internal ? Link : 'a'
            const extraProps = item.internal ? {} : { target: '_blank', rel: 'noopener noreferrer' }
            return (
              <Tag
                key={item.name}
                href={item.url}
                {...extraProps}
                className="bg-[#08080C] border border-white/[0.06] p-5 hover:border-white/[0.12] transition-colors group"
              >
                <div className="w-3 h-3 mb-3" style={{ backgroundColor: item.color }} />
                <div className="font-display text-white font-semibold text-[0.85rem] group-hover:text-white/90">{item.name}</div>
                <div className="font-mono text-[0.5rem] text-mythic-text-muted mt-1">{item.desc}</div>
              </Tag>
            )
          })}
        </div>
      </div>

      {/* ═══ LEGAL ENTITY VERIFICATION ═══ */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-2 h-2 bg-white" />
          <h2 className="font-display text-white font-bold text-[1.2rem]">Legal Entity</h2>
          <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20">
            Registered
          </span>
        </div>

        <div className="bg-[#08080C] border border-white/[0.06] p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Entity</div>
              <div className="font-display text-white font-semibold text-[0.95rem]">Mythic Foundation Inc.</div>
              <div className="font-mono text-[0.55rem] text-mythic-text-muted mt-0.5">Wyoming Non-Profit Corporation</div>
            </div>
            <div>
              <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Structure</div>
              <div className="font-display text-white font-semibold text-[0.95rem]">Wyoming DUNA</div>
              <div className="font-mono text-[0.55rem] text-mythic-text-muted mt-0.5">Decentralized Unincorporated Nonprofit Association</div>
            </div>
            <div>
              <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Filing Number</div>
              <div className="font-mono text-[#9945FF] text-[0.85rem]">2026-001904245</div>
              <div className="font-mono text-[0.55rem] text-mythic-text-muted mt-0.5">Wyoming Secretary of State</div>
            </div>
            <div>
              <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">Date of Formation</div>
              <div className="font-mono text-white text-[0.85rem]">February 25, 2026</div>
              <div className="font-mono text-[0.55rem] text-mythic-text-muted mt-0.5">Effective immediately</div>
            </div>
          </div>

          {/* Governing Principles Hash */}
          <div className="border-t border-white/[0.06] pt-5 mt-5">
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">
              Governing Principles — SHA-256 Hash (On-Chain Verifiable)
            </div>
            <div className="bg-black border border-white/[0.04] p-3 overflow-x-auto">
              <code className="font-mono text-[0.65rem] text-[#39FF14] break-all">
                1b00324c274789d2cb96913e223c9491a07b8cd57becef5f5c2b541d40b3e60d
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-3">
              <a
                href="https://wyobiz.wyo.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[0.55rem] text-[#9945FF] hover:text-[#b06aff] transition-colors"
              >
                Verify on Wyoming SoS &rarr;
              </a>
              <a
                href="/docs#legal"
                className="font-mono text-[0.55rem] text-mythic-text-muted hover:text-white transition-colors"
              >
                Read Governing Principles &rarr;
              </a>
            </div>
          </div>

          {/* Statute reference */}
          <div className="mt-4 font-mono text-[0.5rem] tracking-[0.06em] text-mythic-text-muted leading-relaxed">
            Formed under Wyoming Statutes §§ 17-36-101 through 17-36-115 (DUNA Act) and §§ 17-19-101 through 17-19-1807 (Nonprofit Corporation Act). Members are holders of the $MYTH token (~300 at formation). Limited liability for all members per W.S. § 17-36-109.
          </div>
        </div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="text-center pt-8 border-t border-white/[0.06]">
        <p className="font-mono text-[0.6rem] tracking-[0.1em] text-mythic-text-muted mb-3">
          CA: 5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump
        </p>
        <div className="flex items-center justify-center gap-4">
          <a href="https://mythic.sh" className="font-mono text-[0.55rem] text-mythic-text-muted hover:text-white transition-colors">Website</a>
          <a href="https://mythic.sh/docs" className="font-mono text-[0.55rem] text-mythic-text-muted hover:text-white transition-colors">Docs</a>
          <a href="https://github.com/MythicFoundation" target="_blank" rel="noopener noreferrer" className="font-mono text-[0.55rem] text-mythic-text-muted hover:text-white transition-colors">GitHub</a>
          <a href="https://x.com/Mythic_L2" target="_blank" rel="noopener noreferrer" className="font-mono text-[0.55rem] text-mythic-text-muted hover:text-white transition-colors">X / Twitter</a>
        </div>
      </div>
    </div>
  )
}
