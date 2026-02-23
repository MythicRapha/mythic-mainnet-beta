'use client'

import { useEffect, useState } from 'react'

interface StatItem {
  label: string
  value: string
}

const stats: StatItem[] = [
  { label: 'TPS', value: '1,000,000+' },
  { label: 'Block Time', value: '400ms' },
  { label: 'AI Validators', value: 'Coming Soon' },
  { label: 'Token', value: '$MYTH' },
]

export default function StatsBar() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="w-full border-y border-mythic-border/50 bg-mythic-card/50 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`text-center transition-all duration-700 ${
                visible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className="text-xl sm:text-2xl font-bold gradient-text mb-1">
                {stat.value}
              </div>
              <div className="text-mythic-text text-xs sm:text-sm uppercase tracking-wider">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
