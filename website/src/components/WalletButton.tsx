'use client'

import { useWalletContext } from '@/providers/WalletProvider'
import { detectAvailableWallets } from '@/hooks/useWallet'
import { useEffect, useState } from 'react'

export default function WalletButton() {
  const { connected, shortAddress, balance, connecting, openWalletModal, closeWalletModal, connectWallet, disconnect, walletName, showWalletModal } = useWalletContext()

  const [available, setAvailable] = useState({ mythic: false, phantom: false, solflare: false })

  useEffect(() => {
    setAvailable(detectAvailableWallets())
  }, [showWalletModal])

  if (connecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 bg-[#08080C] border border-white/[0.06] text-mythic-text-dim font-mono text-[0.65rem] tracking-[0.1em] uppercase"
      >
        <span className="inline-block w-3.5 h-3.5 border-2 border-mythic-violet border-t-transparent rounded-full animate-spin" />
        Connecting
      </button>
    )
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-[#08080C] border border-white/[0.06]">
          <span className="font-mono text-[0.65rem] tracking-[0.08em] text-mythic-violet font-medium">{balance?.toFixed(2)} SOL</span>
          {walletName && (
            <span className="font-mono text-[0.5rem] tracking-[0.08em] text-mythic-text-muted uppercase">
              {walletName === 'mythic' ? '⚡' : walletName === 'phantom' ? '👻' : '☀️'}
            </span>
          )}
        </div>
        <button
          onClick={disconnect}
          className="flex items-center gap-2 px-4 py-2 bg-[#08080C] border border-white/[0.06] text-white font-mono text-[0.65rem] tracking-[0.1em] hover:border-mythic-violet/20 transition-colors"
        >
          <span className="w-1.5 h-1.5 bg-green-400" />
          {shortAddress}
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={openWalletModal}
        className="px-4 py-2 bg-mythic-violet text-white font-display text-[0.75rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors"
      >
        Connect Wallet
      </button>

      {showWalletModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closeWalletModal}>
          <div className="relative w-full max-w-md mx-4 bg-[#08080C] border border-white/[0.06] p-8" onClick={e => e.stopPropagation()}>
            <button onClick={closeWalletModal} className="absolute top-4 right-4 text-mythic-text-muted hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <h3 className="font-mono text-sm font-bold text-white mb-1 tracking-[0.08em] uppercase">
              Connect Wallet
            </h3>
            <p className="font-mono text-[0.7rem] text-mythic-text-muted mb-6">
              Select a wallet to connect to Mythic L2.
            </p>

            <div className="space-y-2">
              {/* Mythic Wallet */}
              {available.mythic ? (
                <button
                  onClick={() => connectWallet('mythic')}
                  className="flex items-center gap-4 w-full px-4 py-3 bg-mythic-violet/10 border border-mythic-violet/30 hover:border-mythic-violet/60 transition-colors text-left"
                >
                  <span className="text-lg flex-shrink-0">⚡</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Mythic Wallet</div>
                    <div className="font-mono text-[0.6rem] text-mythic-violet">Detected</div>
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-4 w-full px-4 py-3 bg-mythic-violet/5 border border-mythic-violet/10 opacity-60">
                  <span className="text-lg flex-shrink-0">⚡</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Mythic Wallet</div>
                    <div className="font-mono text-[0.6rem] text-mythic-text-muted">Coming Soon</div>
                  </div>
                </div>
              )}

              {/* Web Wallet */}
              <a
                href="https://wallet.mythic.sh"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-4 py-3 bg-mythic-violet/5 border border-mythic-violet/20 hover:border-mythic-violet/40 transition-colors"
              >
                <span className="text-lg flex-shrink-0">🌐</span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[0.75rem] text-white font-medium">Web Wallet</div>
                  <div className="font-mono text-[0.6rem] text-mythic-violet">wallet.mythic.sh</div>
                </div>
                <svg className="w-3.5 h-3.5 text-mythic-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>

              {/* TG Wallet */}
              <a
                href="https://t.me/MythicWalletBot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-4 py-3 bg-mythic-violet/5 border border-mythic-violet/20 hover:border-mythic-violet/40 transition-colors"
              >
                <span className="text-lg flex-shrink-0">✈️</span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[0.75rem] text-white font-medium">TG Wallet</div>
                  <div className="font-mono text-[0.6rem] text-mythic-violet">@MythicWalletBot</div>
                </div>
                <svg className="w-3.5 h-3.5 text-mythic-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>

              {/* Divider */}
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="font-mono text-[0.55rem] text-mythic-text-muted uppercase tracking-[0.15em]">External</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              {/* Phantom */}
              {available.phantom ? (
                <button
                  onClick={() => connectWallet('phantom')}
                  className="flex items-center gap-4 w-full px-4 py-3 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left"
                >
                  <span className="text-lg flex-shrink-0">👻</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Phantom</div>
                    <div className="font-mono text-[0.6rem] text-green-400">Detected</div>
                  </div>
                </button>
              ) : (
                <a
                  href="https://phantom.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 w-full px-4 py-3 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                >
                  <span className="text-lg flex-shrink-0">👻</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Phantom</div>
                    <div className="font-mono text-[0.6rem] text-mythic-text-muted">Not installed</div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-mythic-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
              )}

              {/* Solflare */}
              {available.solflare ? (
                <button
                  onClick={() => connectWallet('solflare')}
                  className="flex items-center gap-4 w-full px-4 py-3 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left"
                >
                  <span className="text-lg flex-shrink-0">☀️</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Solflare</div>
                    <div className="font-mono text-[0.6rem] text-green-400">Detected</div>
                  </div>
                </button>
              ) : (
                <a
                  href="https://solflare.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 w-full px-4 py-3 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                >
                  <span className="text-lg flex-shrink-0">☀️</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Solflare</div>
                    <div className="font-mono text-[0.6rem] text-mythic-text-muted">Not installed</div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-mythic-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
