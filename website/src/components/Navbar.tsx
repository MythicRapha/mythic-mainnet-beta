'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FaXTwitter, FaTelegram, FaGithub } from 'react-icons/fa6'
import WalletButton from './WalletButton'

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
            href="https://mythic.money"
            target="_blank"
            rel="noopener noreferrer"
            className="px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-[#00E5FF] hover:text-[#66EFFF] transition-colors border-b border-transparent"
          >
            Launchpad
          </a>
          <Link
            href="/docs"
            className="px-[18px] py-[19px] font-mono text-[0.6rem] tracking-[0.12em] uppercase font-medium text-mythic-text-dim hover:text-mythic-text-secondary transition-colors border-b border-transparent"
          >
            Docs
          </Link>
          <a
            href="https://github.com/MythicL2"
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
              Swap ↗
            </a>
            <a
              href="https://mythic.money"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-[#00E5FF] hover:text-[#66EFFF] transition-colors"
            >
              Launchpad ↗
            </a>
            <Link
              href="/docs"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase font-medium text-mythic-text-dim hover:text-white transition-colors"
            >
              Docs
            </Link>
            <div className="flex items-center gap-4 px-3 py-2.5">
              <a href="https://github.com/MythicL2" target="_blank" rel="noopener noreferrer" className="text-mythic-text-dim hover:text-white transition-colors" aria-label="GitHub">
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
