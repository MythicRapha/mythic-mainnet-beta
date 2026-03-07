'use client'

import { useWalletContext } from '@/providers/WalletProvider'
import { useProfileContext } from '@/providers/ProfileProvider'
import { detectAvailableWallets, detectAvailableWalletsAsync } from '@/hooks/useWallet'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function PhantomIcon({ size = 24 }: { size?: number }) {
  return <img src="/brand/phantom-logo.svg" alt="Phantom" width={size} height={size} className="flex-shrink-0" />
}

function SolflareIcon({ size = 24 }: { size?: number }) {
  return <img src="/brand/solflare-logo.svg" alt="Solflare" width={size} height={size} className="flex-shrink-0" />
}

function MythicIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" rx="26" fill="#7B2FFF"/>
      <path d="M64 28L38 66l26 11 26-11L64 28z" fill="white" fillOpacity="0.95"/>
      <path d="M38 66l26 11 26-11L64 100 38 66z" fill="white" fillOpacity="0.65"/>
    </svg>
  )
}

function GlobeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" rx="26" fill="#7B2FFF"/>
      <circle cx="64" cy="64" r="30" stroke="white" strokeWidth="3" fill="none"/>
      <ellipse cx="64" cy="64" rx="14" ry="30" stroke="white" strokeWidth="3" fill="none"/>
      <line x1="34" y1="64" x2="94" y2="64" stroke="white" strokeWidth="3"/>
      <line x1="64" y1="34" x2="64" y2="94" stroke="white" strokeWidth="3"/>
    </svg>
  )
}

function TelegramIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" rx="26" fill="#229ED9"/>
      <path d="M28 62l72-30c3-1.2 5.6.7 4.6 5L92 93c-.7 3.2-2.7 4-5.4 2.5l-15-11-7.2 7c-.8.8-1.5 1.5-3 1.5l1-15.3L90.5 53c1.2-1.1-.3-1.7-1.9-.6L52.8 73.2l-14.6-4.6c-3.2-1-.3-5 2.8-6.6z" fill="white"/>
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-mythic-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

function SolanaLogo({ size = 12 }: { size?: number }) {
  return <img src="/brand/solana-logo.svg" alt="SOL" width={size} height={size} className="flex-shrink-0" />
}

function MythLogo({ size = 12 }: { size?: number }) {
  return <img src="/favicon.svg" alt="MYTH" width={size} height={size} className="flex-shrink-0" />
}

export default function WalletButton() {
  const { connected, shortAddress, balance, l2Balance, connecting, openWalletModal, closeWalletModal, connectWallet, disconnect, walletName, showWalletModal } = useWalletContext()
  const { displayName, pfpUrl } = useProfileContext()

  const [available, setAvailable] = useState({ mythic: false, phantom: false, solflare: false })

  // Detect on mount with retry for extension injection timing
  useEffect(() => {
    detectAvailableWalletsAsync().then(setAvailable)
  }, [])

  // Re-detect synchronously when modal opens
  useEffect(() => {
    if (showWalletModal) {
      detectAvailableWalletsAsync().then(setAvailable)
    }
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
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* L1 SOL Balance */}
        <div className="hidden sm:flex items-center gap-1 px-2 py-1.5 bg-[#08080C] border border-white/[0.06] whitespace-nowrap flex-shrink-0">
          <SolanaLogo size={13} />
          <span className="font-mono text-[0.6rem] tracking-[0.04em] text-mythic-text-dim font-medium leading-none">
            {balance !== null ? balance.toFixed(2) : '—'}
          </span>
        </div>
        {/* L2 MYTH Balance */}
        <div className="hidden sm:flex items-center gap-1 px-2 py-1.5 bg-[#08080C] border border-mythic-violet/15 whitespace-nowrap flex-shrink-0">
          <MythLogo size={13} />
          <span className="font-mono text-[0.6rem] tracking-[0.04em] text-mythic-violet font-medium leading-none">
            {l2Balance !== null ? (l2Balance >= 1_000_000 ? `${(l2Balance / 1_000_000).toFixed(1)}M` : l2Balance >= 1_000 ? `${(l2Balance / 1_000).toFixed(1)}K` : l2Balance.toFixed(2)) : '—'}
          </span>
        </div>
        {/* Profile + disconnect */}
        <button
          onClick={disconnect}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#08080C] border border-white/[0.06] text-white font-mono text-[0.6rem] tracking-[0.06em] hover:border-red-500/20 transition-colors whitespace-nowrap flex-shrink-0"
        >
          {pfpUrl ? (
            <img src={pfpUrl} alt="" className="w-4 h-4 object-cover flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="w-4 h-4 bg-mythic-violet/30 flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-[0.45rem] text-mythic-violet font-bold leading-none">
                {(displayName || shortAddress || '?').charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {displayName || shortAddress}
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

      {showWalletModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }} onClick={closeWalletModal}>
          <div className="relative w-full max-w-md max-h-[80vh] overflow-y-auto bg-[#08080C] border border-white/[0.06] p-6 sm:p-8" onClick={e => e.stopPropagation()}>
            <button onClick={closeWalletModal} className="absolute top-4 right-4 text-mythic-text-muted hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <h3 className="font-mono text-sm font-bold text-white mb-1 tracking-[0.08em] uppercase">
              Connect Wallet
            </h3>
            <p className="font-mono text-[0.7rem] text-mythic-text-muted mb-6">
              Your Solana wallet works on Mythic L2. Same address, same keys.
            </p>

            <div className="space-y-2">
              {/* Mythic Wallet Extension */}
              {available.mythic ? (
                <button
                  onClick={() => connectWallet('mythic')}
                  className="flex items-center gap-4 w-full px-4 py-3.5 bg-mythic-violet/10 border border-mythic-violet/30 hover:border-mythic-violet/60 transition-colors text-left"
                >
                  <MythicIcon size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Mythic Wallet</div>
                    <div className="font-mono text-[0.6rem] text-mythic-violet">Detected</div>
                  </div>
                </button>
              ) : (
                <a
                  href="https://wallet.mythic.sh/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 w-full px-4 py-3.5 bg-mythic-violet/5 border border-mythic-violet/10 hover:border-mythic-violet/30 transition-colors"
                >
                  <MythicIcon size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Mythic Wallet</div>
                    <div className="font-mono text-[0.6rem] text-mythic-violet">Install</div>
                  </div>
                  <ExternalLinkIcon />
                </a>
              )}

              {/* Phantom */}
              {available.phantom ? (
                <button
                  onClick={() => connectWallet('phantom')}
                  className="flex items-center gap-4 w-full px-4 py-3.5 bg-[#AB9FF2]/5 border border-[#AB9FF2]/20 hover:border-[#AB9FF2]/50 transition-colors text-left"
                >
                  <PhantomIcon size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Phantom</div>
                    <div className="font-mono text-[0.6rem] text-[#AB9FF2]">Detected</div>
                  </div>
                </button>
              ) : (
                <a
                  href="https://phantom.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 w-full px-4 py-3.5 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                >
                  <PhantomIcon size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Phantom</div>
                    <div className="font-mono text-[0.6rem] text-mythic-text-muted">Install</div>
                  </div>
                  <ExternalLinkIcon />
                </a>
              )}

              {/* Solflare */}
              {available.solflare ? (
                <button
                  onClick={() => connectWallet('solflare')}
                  className="flex items-center gap-4 w-full px-4 py-3.5 bg-[#FC9936]/5 border border-[#FC9936]/20 hover:border-[#FC9936]/50 transition-colors text-left"
                >
                  <SolflareIcon size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Solflare</div>
                    <div className="font-mono text-[0.6rem] text-[#FC9936]">Detected</div>
                  </div>
                </button>
              ) : (
                <a
                  href="https://solflare.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 w-full px-4 py-3.5 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                >
                  <SolflareIcon size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.75rem] text-white font-medium">Solflare</div>
                    <div className="font-mono text-[0.6rem] text-mythic-text-muted">Install</div>
                  </div>
                  <ExternalLinkIcon />
                </a>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="font-mono text-[0.55rem] text-mythic-text-muted uppercase tracking-[0.15em]">Other</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              {/* Web Wallet */}
              <a
                href="https://wallet.mythic.sh"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-4 py-3.5 bg-[#0F0F15] border border-white/[0.06] hover:border-mythic-violet/30 transition-colors"
              >
                <GlobeIcon size={28} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[0.75rem] text-white font-medium">Web Wallet</div>
                  <div className="font-mono text-[0.6rem] text-mythic-violet">wallet.mythic.sh</div>
                </div>
                <ExternalLinkIcon />
              </a>

              {/* TG Wallet */}
              <a
                href="https://t.me/MythicWalletBot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-4 py-3.5 bg-[#0F0F15] border border-white/[0.06] hover:border-[#229ED9]/30 transition-colors"
              >
                <TelegramIcon size={28} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[0.75rem] text-white font-medium">Telegram Wallet</div>
                  <div className="font-mono text-[0.6rem] text-[#229ED9]">@MythicWalletBot</div>
                </div>
                <ExternalLinkIcon />
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
