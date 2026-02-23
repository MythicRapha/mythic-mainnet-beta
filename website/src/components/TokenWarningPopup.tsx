'use client'

import { useState, useEffect } from 'react'

export default function TokenWarningPopup() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show after a short delay for better UX
    const timer = setTimeout(() => setVisible(true), 500)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm"
        onClick={() => setVisible(false)}
      />

      {/* Popup */}
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto relative w-full max-w-md border border-yellow-500/60 bg-[#0a0a0f] shadow-[0_0_40px_rgba(234,179,8,0.15)]">
          {/* Top accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-500" />

          {/* Close button */}
          <button
            onClick={() => setVisible(false)}
            className="absolute top-3 right-3 text-mythic-text-dim hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="p-6 pt-5 text-center space-y-4">
            {/* Warning icon */}
            <div className="flex justify-center">
              <div className="w-14 h-14 flex items-center justify-center border border-yellow-500/40 bg-yellow-500/10">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#EAB308" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            {/* Title */}
            <h2 className="font-display font-bold text-xl tracking-wide uppercase text-yellow-400">
              Official Notice
            </h2>

            {/* Message */}
            <div className="space-y-3 text-[0.9rem] leading-relaxed text-mythic-text">
              <p>
                <span className="text-white font-semibold">$MYTH has not launched yet.</span>
              </p>
              <p>
                Any token currently trading under the name &quot;MYTH&quot; or &quot;Mythic&quot; is{' '}
                <span className="text-red-400 font-semibold">not affiliated</span> with this project.
              </p>
              <p className="text-mythic-text-dim text-[0.8rem]">
                The official launch will be announced exclusively through our verified channels. Do not send funds to any unofficial contract address.
              </p>
            </div>

            {/* Verified channels */}
            <div className="border border-mythic-border/40 bg-white/[0.02] p-3 space-y-1">
              <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-mythic-text-dim">
                Verified Channels Only
              </p>
              <div className="flex items-center justify-center gap-4 text-[0.8rem]">
                <a href="https://x.com/Mythic_L2" target="_blank" rel="noopener noreferrer" className="text-mythic-violet hover:text-white transition-colors font-mono">
                  @Mythic_L2
                </a>
                <span className="text-mythic-border">|</span>
                <a href="https://mythic.sh" className="text-mythic-violet hover:text-white transition-colors font-mono">
                  mythic.sh
                </a>
              </div>
            </div>

            {/* Dismiss */}
            <button
              onClick={() => setVisible(false)}
              className="w-full py-2.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 font-display text-[0.75rem] font-bold tracking-[0.08em] uppercase hover:bg-yellow-500/20 transition-colors"
            >
              I Understand
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
