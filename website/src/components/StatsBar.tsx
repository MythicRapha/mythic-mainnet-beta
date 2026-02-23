'use client'

import { useEffect, useState } from 'react'

interface StatItem {
  label: string
  value: string
}

const stats: StatItem[] = [
  { label: 'TPS', value: '1,000,000+' },
  { label: 'Block Time', value: '400ms' },
  { label: 'AI Validators', value: 'Soon' },
  { label: 'Token', value: '$MYTH' },
]

export default function StatsBar() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="w-full border-y border-white/[0.06]">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`py-8 text-center border-r border-white/[0.06] last:border-r-0 transition-all duration-700 ${
                visible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className="font-display text-[2rem] font-bold text-white mb-1">
                {stat.value}
              </div>
              <div className="font-mono text-[0.55rem] tracking-[0.15em] uppercase text-mythic-text-muted">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
