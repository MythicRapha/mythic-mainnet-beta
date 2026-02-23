'use client'

import Link from 'next/link'
import { useState } from 'react'
import WalletButton from './WalletButton'

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 border-b border-mythic-border/50 bg-mythic-bg/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-mythic-purple to-mythic-cyan flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-xl font-bold gradient-text">MYTHIC</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <Link
              href="/bridge"
              className="text-mythic-text hover:text-white transition-colors text-sm font-medium"
            >
              Bridge
            </Link>
            <Link
              href="/docs"
              className="text-mythic-text hover:text-white transition-colors text-sm font-medium"
            >
              Docs
            </Link>
            <a
              href="https://github.com/mythic-labs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mythic-text hover:text-white transition-colors text-sm font-medium"
            >
              GitHub
            </a>
            <a
              href="https://twitter.com/MythicL2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mythic-text hover:text-white transition-colors text-sm font-medium"
            >
              Twitter
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
              className="md:hidden p-2 rounded-lg text-mythic-text hover:text-white hover:bg-mythic-card transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-mythic-border/50 bg-mythic-bg/95 backdrop-blur-xl">
          <div className="px-4 py-4 space-y-3">
            <Link
              href="/bridge"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-mythic-text hover:text-white hover:bg-mythic-card transition-colors text-sm font-medium"
            >
              Bridge
            </Link>
            <Link
              href="/docs"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-mythic-text hover:text-white hover:bg-mythic-card transition-colors text-sm font-medium"
            >
              Docs
            </Link>
            <a
              href="https://github.com/mythic-labs"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 rounded-lg text-mythic-text hover:text-white hover:bg-mythic-card transition-colors text-sm font-medium"
            >
              GitHub
            </a>
            <a
              href="https://twitter.com/MythicL2"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 rounded-lg text-mythic-text hover:text-white hover:bg-mythic-card transition-colors text-sm font-medium"
            >
              Twitter
            </a>
            <div className="pt-2">
              <WalletButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
