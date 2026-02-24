'use client'

import { useBridge } from '@/hooks/useBridge'

export default function BridgeLiveStats() {
  const { stats, l2Paused, solVaultTvl } = useBridge()
  const isPaused = stats?.paused || l2Paused

  return (
    <div className="inline-flex items-center gap-4 px-4 py-2 border border-white/[0.06] bg-[#08080C]">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 ${
          !stats ? 'bg-mythic-amber animate-pulse' :
          isPaused ? 'bg-mythic-error' : 'bg-[#39FF14] animate-pulse'
        }`} />
        <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-mythic-text-dim">
          {!stats ? 'Connecting...' : isPaused ? 'Paused' : 'Active'}
        </span>
      </div>
      {stats && (
        <>
          <div className="w-px h-3 bg-white/[0.06]" />
          <div className="text-center">
            <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">Reserve</span>
            <span className="font-mono text-[0.65rem] text-white">{solVaultTvl.toFixed(2)} SOL</span>
          </div>
          <div className="w-px h-3 bg-white/[0.06]" />
          <div className="text-center">
            <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase text-mythic-text-muted block">Deposits</span>
            <span className="font-mono text-[0.65rem] text-white">{stats.depositNonce.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  )
}
