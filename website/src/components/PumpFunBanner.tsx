'use client'

import { useState } from 'react'

const PUMPFUN_CONTRACT = 'MYTH1111111111111111111111111111111111111111'
const PUMPFUN_URL = 'https://pump.fun/coin/'

export default function PumpFunBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (dismissed) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(PUMPFUN_CONTRACT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  return (
    <div className="relative z-50 bg-[#39FF14]/10 border-b border-[#39FF14]/20">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* PumpFun icon */}
          <span className="flex-shrink-0 w-5 h-5 bg-[#39FF14]/20 border border-[#39FF14]/30 flex items-center justify-center">
            <svg className="w-3 h-3 text-[#39FF14]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
            </svg>
          </span>

          <span className="font-mono text-[0.6rem] sm:text-[0.65rem] tracking-[0.08em] uppercase text-[#39FF14] font-medium flex-shrink-0">
            $MYTH Live on PumpFun
          </span>

          <span className="hidden sm:inline text-white/20 flex-shrink-0">|</span>

          {/* Contract address */}
          <button
            onClick={handleCopy}
            className="hidden sm:flex items-center gap-2 min-w-0 group"
            title="Copy contract address"
          >
            <span className="font-mono text-[0.6rem] text-white/50 truncate max-w-[200px] lg:max-w-[360px] group-hover:text-white/70 transition-colors">
              {PUMPFUN_CONTRACT}
            </span>
            <span className="font-mono text-[0.5rem] text-[#39FF14]/60 group-hover:text-[#39FF14] transition-colors flex-shrink-0">
              {copied ? '✓ COPIED' : 'COPY'}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <a
            href={`${PUMPFUN_URL}${PUMPFUN_CONTRACT}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 bg-[#39FF14] text-black font-mono text-[0.55rem] sm:text-[0.6rem] tracking-[0.08em] uppercase font-bold hover:bg-[#66FF44] transition-colors"
          >
            Buy on PumpFun
          </a>

          <button
            onClick={() => setDismissed(true)}
            className="text-white/30 hover:text-white/60 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
