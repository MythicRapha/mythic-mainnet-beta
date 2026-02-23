'use client'

import { useState } from 'react'

interface DocSection {
  id: string
  title: string
}

const sections: DocSection[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'architecture', title: 'Architecture' },
  { id: 'tokenomics', title: '$MYTH Token' },
  { id: 'bridge', title: 'Bridge' },
  { id: 'ai-precompiles', title: 'AI Precompiles' },
  { id: 'compute-marketplace', title: 'Compute Marketplace' },
  { id: 'validators', title: 'Validators' },
  { id: 'roadmap', title: 'Roadmap' },
]

interface DocsSidebarProps {
  activeSection: string
  onSectionClick: (id: string) => void
}

export default function DocsSidebar({ activeSection, onSectionClick }: DocsSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-r from-mythic-purple to-mythic-cyan text-white shadow-lg flex items-center justify-center"
        aria-label="Toggle docs navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-16 z-30 lg:z-auto
          w-64 h-[calc(100vh-4rem)] overflow-y-auto
          bg-mythic-bg lg:bg-transparent
          border-r border-mythic-border/50 lg:border-0
          transition-transform duration-300 lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          pt-8 pb-8 px-4
        `}
      >
        <nav className="space-y-1">
          <div className="text-mythic-text/60 text-xs uppercase tracking-wider font-medium px-3 mb-3">
            Documentation
          </div>
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => {
                onSectionClick(section.id)
                setMobileOpen(false)
              }}
              className={`
                w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200
                ${activeSection === section.id
                  ? 'text-white bg-mythic-purple/10 border-l-2 border-mythic-purple'
                  : 'text-mythic-text hover:text-white hover:bg-mythic-card'
                }
              `}
            >
              {section.title}
            </button>
          ))}
        </nav>
      </aside>
    </>
  )
}
