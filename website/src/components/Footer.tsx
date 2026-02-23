import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-black">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-10 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-5">
              {/* Green Convergence mark from brand-assets */}
              <svg viewBox="0 0 100 100" className="w-7 h-7" fill="none">
                <polygon points="50,8 20,44 50,56" fill="#39FF14" opacity="0.9" />
                <polygon points="50,8 80,44 50,56" fill="#66FF44" opacity="0.75" />
                <polygon points="20,44 50,56 80,44 50,92" fill="#1A8A0A" opacity="0.85" />
              </svg>
              <span className="font-display font-bold text-[0.85rem] tracking-[0.15em] uppercase text-white">
                Mythic
              </span>
            </div>
            <p className="text-mythic-text text-[0.82rem] leading-relaxed max-w-[280px]">
              The AI-native Solana Layer 2. Built on Firedancer for maximum performance.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium mb-5">
              Product
            </h3>
            <ul className="space-y-3">
              <li>
                <Link href="/bridge" className="text-mythic-text hover:text-white transition-colors text-[0.82rem]">
                  Bridge
                </Link>
              </li>
              <li>
                <a href="https://wallet.mythic.sh" target="_blank" rel="noopener noreferrer" className="text-mythic-violet hover:text-mythic-violet-bright transition-colors text-[0.82rem]">
                  Mythic Wallet ↗
                </a>
              </li>
              <li>
                <a href="https://mythicswap.app" target="_blank" rel="noopener noreferrer" className="text-[#FF9500] hover:text-[#FFB347] transition-colors text-[0.82rem]">
                  MythicSwap ↗
                </a>
              </li>
              <li>
                <a href="https://mythic.money" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] hover:text-[#66EFFF] transition-colors text-[0.82rem]">
                  mythic.money ↗
                </a>
              </li>
              <li>
                <span className="text-mythic-text-muted text-[0.82rem] cursor-default">
                  Compute Market (Coming Soon)
                </span>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium mb-5">
              Community
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://x.com/Mythic_L2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-mythic-text hover:text-white transition-colors text-[0.82rem]"
                >
                  X (Twitter)
                </a>
              </li>
              <li>
                <a
                  href="https://t.me/MythicL2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-mythic-text hover:text-white transition-colors text-[0.82rem]"
                >
                  Telegram
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/MythicFoundation"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-mythic-text hover:text-white transition-colors text-[0.82rem]"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium mb-5">
              Resources
            </h3>
            <ul className="space-y-3">
              <li>
                <Link href="/docs" className="text-mythic-text hover:text-white transition-colors text-[0.82rem]">
                  Documentation
                </Link>
              </li>
              <li>
                <a href="https://explorer.mythic.sh" target="_blank" rel="noopener noreferrer" className="text-mythic-text hover:text-white transition-colors text-[0.82rem]">
                  Block Explorer
                </a>
              </li>
              <li>
                <a href="/mythic-whitepaper.pdf" target="_blank" rel="noopener noreferrer" className="text-mythic-text hover:text-white transition-colors text-[0.82rem]">
                  Whitepaper
                </a>
              </li>
              <li>
                <Link href="/docs#tokenomics" className="text-mythic-text hover:text-white transition-colors text-[0.82rem]">
                  Tokenomics
                </Link>
              </li>
              <li>
                <Link href="/docs#roadmap" className="text-mythic-text hover:text-white transition-colors text-[0.82rem]">
                  Roadmap
                </Link>
              </li>
              <li>
                <a
                  href="https://pump.fun"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#39FF14] hover:text-[#66FF44] transition-colors text-[0.82rem]"
                >
                  Buy $MYTH on PumpFun ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-mythic-text-muted">
            Built by <a href="https://mythiclabs.io" target="_blank" rel="noopener noreferrer" className="text-mythic-text hover:text-white transition-colors">Mythic Labs</a>. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="https://x.com/Mythic_L2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mythic-text-dim hover:text-white transition-colors"
              aria-label="X"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://github.com/MythicFoundation"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mythic-text-dim hover:text-white transition-colors"
              aria-label="GitHub"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>
            <a
              href="https://t.me/MythicL2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mythic-text-dim hover:text-white transition-colors"
              aria-label="Telegram"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
