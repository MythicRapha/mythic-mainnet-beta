'use client'

import { useEffect, useState, useCallback } from 'react'

interface LiveStats {
  slot: number
  epoch: number
  tps: number | null
  transactionCount: number
  online: boolean
}

interface BurnStats {
  burned: number
  circulating: number
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatBurn(n: number): string {
  if (n === 0) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K'
  return n.toFixed(2)
}

const RPC_URL = 'https://rpc.mythic.sh'

async function rpcCall(method: string, params: unknown[] = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  return data.result
}

export default function StatsBar() {
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [burn, setBurn] = useState<BurnStats | null>(null)
  const [visible, setVisible] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const [slot, epochInfo, samples, txCount] = await Promise.allSettled([
        rpcCall('getSlot'),
        rpcCall('getEpochInfo'),
        rpcCall('getRecentPerformanceSamples', [1]),
        rpcCall('getTransactionCount'),
      ])

      const slotVal = slot.status === 'fulfilled' ? slot.value : null
      const epochVal = epochInfo.status === 'fulfilled' ? epochInfo.value : null
      const samplesVal = samples.status === 'fulfilled' ? samples.value : null
      const txCountVal = txCount.status === 'fulfilled' ? txCount.value : null

      const blockTimeMs = samplesVal?.[0]
        ? Math.round((samplesVal[0].samplePeriodSecs / samplesVal[0].numSlots) * 1000)
        : null

      setStats({
        slot: slotVal ?? 0,
        epoch: epochVal?.epoch ?? 0,
        tps: blockTimeMs,
        transactionCount: txCountVal ?? epochVal?.transactionCount ?? 0,
        online: slotVal !== null && slotVal !== undefined,
      })
    } catch {
      setStats(prev => prev ? { ...prev, online: false } : null)
    }
  }, [])

  const fetchBurn = useCallback(async () => {
    try {
      const res = await fetch('/api/supply')
      if (!res.ok) return
      const data = await res.json()
      setBurn({
        burned: data.supply?.burned ?? 0,
        circulating: data.supply?.circulating ?? 1_000_000_000,
      })
    } catch {
      // keep previous data
    }
  }, [])

  useEffect(() => {
    fetchStats()
    fetchBurn()
    const statsInterval = setInterval(fetchStats, 5000)
    const burnInterval = setInterval(fetchBurn, 15000)
    const timer = setTimeout(() => setVisible(true), 300)
    return () => {
      clearInterval(statsInterval)
      clearInterval(burnInterval)
      clearTimeout(timer)
    }
  }, [fetchStats, fetchBurn])

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
      label: 'Block Time',
      value: stats?.online && stats.tps !== null ? `~${stats.tps}ms` : '...',
      accent: 'text-mythic-violet',
    },
    {
      label: 'Burned',
      value: burn ? formatBurn(burn.burned) + ' MYTH' : '...',
      accent: 'text-[#FF4444]',
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
