'use client'

import { useState, FormEvent } from 'react'

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/

function detectInputType(query: string): { type: 'tx' | 'account' | 'block' | 'search'; path: string } {
  const trimmed = query.trim()
  if (!trimmed) return { type: 'search', path: `/search?q=` }

  // Numeric = slot/block number
  if (/^\d+$/.test(trimmed)) {
    return { type: 'block', path: `/block/${trimmed}` }
  }

  // Base58 check
  if (BASE58_RE.test(trimmed)) {
    // 87-88 chars = transaction signature
    if (trimmed.length >= 85 && trimmed.length <= 90) {
      return { type: 'tx', path: `/tx/${trimmed}` }
    }
    // 32-44 chars = account/pubkey
    if (trimmed.length >= 32 && trimmed.length <= 44) {
      return { type: 'account', path: `/address/${trimmed}` }
    }
  }

  // Fallback: general search
  return { type: 'search', path: `/address/${encodeURIComponent(trimmed)}` }
}

export default function ExplorerSearch() {
  const [query, setQuery] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    const { path } = detectInputType(trimmed)
    window.open(`https://explorer.mythic.sh${path}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[560px] mx-auto mt-8">
      <div className="relative group">
        {/* Search icon */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-mythic-text-muted">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions, accounts, blocks..."
          className="w-full bg-[#08080C] border border-white/[0.06] pl-11 pr-4 py-3 font-mono text-[0.75rem] text-white placeholder:text-mythic-text-muted outline-none transition-colors focus:border-mythic-violet/60 focus:shadow-[0_0_0_1px_rgba(123,47,255,0.15)]"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </form>
  )
}
