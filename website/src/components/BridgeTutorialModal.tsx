'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

export default function BridgeTutorialModal() {
  const [open, setOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, close])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) close()
  }

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(true)}
        className="
          inline-flex items-center gap-2 px-3 py-1.5
          bg-[#39FF14]/[0.08] border border-[#39FF14]/20
          hover:bg-[#39FF14]/[0.14] hover:border-[#39FF14]/40
          transition-all duration-200 group cursor-pointer
        "
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          className="text-[#39FF14] group-hover:scale-110 transition-transform duration-200"
        >
          <circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeWidth="1" />
          <path d="M5.5 4.5L10 7L5.5 9.5V4.5Z" fill="currentColor" />
        </svg>
        <span className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-[#39FF14]">
          How it Works
        </span>
      </button>

      {/* Modal */}
      {open && (
        <div
          ref={backdropRef}
          onClick={handleBackdropClick}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="relative w-full max-w-[900px] bg-[#0a0a10] border border-white/[0.06]">
            {/* Close */}
            <button
              onClick={close}
              className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.1] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[#8888a0] hover:text-white">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            {/* Video */}
            <div className="w-full bg-black" style={{ aspectRatio: '16/9' }}>
              <video
                ref={videoRef}
                src="/launch/bridge-tutorial.mp4"
                controls
                autoPlay
                muted
                playsInline
                preload="auto"
                className="w-full h-full object-contain"
                style={{ backgroundColor: '#000' }}
                onError={() => {
                  // Fallback: try reloading the video source
                  if (videoRef.current) {
                    videoRef.current.load()
                  }
                }}
              />
            </div>

            {/* Steps */}
            <div className="p-4 grid grid-cols-3 gap-3">
              <div className="flex gap-2 p-2.5 bg-white/[0.02] border border-white/[0.04]">
                <span className="font-mono text-[0.55rem] font-bold text-[#39FF14]/50 shrink-0">01</span>
                <span className="text-[0.68rem] leading-relaxed text-[#e2e2e8]">Connect wallet, enter SOL amount</span>
              </div>
              <div className="flex gap-2 p-2.5 bg-white/[0.02] border border-white/[0.04]">
                <span className="font-mono text-[0.55rem] font-bold text-[#39FF14]/50 shrink-0">02</span>
                <span className="text-[0.68rem] leading-relaxed text-[#e2e2e8]">SOL swaps to MYTH and locks in bridge</span>
              </div>
              <div className="flex gap-2 p-2.5 bg-white/[0.02] border border-white/[0.04]">
                <span className="font-mono text-[0.55rem] font-bold text-[#39FF14]/50 shrink-0">03</span>
                <span className="text-[0.68rem] leading-relaxed text-[#e2e2e8]">Receive native MYTH on L2 instantly</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
