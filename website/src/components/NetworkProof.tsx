'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

interface NetworkData {
  network: string
  label: string
  rpcUrl: string
  online: boolean
  healthy: boolean
  slot: number
  epoch: number
  slotIndex: number
  slotsInEpoch: number
  transactionCount: number
  peakTps: number | null
  liveTps: number | null
  slotRate: number | null
  version: string | null
  timestamp: number
}

interface StatusResponse {
  networks: NetworkData[]
  fetchedAt: string
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function timeSince(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

// Hook that smoothly animates a number from its current value to a target
function useAnimatedNumber(target: number, duration: number = 600): number {
  const [display, setDisplay] = useState(target)
  const rafRef = useRef<number>(0)
  const startRef = useRef({ value: target, time: 0 })

  useEffect(() => {
    if (target === display && startRef.current.time === 0) {
      setDisplay(target)
      return
    }

    const startValue = display
    const startTime = performance.now()
    startRef.current = { value: startValue, time: startTime }

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.round(startValue + (target - startValue) * eased)
      setDisplay(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  return display
}

// Component that interpolates slot value between API fetches
function LiveSlot({ baseSlot, slotRate, online }: { baseSlot: number; slotRate: number | null; online: boolean }) {
  const [interpolated, setInterpolated] = useState(baseSlot)
  const baseRef = useRef({ slot: baseSlot, time: Date.now() })

  // Update base when new API data arrives
  useEffect(() => {
    baseRef.current = { slot: baseSlot, time: Date.now() }
    setInterpolated(baseSlot)
  }, [baseSlot])

  // Tick up the slot every ~400ms based on slot rate
  useEffect(() => {
    if (!online || !slotRate || slotRate <= 0) return

    const msPerSlot = 1000 / slotRate
    const interval = setInterval(() => {
      const elapsed = Date.now() - baseRef.current.time
      const extraSlots = Math.floor(elapsed / msPerSlot)
      setInterpolated(baseRef.current.slot + extraSlots)
    }, 400)

    return () => clearInterval(interval)
  }, [online, slotRate])

  const animated = useAnimatedNumber(interpolated, 350)

  if (!online) return <span>&mdash;</span>
  return <>{formatNumber(animated)}</>
}

// Component that animates a number with smooth transitions
function AnimatedStat({ value, online, color }: { value: number | null; online: boolean; color?: string }) {
  const animated = useAnimatedNumber(value ?? 0, 600)
  if (!online || value === null) return <span>&mdash;</span>
  return <span className={color}>{formatNumber(animated)}</span>
}

function NetworkCard({ net }: { net: NetworkData }) {
  const epochProgress = net.slotsInEpoch > 0
    ? (net.slotIndex / net.slotsInEpoch) * 100
    : 0

  const animatedEpochProgress = useAnimatedNumber(Math.round(epochProgress * 100), 800) / 100
  const animatedSlotIndex = useAnimatedNumber(net.slotIndex, 600)

  return (
    <div
      className={`bg-[#08080C] border transition-colors ${
        net.online
          ? 'border-white/[0.06] hover:border-mythic-violet/20'
          : 'border-red-500/20'
      }`}
    >
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className={`w-2.5 h-2.5 ${
                net.online
                  ? net.healthy ? 'bg-[#39FF14]' : 'bg-yellow-400'
                  : 'bg-red-500'
              }`}
            />
            {net.online && (
              <div
                className={`absolute inset-0 w-2.5 h-2.5 animate-ping ${
                  net.healthy ? 'bg-[#39FF14]/40' : 'bg-yellow-400/40'
                }`}
              />
            )}
          </div>
          <div>
            <h3 className="font-display text-white font-semibold text-[0.95rem]">
              {net.label}
            </h3>
            <span className="font-mono text-[0.5rem] tracking-[0.1em] text-mythic-text-muted">
              {net.rpcUrl}
            </span>
          </div>
        </div>
        <div className={`px-2.5 py-1 font-mono text-[0.5rem] tracking-[0.1em] uppercase font-semibold ${
          net.online
            ? 'bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {net.online ? (net.healthy ? 'Online' : 'Degraded') : 'Offline'}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Current Slot
            </div>
            <div className="font-display text-[1.15rem] font-bold tabular-nums text-white">
              <LiveSlot baseSlot={net.slot} slotRate={net.slotRate} online={net.online} />
            </div>
          </div>

          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Epoch
            </div>
            <div className="font-display text-[1.15rem] font-bold text-white tabular-nums">
              {net.online ? net.epoch : '\u2014'}
            </div>
          </div>

          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Peak TPS
            </div>
            <div className="font-display text-[1.15rem] font-bold text-mythic-violet tabular-nums">
              <AnimatedStat value={net.peakTps} online={net.online} />
            </div>
          </div>

          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Live TPS
            </div>
            <div className="font-display text-[1.15rem] font-bold text-mythic-violet tabular-nums">
              <AnimatedStat value={net.liveTps} online={net.online} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Total Txns
            </div>
            <div className="font-display text-[1.15rem] font-bold text-white tabular-nums">
              <AnimatedStat value={net.transactionCount} online={net.online} />
            </div>
          </div>

          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Version
            </div>
            <div className="font-mono text-[0.8rem] text-white">
              {net.version || '\u2014'}
            </div>
          </div>

          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Blocks
            </div>
            <div className="flex items-center gap-2">
              {net.online ? (
                <>
                  <div className="flex gap-[2px]">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        className="w-1 bg-[#39FF14] animate-pulse"
                        style={{
                          height: `${8 + Math.random() * 10}px`,
                          animationDelay: `${i * 200}ms`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[0.6rem] text-[#39FF14]">Producing</span>
                </>
              ) : (
                <span className="font-mono text-[0.6rem] text-red-400">Halted</span>
              )}
            </div>
          </div>
        </div>

        {/* Epoch Progress */}
        {net.online && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted">
                Epoch Progress
              </span>
              <span className="font-mono text-[0.5rem] text-mythic-text-muted">
                {formatNumber(animatedSlotIndex)} / {formatNumber(net.slotsInEpoch)} ({animatedEpochProgress.toFixed(0)}%)
              </span>
            </div>
            <div className="w-full h-1.5 bg-white/[0.04] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-mythic-violet to-mythic-violet-bright"
                style={{
                  width: `${animatedEpochProgress}%`,
                  transition: 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Verify Link */}
      <div className="px-5 py-3 border-t border-white/[0.04] flex items-center justify-between">
        <span className="font-mono text-[0.45rem] tracking-[0.1em] text-mythic-text-muted">
          Verify independently via RPC
        </span>
        <a
          href={`https://${net.rpcUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[0.5rem] tracking-[0.1em] text-mythic-violet hover:text-mythic-violet-bright transition-colors flex items-center gap-1"
        >
          {net.rpcUrl}
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  )
}

export default function NetworkProof() {
  const [networks, setNetworks] = useState<NetworkData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string>('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/network-status', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      const json: StatusResponse = await res.json()

      setNetworks(json.networks)
      setLastRefresh(timeSince(Date.now()))
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch data every 4 seconds
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 4000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Update "last refresh" label every second
  useEffect(() => {
    const tick = setInterval(() => {
      if (networks.length > 0) setLastRefresh(timeSince(networks[0].timestamp))
    }, 1000)
    return () => clearInterval(tick)
  }, [networks])

  if (loading) {
    return (
      <section className="py-[80px] sm:py-[100px] border-t border-white/[0.06]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-white/5 w-40 mb-4" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-[320px] bg-white/[0.02] border border-white/[0.06]" />
              <div className="h-[320px] bg-white/[0.02] border border-white/[0.06]" />
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="py-[80px] sm:py-[100px] border-t border-white/[0.06]">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
        {/* Header */}
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted mb-4">
              Live Network Status
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-2">
              Network Proof
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              Real-time on-chain data fetched directly from the Mythic L2 RPC node. Independently verifiable.
            </p>
          </div>
          <div className="flex items-center gap-2 text-mythic-text-muted">
            <button
              onClick={fetchStatus}
              className="font-mono text-[0.6rem] tracking-[0.1em] uppercase px-3 py-1.5 border border-white/[0.08] hover:border-mythic-violet/30 hover:text-mythic-violet transition-colors"
            >
              Refresh
            </button>
            <span className="font-mono text-[0.55rem] tracking-[0.1em]">
              {lastRefresh}
            </span>
          </div>
        </div>

        {error && networks.length === 0 && (
          <div className="text-center py-12 border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 font-mono text-[0.75rem]">Failed to fetch network data. Retrying...</p>
          </div>
        )}

        {/* Dual Network Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {networks.map(net => (
            <NetworkCard
              key={net.network}
              net={net}
            />
          ))}
        </div>

        {/* RPC Verification Box */}
        <div className="mt-6 bg-[#08080C] border border-white/[0.06] p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-9 h-9 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-mythic-violet" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2 2 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-display text-white font-semibold text-[0.85rem] mb-1">
                Verify It Yourself
              </h4>
              <p className="text-mythic-text text-[0.78rem] leading-relaxed mb-3">
                Run this command in your terminal to independently verify the Mythic L2 network is live:
              </p>
              <div className="bg-black/40 border border-white/[0.06] p-3 font-mono text-[0.7rem] text-[#39FF14] overflow-x-auto">
                <code>curl -s -X POST https://rpc.mythic.sh -H &quot;Content-Type: application/json&quot; -d &apos;{'{'}&#34;jsonrpc&#34;:&#34;2.0&#34;,&#34;id&#34;:1,&#34;method&#34;:&#34;getSlot&#34;{'}'}&#39; | python3 -m json.tool</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
