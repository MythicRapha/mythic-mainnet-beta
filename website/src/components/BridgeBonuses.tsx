'use client'

import { useState, useEffect, useRef } from 'react'

interface L2Transaction {
  signature: string
  slot: number
  blockTime: number | null
  fee: number
  accounts: string[]
}

interface PointsEvent {
  id: string
  action: string
  pts: number
  wallet: string
  sig: string
}

// Classify L2 transactions into points actions based on program involvement
// Bridge points are now amount-based: 10 pts/SOL + 5 pts/SOL/day holding bonus
function classifyTx(tx: L2Transaction): { action: string; pts: number } | null {
  const programs = tx.accounts || []
  if (programs.some(a => a.startsWith('MythBrdg'))) {
    // Amount-based: estimate from fee/accounts, show base rate
    return { action: 'Bridge Deposit', pts: 10 } // per SOL — actual calculated server-side
  }
  if (programs.some(a => a === '3QB8S38ouuREEDPxnaaGeujLsUhwFoRbLAejKywtEgv7' || a.startsWith('MythSwap'))) return { action: 'Swap Trade', pts: 50 }
  if (programs.some(a => a.startsWith('MythPad'))) return { action: 'Token Launch', pts: 500 }
  if (programs.some(a => a.startsWith('MythGov'))) return { action: 'Governance Vote', pts: 25 }
  if (programs.some(a => a.startsWith('MythStak'))) return { action: 'Staking Action', pts: 100 }
  if (programs.some(a => a.startsWith('MythToken') || a === '7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq')) return { action: 'MYTH Transfer', pts: 10 }
  if (tx.fee > 0) return { action: 'Transaction', pts: 5 }
  return null
}

function useLiveL2Feed() {
  const [events, setEvents] = useState<PointsEvent[]>([])
  const [totalPts, setTotalPts] = useState(0)
  const [loading, setLoading] = useState(true)
  const seenSigs = useRef(new Set<string>())

  const fetchRecent = async () => {
    try {
      const res = await fetch('/api/l2-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            'DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg',
            { limit: 10, commitment: 'confirmed' },
          ],
        }),
      })
      const json = await res.json()
      const sigs = json?.result || []

      const newEvents: PointsEvent[] = []

      for (const sigInfo of sigs) {
        if (seenSigs.current.has(sigInfo.signature)) continue
        seenSigs.current.add(sigInfo.signature)

        const txRes = await fetch('/api/l2-rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [sigInfo.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
          }),
        })
        const txJson = await txRes.json()
        const txData = txJson?.result

        if (!txData) continue

        const accounts = txData.transaction?.message?.accountKeys?.map((k: any) => typeof k === 'string' ? k : k.pubkey) || []
        const classified = classifyTx({
          signature: sigInfo.signature,
          slot: txData.slot,
          blockTime: txData.blockTime,
          fee: txData.meta?.fee || 0,
          accounts,
        })

        if (classified) {
          const wallet = accounts.find((a: string) =>
            a !== '11111111111111111111111111111111' &&
            a !== 'DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg' &&
            !a.startsWith('Myth')
          ) || accounts[0] || 'unknown'

          const shortWallet = wallet.length > 8
            ? `${wallet.slice(0, 4)}...${wallet.slice(-3)}`
            : wallet

          newEvents.push({
            id: sigInfo.signature,
            action: classified.action,
            pts: classified.pts,
            wallet: shortWallet,
            sig: sigInfo.signature,
          })
        }
      }

      if (newEvents.length > 0) {
        setEvents(prev => [...newEvents, ...prev].slice(0, 8))
        setTotalPts(prev => prev + newEvents.reduce((sum, e) => sum + e.pts, 0))
      }
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecent()
    const interval = setInterval(fetchRecent, 8000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { events, totalPts, loading }
}

// Season 1 countdown — 30 days from Feb 24, 2026
function useCountdown() {
  const SEASON_END = new Date('2026-03-26T00:00:00Z').getTime()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const diff = Math.max(0, SEASON_END - now)
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)
  return { days, hours, minutes, seconds, expired: diff <= 0 }
}

function MarqueeFeed({ events, totalPts, loading }: { events: PointsEvent[]; totalPts: number; loading: boolean }) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [fade, setFade] = useState(true)

  useEffect(() => {
    if (events.length === 0) return
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setCurrentIdx(prev => (prev + 1) % events.length)
        setFade(true)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [events.length])

  const current = events[currentIdx]

  return (
    <div className="mt-6 border border-white/[0.06] bg-[#08080C] overflow-hidden">
      <div className="px-5 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="w-1.5 h-1.5 bg-[#39FF14] animate-pulse" />
          <span className="font-mono text-[0.55rem] tracking-[0.12em] uppercase text-[#39FF14]">Live</span>
        </div>

        <div className="flex-1 overflow-hidden h-6 flex items-center">
          {loading && events.length === 0 ? (
            <span className="font-mono text-[0.6rem] text-mythic-text-muted animate-pulse">Loading L2 transactions...</span>
          ) : !current ? (
            <span className="font-mono text-[0.6rem] text-mythic-text-muted">Waiting for network activity...</span>
          ) : (
            <a
              href={`https://explorer.mythic.sh/tx/${current.sig}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 transition-opacity duration-300 hover:opacity-80 ${fade ? 'opacity-100' : 'opacity-0'}`}
            >
              <span className="font-mono text-[0.55rem] text-mythic-text-muted">{current.wallet}</span>
              <span className="font-mono text-[0.6rem] text-white font-medium">{current.action}</span>
              <span className="font-mono text-[0.45rem] text-mythic-violet">{current.sig.slice(0, 8)}...{current.sig.slice(-4)}</span>
              <span className="font-mono text-[0.7rem] font-bold text-[#39FF14]">+{current.pts}</span>
            </a>
          )}
        </div>

        <div className="flex-shrink-0 font-mono text-[0.55rem] text-mythic-text-dim">
          <span className="text-[#39FF14] font-bold">{totalPts.toLocaleString('en-US')}</span> pts
          {events.length > 1 && (
            <span className="ml-2 text-mythic-text-dim">
              {currentIdx + 1}/{events.length}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BridgeBonuses() {
  const [activeTab, setActiveTab] = useState<'earn' | 'tiers' | 'multiply' | 'claim'>('earn')
  const { events, totalPts, loading } = useLiveL2Feed()
  const countdown = useCountdown()

  return (
    <div className="mt-20 max-w-[1080px] mx-auto">

      {/* ===== HERO BANNER ===== */}
      <div className="relative overflow-hidden border border-[#39FF14]/20 bg-gradient-to-br from-[#39FF14]/[0.04] via-transparent to-mythic-violet/[0.04]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#39FF14]/40 to-transparent animate-pulse" />
        </div>

        <div className="p-8 sm:p-12 text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#39FF14]/40 bg-[#39FF14]/[0.08] mb-6">
            <span className="w-2 h-2 bg-[#39FF14] animate-pulse" />
            <span className="font-mono text-[0.6rem] tracking-[0.15em] uppercase text-[#39FF14] font-bold">
              Season 1 Live — Limited Time
            </span>
          </div>

          <h2 className="font-display text-[2rem] sm:text-[2.8rem] font-extrabold tracking-[-0.02em] text-white mb-3">
            Points Program
          </h2>
          <p className="text-mythic-text text-[0.85rem] max-w-[500px] mx-auto">
            Earn points for every action on Mythic L2. At the end of the season, the MYTH rewards pool
            is split based on your points. More points = bigger share. It&apos;s that simple.
          </p>

          {/* Countdown + Distribution model */}
          <div className="mt-8 inline-flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
            <div className="px-6 py-3 border border-[#39FF14]/30 bg-[#39FF14]/[0.06]">
              <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#39FF14]/60 mb-1">Season 1 Ends In</div>
              {countdown.expired ? (
                <div className="font-display text-[1.4rem] font-extrabold text-[#39FF14]">Snapshot Pending</div>
              ) : (
                <div className="font-display text-[1.4rem] sm:text-[1.8rem] font-extrabold text-[#39FF14] tabular-nums">
                  {countdown.days}d {String(countdown.hours).padStart(2, '0')}h {String(countdown.minutes).padStart(2, '0')}m {String(countdown.seconds).padStart(2, '0')}s
                </div>
              )}
            </div>
            <div className="px-6 py-3 border border-mythic-violet/30 bg-mythic-violet/[0.06]">
              <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-mythic-violet/60 mb-1">Rewards</div>
              <div className="font-display text-[1.4rem] sm:text-[1.8rem] font-extrabold text-white">
                More Points = More MYTH
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 border border-[#FF9500]/20 bg-[#FF9500]/[0.04]">
              <span className="font-mono text-[0.6rem] font-bold text-[#FF9500] tracking-wide">
                YOUR SHARE = YOUR POINTS / TOTAL POINTS
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 border border-white/[0.08] bg-white/[0.02]">
              <span className="font-mono text-[0.6rem] text-mythic-text-muted tracking-wide">
                Fewer participants = bigger individual share
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== LIVE POINTS MARQUEE ===== */}
      <MarqueeFeed events={events} totalPts={totalPts} loading={loading} />

      {/* ===== TABBED SECTION ===== */}
      <div className="mt-8">
        <div className="flex border-b border-white/[0.06]">
          {[
            { id: 'earn' as const, label: 'Earn Points' },
            { id: 'tiers' as const, label: 'Rank Tiers' },
            { id: 'multiply' as const, label: 'Multipliers' },
            { id: 'claim' as const, label: 'How It Works' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase text-center transition-all ${
                activeTab === tab.id
                  ? 'text-[#39FF14] border-b-2 border-[#39FF14] bg-[#39FF14]/[0.03]'
                  : 'text-mythic-text-muted hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="border border-t-0 border-white/[0.06] bg-[#08080C]">
          {/* === EARNING ACTIONS === */}
          {activeTab === 'earn' && (
            <div className="p-6">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-[#39FF14]/[0.04] border border-[#39FF14]/10 mb-2">
                <div className="col-span-5 font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#39FF14]">Action</div>
                <div className="col-span-3 font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#39FF14] text-center">Points</div>
                <div className="col-span-4 font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#39FF14] text-right">Frequency</div>
              </div>

              {/* Bridge Points — Amount-Based (NEW) */}
              <div className="mb-4 p-5 border-2 border-[#39FF14]/30 bg-[#39FF14]/[0.04] relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#39FF14] to-transparent animate-pulse" />
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 bg-[#39FF14] text-black font-mono text-[0.5rem] font-bold tracking-wider">NEW</span>
                  <span className="font-display text-white font-bold text-[1rem]">Bridge Points — Amount &amp; Holding Based</span>
                </div>
                <p className="text-mythic-text text-[0.8rem] mb-4">
                  Bridge points now scale with <span className="text-[#39FF14] font-bold">how much you bridge</span> and <span className="text-[#39FF14] font-bold">how long you hold on L2</span>.
                  Spamming small bridges no longer works. Go big and stay.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 bg-black/40 border border-[#39FF14]/20">
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="font-display text-[2rem] font-extrabold text-[#39FF14]">10</span>
                      <span className="font-mono text-[0.6rem] text-[#39FF14]/60">pts / SOL bridged</span>
                    </div>
                    <div className="font-mono text-[0.55rem] text-mythic-text-dim">
                      Base points on deposit. Bridge 10 SOL = 100 pts. Bridge 100 SOL = 1,000 pts.
                    </div>
                  </div>
                  <div className="p-4 bg-black/40 border border-[#39FF14]/20">
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="font-display text-[2rem] font-extrabold text-[#39FF14]">+5</span>
                      <span className="font-mono text-[0.6rem] text-[#39FF14]/60">pts / SOL / day held</span>
                    </div>
                    <div className="font-mono text-[0.55rem] text-mythic-text-dim">
                      Daily holding bonus. Bridge 10 SOL, hold 7 days = 350 bonus pts. Max 30 days.
                    </div>
                  </div>
                </div>
                <div className="mt-3 p-3 bg-black/30 border border-[#FF9500]/15">
                  <div className="font-mono text-[0.55rem] text-[#FF9500]">
                    Example: Bridge 50 SOL, hold 14 days = 500 base + 3,500 holding = <span className="font-bold text-[#39FF14]">4,000 pts</span> (before multipliers)
                  </div>
                </div>
              </div>

              {[
                { action: 'Validator Operation', desc: 'Run a validator with 95%+ uptime', pts: '1,000', freq: 'Per day', color: 'text-[#39FF14]' },
                { action: 'Token Launch', desc: 'Launch via Mythic.Money bonding curve', pts: '500', freq: 'Per launch', color: 'text-[#00E5FF]' },
                { action: 'LP Position', desc: 'Active liquidity in any MythicSwap pool', pts: '200', freq: 'Per day', color: 'text-[#FF9500]' },
                { action: 'Staking', desc: 'Stake MYTH in the staking program', pts: '100', freq: 'Per day', color: 'text-mythic-violet-bright' },
                { action: 'Swap Trade', desc: 'Any pool on MythicSwap', pts: '50', freq: 'Per trade', color: 'text-[#FF9500]' },
                { action: 'Governance Vote', desc: 'Vote on active proposals', pts: '25', freq: 'Per vote', color: 'text-mythic-violet-bright' },
              ].map((row, i) => (
                <div key={row.action} className={`grid grid-cols-12 gap-2 px-4 py-3.5 items-center ${i % 2 === 0 ? 'bg-white/[0.01]' : ''} border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors`}>
                  <div className="col-span-5">
                    <div className="font-display text-white font-semibold text-[0.85rem]">{row.action}</div>
                    <div className="font-mono text-[0.6rem] text-mythic-text-muted mt-0.5">{row.desc}</div>
                  </div>
                  <div className={`col-span-3 font-display text-[1.4rem] font-extrabold ${row.color} text-center`}>{row.pts}</div>
                  <div className="col-span-4 font-mono text-[0.65rem] text-mythic-text text-right">{row.freq}</div>
                </div>
              ))}

              {/* Streak bonus */}
              <div className="mt-6 p-5 border border-[#FF9500]/20 bg-[#FF9500]/[0.03]">
                <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#FF9500] mb-3">Streak Bonuses — Consistency Rewarded</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { streak: '3-Day', bonus: '+25%', desc: 'Active 3 consecutive days' },
                    { streak: '7-Day', bonus: '+50%', desc: 'Active 7 consecutive days' },
                    { streak: '14-Day', bonus: '+100%', desc: 'Active every day for 2 weeks' },
                  ].map((item) => (
                    <div key={item.streak} className="p-3 bg-black/40 border border-[#FF9500]/10">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-[1.1rem] font-extrabold text-[#FF9500]">{item.bonus}</span>
                        <span className="font-mono text-[0.55rem] text-[#FF9500]/60 uppercase">{item.streak} Streak</span>
                      </div>
                      <div className="font-mono text-[0.55rem] text-mythic-text-dim mt-1">{item.desc}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 font-mono text-[0.5rem] text-mythic-text-dim">
                  Any on-chain action counts. Break your streak and it resets to 0.
                </div>
              </div>

              {/* Combo bonus */}
              <div className="mt-4 p-5 border border-[#39FF14]/20 bg-[#39FF14]/[0.03]">
                <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#39FF14] mb-3">Combo Actions — Stack Your Points</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-black/40 border border-[#39FF14]/10">
                    <div className="font-display text-[0.85rem] font-bold text-white">Bridge + Hold + LP</div>
                    <div className="font-mono text-[0.55rem] text-[#39FF14] mt-1">Bridge big, hold on L2, add LP = maximum compounding points</div>
                  </div>
                  <div className="p-3 bg-black/40 border border-[#39FF14]/10">
                    <div className="font-display text-[0.85rem] font-bold text-white">Hold + Stake + Trade</div>
                    <div className="font-mono text-[0.55rem] text-[#39FF14] mt-1">Daily holding bonus + staking + swap points stack with streaks</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === RANK TIERS === */}
          {activeTab === 'tiers' && (
            <div className="p-6 space-y-6">
              <div className="text-center mb-2">
                <p className="text-mythic-text text-[0.85rem] max-w-[520px] mx-auto">
                  Your rank determines how big your slice is. Higher tiers get a <span className="text-[#39FF14] font-bold">bigger cut</span> of the rewards pool. Rank is based on where you land vs. everyone else.
                </p>
              </div>

              {[
                { tier: 'DIAMOND', pct: 'Top 1%', color: '#39FF14', bonus: '3x Share Weight', border: '#39FF14', glow: true, icon: '\u25C6' },
                { tier: 'PLATINUM', pct: 'Top 5%', color: '#C0C0C0', bonus: '2x Share Weight', border: '#C0C0C0', glow: false, icon: '\u25C6' },
                { tier: 'GOLD', pct: 'Top 15%', color: '#FFD700', bonus: '1.5x Share Weight', border: '#FFD700', glow: false, icon: '\u25C6' },
                { tier: 'SILVER', pct: 'Top 30%', color: '#A0A0A0', bonus: '1.2x Share Weight', border: '#A0A0A0', glow: false, icon: '\u25C6' },
                { tier: 'BRONZE', pct: 'Everyone else', color: '#CD7F32', bonus: '1x Share Weight', border: '#CD7F32', glow: false, icon: '\u25C6' },
              ].map((t) => (
                <div
                  key={t.tier}
                  className="relative border p-5 flex items-center gap-5 transition-all hover:scale-[1.01]"
                  style={{
                    borderColor: `${t.border}33`,
                    backgroundColor: `${t.color}08`,
                    boxShadow: t.glow ? `0 0 30px ${t.color}15, inset 0 0 30px ${t.color}05` : undefined,
                  }}
                >
                  {t.glow && (
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent to-transparent animate-pulse" style={{ background: `linear-gradient(90deg, transparent, ${t.color}80, transparent)` }} />
                  )}
                  <div className="flex-shrink-0 w-16 h-16 flex items-center justify-center border" style={{ borderColor: `${t.border}40`, backgroundColor: `${t.color}10` }}>
                    <span className="font-display text-[1.6rem] font-extrabold" style={{ color: t.color }}>{t.icon}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-baseline gap-3">
                      <span className="font-display text-[1.1rem] font-extrabold tracking-[0.05em]" style={{ color: t.color }}>{t.tier}</span>
                      <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-muted">{t.pct}</span>
                    </div>
                    <div className="font-mono text-[0.7rem] text-white mt-1">{t.bonus}</div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="font-display text-[1.4rem] font-extrabold" style={{ color: t.color }}>
                      {t.bonus.split(' ')[0]}
                    </div>
                    <div className="font-mono text-[0.45rem] text-mythic-text-dim uppercase">share weight</div>
                  </div>
                </div>
              ))}

              <div className="p-4 border border-white/[0.06] bg-white/[0.01]">
                <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-2">How Share Weight Works</div>
                <p className="text-mythic-text text-[0.75rem] leading-relaxed">
                  At season snapshot, your effective points = raw points x share weight. A Diamond tier user with 10,000 points has 30,000 effective points.
                  The MYTH pool is distributed proportionally to effective points. <span className="text-[#39FF14] font-bold">Higher tier = disproportionately larger reward.</span>
                </p>
              </div>
            </div>
          )}

          {/* === MULTIPLIERS === */}
          {activeTab === 'multiply' && (
            <div className="p-6 space-y-6">
              <div className="relative border border-[#39FF14]/30 bg-[#39FF14]/[0.04] p-6 overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#39FF14] to-transparent" />
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                  <div className="text-center sm:text-left">
                    <div className="font-mono text-[0.5rem] tracking-[0.2em] uppercase text-[#39FF14] mb-2">Genesis Bonus</div>
                    <div className="font-display text-[4rem] font-extrabold text-[#39FF14] leading-none" style={{ textShadow: '0 0 40px rgba(57,255,20,0.4)' }}>
                      3x
                    </div>
                    <div className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-[#39FF14]/60 mt-1">All Points</div>
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-[0.9rem] leading-relaxed">
                      The <span className="text-[#39FF14] font-bold">first 48 hours</span> of Season 1. Every single point you earn is tripled. This window does not come back.
                    </p>
                    <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 border border-[#39FF14]/20 bg-[#39FF14]/[0.06]">
                      <span className="font-mono text-[0.55rem] text-[#39FF14]">FIRST 48 HOURS ONLY — NON-REPEATABLE</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-[#FF9500]/20 bg-[#FF9500]/[0.03] p-5">
                <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#FF9500] mb-3">Time-Decay Multiplier — Earlier = Better</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 border border-[#39FF14]/20 bg-[#39FF14]/[0.06]">
                    <div className="font-display text-[1.8rem] font-extrabold text-[#39FF14]">3x</div>
                    <div className="font-mono text-[0.55rem] text-[#39FF14]/60">First 48 Hours</div>
                  </div>
                  <div className="p-3 border border-[#FF9500]/20 bg-[#FF9500]/[0.04]">
                    <div className="font-display text-[1.8rem] font-extrabold text-[#FF9500]">2x</div>
                    <div className="font-mono text-[0.55rem] text-[#FF9500]/60">Days 3 — 7</div>
                  </div>
                  <div className="p-3 border border-white/[0.08] bg-white/[0.02]">
                    <div className="font-display text-[1.8rem] font-extrabold text-mythic-text">1x</div>
                    <div className="font-mono text-[0.55rem] text-mythic-text-dim">After Week 1</div>
                  </div>
                </div>
                <div className="mt-3 font-mono text-[0.5rem] text-mythic-text-dim text-center">
                  Multipliers stack with streak bonuses and tier weights. A Diamond user on a 14-day streak during 3x window earns 3 x 2 x 3 = <span className="text-[#39FF14] font-bold">18x effective points</span>.
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="border border-[#39FF14]/15 bg-[#39FF14]/[0.02] p-5 text-center">
                  <div className="font-display text-[2rem] font-extrabold text-[#39FF14]">3x</div>
                  <div className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-muted mt-1">Genesis Validator</div>
                  <div className="font-mono text-[0.5rem] text-mythic-text-dim mt-2">First 10 validators — permanent S1</div>
                </div>
                <div className="border border-[#39FF14]/15 bg-[#39FF14]/[0.02] p-5 text-center">
                  <div className="font-display text-[2rem] font-extrabold text-[#39FF14]">2x</div>
                  <div className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-muted mt-1">AI Validator</div>
                  <div className="font-mono text-[0.5rem] text-mythic-text-dim mt-2">AI-capable nodes with inference</div>
                </div>
                <div className="border border-[#FF9500]/15 bg-[#FF9500]/[0.02] p-5 text-center">
                  <div className="font-display text-[2rem] font-extrabold text-[#FF9500]">1.5x</div>
                  <div className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-muted mt-1">LP + Bridge Combo</div>
                  <div className="font-mono text-[0.5rem] text-mythic-text-dim mt-2">Active bridge + LP position</div>
                </div>
              </div>

              <div className="border border-[#FF2D78]/15 bg-[#FF2D78]/[0.02] p-5 flex items-center gap-5">
                <div className="text-center flex-shrink-0">
                  <div className="font-display text-[2rem] font-extrabold text-[#FF2D78]">+10%</div>
                  <div className="font-mono text-[0.5rem] text-[#FF2D78]/60">Permanent</div>
                </div>
                <div>
                  <div className="font-display text-white font-semibold text-[0.9rem]">Referral Bonus</div>
                  <p className="text-mythic-text text-[0.75rem] mt-1">Earn 10% of the points anyone you refer earns. Stacks with all multipliers. No cap. Lasts entire season.</p>
                </div>
              </div>
            </div>
          )}

          {/* === HOW IT WORKS === */}
          {activeTab === 'claim' && (
            <div className="p-6 space-y-6">
              <div className="text-center mb-4">
                <div className="font-display text-[1.4rem] font-bold text-white mb-2">Season Snapshot &rarr; Claim Your MYTH</div>
                <p className="text-mythic-text text-[0.85rem] max-w-[560px] mx-auto">
                  At the end of Season 1, a snapshot captures every wallet&apos;s total effective points.
                  The MYTH rewards pool is split based on your points. More points = bigger share. No lockup. No vesting. Claim instantly.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                {[
                  { step: '01', title: 'Earn Points', desc: 'Bridge, trade, LP, stake, vote — every on-chain action earns points automatically', color: '#39FF14' },
                  { step: '02', title: 'Stack Multipliers', desc: 'Streaks, early bonuses, tier weights, combos — multipliers stack to maximize your share', color: '#7B2FFF' },
                  { step: '03', title: 'Season Snapshot', desc: 'When the countdown hits zero, your effective points are locked. Final rank determines tier', color: '#FF9500' },
                  { step: '04', title: 'Claim MYTH', desc: 'Connect wallet on mythic.foundation/points and claim your share. Instant. No vesting', color: '#39FF14' },
                ].map((s) => (
                  <div key={s.step} className="border border-white/[0.06] bg-white/[0.01] p-5 text-center hover:border-white/[0.12] transition-colors">
                    <div className="w-12 h-12 flex items-center justify-center mx-auto mb-3 border" style={{ borderColor: `${s.color}33`, backgroundColor: `${s.color}0D` }}>
                      <span className="font-display text-[1.1rem] font-bold" style={{ color: s.color }}>{s.step}</span>
                    </div>
                    <h4 className="font-display text-white font-semibold text-[0.85rem] mb-2">{s.title}</h4>
                    <p className="text-mythic-text text-[0.7rem] leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>

              <div className="p-5 bg-[#39FF14]/[0.03] border border-[#39FF14]/15">
                <div className="font-mono text-[0.5rem] tracking-[0.15em] uppercase text-[#39FF14]/60 mb-4">Example: Bridge 50 SOL, Hold 14 Days, Active Week 1</div>
                <div className="space-y-2">
                  {[
                    { label: 'Bridge 50 SOL (500 base x 3x early multiplier)', value: '1,500 pts' },
                    { label: 'Holding bonus (50 SOL x 5 pts/day x 14 days)', value: '3,500 pts' },
                    { label: 'Daily LP (200/d x 3x) for 2 days, then (200/d x 2x) for 5 days', value: '3,200 pts' },
                    { label: '5 trades/day (50 x multiplier) x 7 days', value: '4,550 pts' },
                    { label: '7-day streak bonus (+50%)', value: '+6,375 pts' },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
                      <span className="font-mono text-[0.65rem] text-mythic-text-dim">{row.label}</span>
                      <span className="font-mono text-[0.65rem] text-[#39FF14]">{row.value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3">
                    <span className="font-display text-white font-bold text-[0.9rem]">Total Effective Points</span>
                    <span className="font-display text-[#39FF14] font-extrabold text-[1rem]">19,125 pts</span>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-black/30 border border-[#39FF14]/10">
                  <div className="font-mono text-[0.55rem] text-mythic-text-dim">
                    If this puts you in the top 1%, your Diamond tier 3x share weight makes your effective pool share <span className="text-[#39FF14] font-bold">57,375 weighted points</span>.
                    The earlier you start and the more consistent you are, the larger your slice.
                  </div>
                </div>
              </div>

              <div className="text-center">
                <a
                  href="https://mythic.foundation/points"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#39FF14] text-black font-display text-[0.85rem] font-bold tracking-[0.04em] hover:bg-[#66FF44] transition-colors"
                >
                  View Your Points Dashboard
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== URGENCY FOOTER ===== */}
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 p-5 border border-[#39FF14]/20 bg-[#39FF14]/[0.03]">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-[#39FF14] animate-pulse" />
          <span className="font-mono text-[0.65rem] text-[#39FF14] font-bold tracking-wide">
            3x MULTIPLIER WINDOW CLOSING — Every hour you wait, your share shrinks
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://mythic.foundation/points"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[0.6rem] text-[#7B2FFF] hover:text-[#9B5FFF] transition-colors font-bold"
          >
            View Points Dashboard &rarr;
          </a>
          <div className="font-mono text-[0.55rem] text-mythic-text-dim">
            {!countdown.expired && (
              <span>{countdown.days}d {countdown.hours}h remaining</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
