'use client'

import { useWalletContext } from '@/providers/WalletProvider'

export default function WalletButton() {
  const { connected, shortAddress, balance, connecting, connect, disconnect, walletName, showInstallPrompt, dismissInstallPrompt } = useWalletContext()

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
        onClick={connect}
        className="px-4 py-2 bg-mythic-violet text-white font-display text-[0.75rem] font-semibold tracking-[0.04em] hover:bg-mythic-violet-bright transition-colors"
      >
        Connect Wallet
      </button>

      {/* Install Wallet Popup */}
      {showInstallPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={dismissInstallPrompt}>
          <div className="relative w-full max-w-md mx-4 bg-[#0A0A10] border border-white/[0.08] p-8" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button onClick={dismissInstallPrompt} className="absolute top-4 right-4 text-mythic-text-muted hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            {/* Convergence mark */}
            <div className="flex justify-center mb-6">
              <svg viewBox="0 0 100 100" className="w-14 h-14" fill="none">
                <polygon points="50,8 20,44 50,56" fill="#39FF14" opacity="0.9" />
                <polygon points="50,8 80,44 50,56" fill="#66FF44" opacity="0.75" />
                <polygon points="20,44 50,56 80,44 50,92" fill="#1A8A0A" opacity="0.85" />
              </svg>
            </div>

            <h3 className="text-center font-display text-xl font-bold text-white mb-2">
              No Wallet Detected
            </h3>
            <p className="text-center text-mythic-text text-sm mb-8 leading-relaxed">
              Install a compatible wallet to connect to Mythic L2. We recommend Mythic Wallet for the best experience.
            </p>

            <div className="space-y-3">
              {/* Mythic Wallet — primary */}
              <a
                href="https://wallet.mythic.sh/download"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-5 py-3.5 bg-mythic-violet hover:bg-mythic-violet-bright transition-colors"
              >
                <svg viewBox="0 0 100 100" className="w-7 h-7 flex-shrink-0" fill="none">
                  <polygon points="50,8 20,44 50,56" fill="#fff" opacity="0.9" />
                  <polygon points="50,8 80,44 50,56" fill="#fff" opacity="0.75" />
                  <polygon points="20,44 50,56 80,44 50,92" fill="#fff" opacity="0.6" />
                </svg>
                <div className="flex-1">
                  <div className="text-white font-semibold text-sm">Mythic Wallet</div>
                  <div className="text-white/60 text-xs">Built for Mythic L2 — Chrome Extension</div>
                </div>
                <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>

              {/* Phantom — secondary */}
              <a
                href="https://phantom.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-5 py-3.5 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
              >
                <span className="text-2xl flex-shrink-0">👻</span>
                <div className="flex-1">
                  <div className="text-white font-semibold text-sm">Phantom</div>
                  <div className="text-mythic-text-muted text-xs">Popular Solana wallet</div>
                </div>
                <svg className="w-4 h-4 text-mythic-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>

              {/* Solflare — secondary */}
              <a
                href="https://solflare.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 w-full px-5 py-3.5 bg-[#0F0F15] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
              >
                <span className="text-2xl flex-shrink-0">☀️</span>
                <div className="flex-1">
                  <div className="text-white font-semibold text-sm">Solflare</div>
                  <div className="text-mythic-text-muted text-xs">Solana-native wallet</div>
                </div>
                <svg className="w-4 h-4 text-mythic-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>
            </div>

            <p className="text-center text-mythic-text-muted text-[0.7rem] mt-5">
              Install any compatible wallet, then click &quot;Connect Wallet&quot; again.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
