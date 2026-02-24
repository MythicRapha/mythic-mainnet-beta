'use client'

import { useState, useCallback } from 'react'

interface DocSubSection {
  id: string
  title: string
}

interface DocSection {
  id: string
  title: string
  icon: string
  children?: DocSubSection[]
}

const sectionGroups: { label: string; sections: DocSection[] }[] = [
  {
    label: 'Getting Started',
    sections: [
      {
        id: 'overview',
        title: 'Introduction',
        icon: '📖',
        children: [
          { id: 'overview-what', title: 'What is Mythic?' },
          { id: 'overview-why', title: 'Why Mythic?' },
          { id: 'overview-features', title: 'Key Features' },
        ],
      },
      {
        id: 'quickstart',
        title: 'Quick Start',
        icon: '⚡',
        children: [
          { id: 'quickstart-network', title: 'Network Info' },
          { id: 'quickstart-wallet', title: 'Connect Wallet' },
        ],
      },
    ],
  },
  {
    label: 'Core Concepts',
    sections: [
      {
        id: 'architecture',
        title: 'Architecture',
        icon: '🏗️',
        children: [
          { id: 'arch-overview', title: 'System Overview' },
          { id: 'arch-sequencer', title: 'Sequencer' },
          { id: 'arch-firedancer', title: 'Firedancer Runtime' },
          { id: 'arch-settlement', title: 'L1 Settlement' },
          { id: 'arch-da', title: 'Data Availability' },
          { id: 'arch-fraud', title: 'Fraud Proofs' },
        ],
      },
      {
        id: 'tokenomics',
        title: '$MYTH Token',
        icon: '💎',
        children: [
          { id: 'token-details', title: 'Token Details' },
          { id: 'token-fees', title: 'Fee Structure' },
          { id: 'token-burn', title: 'Burn Mechanism' },
          { id: 'token-staking', title: 'Staking' },
        ],
      },
      {
        id: 'bridge',
        title: 'Bridge',
        icon: '🌉',
        children: [
          { id: 'bridge-architecture', title: 'Architecture' },
          { id: 'bridge-deposit', title: 'Deposit (L1 → L2)' },
          { id: 'bridge-withdraw', title: 'Withdraw (L2 → L1)' },
          { id: 'bridge-addresses', title: 'Bridge Addresses' },
          { id: 'bridge-parameters', title: 'Parameters' },
          { id: 'bridge-how-to', title: 'How to Bridge' },
          { id: 'bridge-security', title: 'Security' },
          { id: 'bridge-fees', title: 'Fee Structure' },
        ],
      },
    ],
  },
  {
    label: 'AI & Compute',
    sections: [
      {
        id: 'ai-precompiles',
        title: 'AI Precompiles',
        icon: '🧠',
        children: [
          { id: 'ai-inference', title: 'RunInference' },
          { id: 'ai-verify', title: 'VerifyLogits' },
          { id: 'ai-register', title: 'RegisterModel' },
          { id: 'ai-consensus', title: 'PoUAIW Consensus' },
        ],
      },
      {
        id: 'compute-marketplace',
        title: 'Compute Marketplace',
        icon: '🖥️',
        children: [
          { id: 'compute-providers', title: 'For Providers' },
          { id: 'compute-consumers', title: 'For Consumers' },
          { id: 'compute-pricing', title: 'Pricing' },
        ],
      },
    ],
  },
  {
    label: 'Ecosystem',
    sections: [
      {
        id: 'mythicswap',
        title: 'MythicSwap',
        icon: '🔄',
        children: [
          { id: 'swap-overview', title: 'Overview — Coming Soon' },
        ],
      },
      {
        id: 'launchpad',
        title: 'mythic.money',
        icon: '🚀',
        children: [
          { id: 'pad-overview', title: 'Overview — Coming Soon' },
        ],
      },
    ],
  },
  {
    label: 'Network',
    sections: [
      {
        id: 'validators',
        title: 'Validators',
        icon: '🔐',
        children: [
          { id: 'val-requirements', title: 'Requirements' },
          { id: 'val-setup', title: 'Setup Guide' },
          { id: 'val-rewards', title: 'Rewards' },
        ],
      },
      {
        id: 'security',
        title: 'Security',
        icon: '🛡️',
      },
    ],
  },
  {
    label: 'Reference',
    sections: [
      {
        id: 'roadmap',
        title: 'Roadmap',
        icon: '🗺️',
      },
      {
        id: 'faq',
        title: 'FAQ',
        icon: '❓',
      },
      {
        id: 'links',
        title: 'Links & Resources',
        icon: '🔗',
      },
    ],
  },
]

interface DocsSidebarProps {
  activeSection: string
  onSectionClick: (id: string) => void
}

export default function DocsSidebar({ activeSection, onSectionClick }: DocsSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
  })

  const toggleExpand = useCallback((id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const isChildActive = useCallback(
    (section: DocSection) => {
      if (activeSection === section.id) return true
      return section.children?.some((c) => activeSection === c.id) ?? false
    },
    [activeSection]
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed bottom-4 right-4 z-40 w-11 h-11 bg-mythic-violet text-white shadow-lg shadow-mythic-violet/20 flex items-center justify-center hover:bg-mythic-violet-bright transition-colors rounded-md"
        aria-label="Toggle docs navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {mobileOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          docs-sidebar
          fixed lg:sticky top-16 z-30 lg:z-auto
          w-72 h-[calc(100vh-4rem)] overflow-y-auto
          bg-[#08080C] lg:bg-[#08080C]/50
          border-r border-white/[0.06]
          transition-transform duration-300 lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          pt-5 pb-8
        `}
      >
        {/* Search box */}
        <div className="px-4 mb-5">
          <div className="flex items-center gap-2.5 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded text-[0.8rem] text-mythic-text-muted cursor-pointer hover:border-white/[0.12] transition-colors">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Search docs...</span>
            <span className="ml-auto text-[0.6rem] font-mono bg-white/[0.06] px-1.5 py-0.5 rounded text-mythic-text-muted">⌘K</span>
          </div>
        </div>

        <nav className="px-2">
          {sectionGroups.map((group, gi) => (
            <div key={gi} className="mb-4">
              <div className="font-mono text-[0.55rem] tracking-[0.18em] uppercase text-mythic-text-muted font-medium px-3 mb-2">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.sections.map((section) => {
                  const hasChildren = section.children && section.children.length > 0
                  const expanded = expandedSections[section.id] || isChildActive(section)
                  const isActive = activeSection === section.id

                  return (
                    <div key={section.id}>
                      <button
                        onClick={() => {
                          if (hasChildren) {
                            toggleExpand(section.id)
                          }
                          onSectionClick(section.id)
                          setMobileOpen(false)
                        }}
                        className={`
                          w-full text-left px-3 py-[7px] text-[0.8rem] transition-all duration-150 rounded-[3px] flex items-center gap-2.5 group
                          ${isActive && !hasChildren
                            ? 'text-white bg-mythic-violet/10 border-l-2 border-mythic-violet pl-[10px]'
                            : isChildActive(section)
                            ? 'text-white'
                            : 'text-mythic-text-dim hover:text-white hover:bg-white/[0.03]'
                          }
                        `}
                      >
                        <span className="text-[0.75rem] w-5 text-center flex-shrink-0">{section.icon}</span>
                        <span className="flex-1">{section.title}</span>
                        {hasChildren && (
                          <svg
                            className={`w-3 h-3 text-mythic-text-muted transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </button>

                      {/* Sub-items */}
                      {hasChildren && expanded && (
                        <div className="ml-[30px] border-l border-white/[0.06] space-y-0.5 py-1">
                          {section.children!.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => {
                                onSectionClick(child.id)
                                setMobileOpen(false)
                              }}
                              className={`
                                w-full text-left pl-3 pr-3 py-[5px] text-[0.76rem] transition-all duration-150 rounded-r-[3px]
                                ${activeSection === child.id
                                  ? 'text-mythic-violet border-l-2 border-mythic-violet bg-mythic-violet/5 -ml-[1px]'
                                  : 'text-mythic-text-muted hover:text-white hover:bg-white/[0.02]'
                                }
                              `}
                            >
                              {child.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom links */}
        <div className="mt-6 pt-4 mx-4 border-t border-white/[0.06]">
          <a
            href="https://mythiclabs.io"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 text-[0.76rem] text-mythic-text-muted hover:text-white transition-colors rounded"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Developer Docs →
          </a>
          <a
            href="https://github.com/MythicL2"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 text-[0.76rem] text-mythic-text-muted hover:text-white transition-colors rounded"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </aside>
    </>
  )
}
