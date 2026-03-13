'use client'

import { useEffect, useState, useCallback } from 'react'

interface LiveStats {
  slot: number
  epoch: number
  blockTimeMs: number | null
  validatorCount: number
  transactionCount: number
  online: boolean
}

interface L1Supply {
  amount: number   // raw token amount (human-readable)
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

async function rpcCall(method: string, params: unknown[] = []) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch('/api/l2-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    const data = await res.json()
    return data.result
  } finally {
    clearTimeout(timeout)
  }
}

export default function StatsBar() {
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [l1Supply, setL1Supply] = useState<L1Supply | null>(null)
  const [registeredValidators, setRegisteredValidators] = useState<number | null>(null)
  const [visible, setVisible] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const [slot, epochInfo, samples, txCount, voteAccounts] = await Promise.allSettled([
        rpcCall('getSlot'),
        rpcCall('getEpochInfo'),
        rpcCall('getRecentPerformanceSamples', [1]),
        rpcCall('getTransactionCount'),
        rpcCall('getVoteAccounts'),
      ])

      const slotVal = slot.status === 'fulfilled' ? slot.value : null
      const epochVal = epochInfo.status === 'fulfilled' ? epochInfo.value : null
      const samplesVal = samples.status === 'fulfilled' ? samples.value : null
      const txCountVal = txCount.status === 'fulfilled' ? txCount.value : null
      const voteVal = voteAccounts.status === 'fulfilled' ? voteAccounts.value : null

      const sample = samplesVal?.[0]
      const blockTimeMs = sample
        ? Math.round((sample.samplePeriodSecs / sample.numSlots) * 1000)
        : null

      const validatorCount = (voteVal?.current?.length ?? 0) + (voteVal?.delinquent?.length ?? 0)

      setStats({
        slot: slotVal ?? 0,
        epoch: epochVal?.epoch ?? 0,
        blockTimeMs: blockTimeMs,
        validatorCount,
        transactionCount: txCountVal ?? epochVal?.transactionCount ?? 0,
        online: slotVal !== null && slotVal !== undefined,
      })
    } catch {
      setStats(prev => prev ? { ...prev, online: false } : null)
    }
  }, [])

  const fetchRegisteredValidators = useCallback(async () => {
    try {
      const res = await fetch('/api/supply/validators')
      if (res.ok) {
        const data = await res.json()
        if (typeof data.active === 'number') {
          setRegisteredValidators(data.active)
        }
      }
    } catch {
      // keep previous data
    }
  }, [])

  const fetchL1Supply = useCallback(async () => {
    try {
      // Server-side route — no CORS, no client env issues
      const res = await fetch('/api/myth-supply')
      const data = await res.json()
      if (data?.supply && data.supply > 0) {
        setL1Supply({ amount: data.supply })
      }
    } catch {
      // keep previous data
    }
  }, [])

  useEffect(() => {
    fetchStats()
    fetchL1Supply()
    fetchRegisteredValidators()
    const statsInterval = setInterval(fetchStats, 5000)
    const burnInterval = setInterval(fetchL1Supply, 30000)
    const validatorInterval = setInterval(fetchRegisteredValidators, 60000)
    const timer = setTimeout(() => setVisible(true), 300)
    return () => {
      clearInterval(statsInterval)
      clearInterval(burnInterval)
      clearInterval(validatorInterval)
      clearTimeout(timer)
    }
  }, [fetchStats, fetchL1Supply, fetchRegisteredValidators])

  const items = [
    {
      label: 'Status',
      value: stats ? (stats.online ? 'Online' : 'Offline') : '...',
      accent: stats?.online ? 'text-[#39FF14]' : stats === null ? 'text-white' : 'text-red-400',
      dot: stats?.online,
    },
    {
      label: 'Current Slot',
      value: stats?.online ? formatNumber(stats.slot) : '...',
      accent: 'text-white',
    },
    {
      label: 'Validators',
      value: stats?.online
        ? (stats.validatorCount > 0 ? String(stats.validatorCount) : '1')
        : '...',
      accent: 'text-mythic-violet',
    },
    {
      label: 'MYTH Supply',
      value: l1Supply ? formatNumber(l1Supply.amount) : '...',
      accent: 'text-mythic-violet',
    },
  ]

  return (
    <div className="w-full border-y border-white/[0.06]">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {items.map((item, i) => (
            <div
              key={item.label}
              className={`py-8 text-center border-r border-white/[0.06] last:border-r-0 transition-all duration-700 ${
                visible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className={`font-display text-[2rem] font-bold mb-1 tabular-nums ${item.accent}`}>
                {'dot' in item && item.dot && (
                  <span className="inline-block w-2 h-2 bg-[#39FF14] mr-2 animate-pulse align-middle" />
                )}
                {item.value}
              </div>
              <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
