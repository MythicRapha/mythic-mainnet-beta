'use client'

import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { FaXTwitter, FaTelegram, FaGithub } from 'react-icons/fa6'
import WalletButton from './WalletButton'

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [mobileResourcesOpen, setMobileResourcesOpen] = useState(false)
  const resourcesRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (resourcesRef.current && !resourcesRef.current.contains(event.target as Node)) {
        setResourcesOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleResourcesEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setResourcesOpen(true)
  }

  const handleResourcesLeave = () => {
    timeoutRef.current = setTimeout(() => setResourcesOpen(false), 150)
  }

  return (
    <nav className="sticky top-0 z-50 h-14 border-b border-white/[0.06] bg-black/80 backdrop-blur-xl">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10 h-full flex items-center justify-between">
        {/* Brand — Sora uppercase, matches brand-kit .nav-brand */}
        <Link href="/" className="font-display font-bold text-[0.85rem] tracking-[0.2em] uppercase text-white">
          Mythic
        </Link>

        {/* Desktop Nav — Mono links, matches brand-kit .nav-links */}
        <div className="hidden md:flex items-center">
          <Link
            href="/bridge"
            className="px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-mythic-text-dim hover:text-mythic-text-secondary transition-colors border-b border-transparent"
          >
            Bridge
          </Link>
          <a
            href="https://mythicswap.app"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-[#FF9500] hover:text-[#FFB347] transition-colors border-b border-transparent"
          >
            Swap
          </a>
          <a
            href="https://mythic.fun"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-[#00E5FF] hover:text-[#66EFFF] transition-colors border-b border-transparent"
          >
            Launchpad
          </a>

          {/* Resources Dropdown */}
          <div
            ref={resourcesRef}
            className="relative"
            onMouseEnter={handleResourcesEnter}
            onMouseLeave={handleResourcesLeave}
          >
            <button
              onClick={() => setResourcesOpen(!resourcesOpen)}
              className="flex items-center gap-1 px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-mythic-text-dim hover:text-mythic-text-secondary transition-colors border-b border-transparent"
            >
              Resources
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${resourcesOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Panel */}
            <div
              className={`absolute top-full left-0 mt-0 w-[220px] bg-[#0D0D14] border border-[rgba(123,47,255,0.2)] shadow-lg shadow-black/40 transition-all duration-200 origin-top ${
                resourcesOpen
                  ? 'opacity-100 scale-y-100 pointer-events-auto'
                  : 'opacity-0 scale-y-95 pointer-events-none'
              }`}
            >
              <div className="py-2">
                <Link
                  href="/docs"
                  onClick={() => setResourcesOpen(false)}
                  className="flex items-center gap-3 px-5 py-3 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white hover:bg-[#7B2FFF]/10 transition-colors"
                >
                  <svg className="w-4 h-4 text-[#7B2FFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                  Documentation
                </Link>
                <a
                  href="https://explorer.mythic.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-5 py-3 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white hover:bg-[#7B2FFF]/10 transition-colors"
                >
                  <svg className="w-4 h-4 text-[#7B2FFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  Block Explorer
                </a>
                <Link
                  href="/whitepaper"
                  className="flex items-center gap-3 px-5 py-3 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white hover:bg-[#7B2FFF]/10 transition-colors"
                >
                  <svg className="w-4 h-4 text-[#7B2FFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  Whitepaper
                </Link>
              </div>
            </div>
          </div>

          <a
            href="https://wallet.mythic.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-mythic-violet hover:text-mythic-violet-bright transition-colors border-b border-transparent"
          >
            Wallet
          </a>
          <a
            href="https://github.com/MythicFoundation"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[14px] py-[19px] text-mythic-text-dim hover:text-white transition-colors"
            aria-label="GitHub"
          >
            <FaGithub className="w-[15px] h-[15px]" />
          </a>
          <a
            href="https://x.com/Mythic_L2"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[14px] py-[19px] text-mythic-text-dim hover:text-white transition-colors"
            aria-label="X"
          >
            <FaXTwitter className="w-[15px] h-[15px]" />
          </a>
          <a
            href="https://t.me/MythicL2"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[14px] py-[19px] text-mythic-text-dim hover:text-white transition-colors"
            aria-label="Telegram"
          >
            <FaTelegram className="w-[15px] h-[15px]" />
          </a>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <div className="hidden md:block">
            <WalletButton />
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-mythic-text-dim hover:text-white transition-colors"
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-xl">
          <div className="px-5 py-4 space-y-1">
            <Link
              href="/bridge"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white transition-colors"
            >
              Bridge
            </Link>
            <a
              href="https://mythicswap.app"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-[#FF9500] hover:text-[#FFB347] transition-colors"
            >
              Swap
            </a>
            <a
              href="https://mythic.fun"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-[#00E5FF] hover:text-[#66EFFF] transition-colors"
            >
              Launchpad
            </a>

            {/* Mobile Resources Accordion */}
            <button
              onClick={() => setMobileResourcesOpen(!mobileResourcesOpen)}
              className="flex items-center justify-between w-full px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white transition-colors"
            >
              Resources
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${mobileResourcesOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {mobileResourcesOpen && (
              <div className="pl-6 space-y-1 border-l border-[rgba(123,47,255,0.2)] ml-3">
                <Link
                  href="/docs"
                  onClick={() => { setMobileMenuOpen(false); setMobileResourcesOpen(false) }}
                  className="block px-3 py-2 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white transition-colors"
                >
                  Documentation
                </Link>
                <a
                  href="https://explorer.mythic.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white transition-colors"
                >
                  Block Explorer
                </a>
                <Link
                  href="/whitepaper"
                  onClick={() => { setMobileMenuOpen(false); setMobileResourcesOpen(false) }}
                  className="block px-3 py-2 font-mono text-[0.6rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white transition-colors"
                >
                  Whitepaper
                </Link>
              </div>
            )}

            <a
              href="https://wallet.mythic.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-mythic-violet hover:text-mythic-violet-bright transition-colors"
            >
              Wallet
            </a>
            <div className="flex items-center gap-4 px-3 py-2.5">
              <a href="https://github.com/MythicFoundation" target="_blank" rel="noopener noreferrer" className="text-mythic-text-dim hover:text-white transition-colors" aria-label="GitHub">
                <FaGithub className="w-[18px] h-[18px]" />
              </a>
              <a href="https://x.com/Mythic_L2" target="_blank" rel="noopener noreferrer" className="text-mythic-text-dim hover:text-white transition-colors" aria-label="X">
                <FaXTwitter className="w-[18px] h-[18px]" />
              </a>
              <a href="https://t.me/MythicL2" target="_blank" rel="noopener noreferrer" className="text-mythic-text-dim hover:text-white transition-colors" aria-label="Telegram">
                <FaTelegram className="w-[18px] h-[18px]" />
              </a>
            </div>
            <div className="pt-3 border-t border-white/[0.06]">
              <WalletButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
