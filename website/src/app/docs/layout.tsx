import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Mythic developer documentation — build on Solana\'s AI-native L2. Guides for AI precompiles, Bridge SDK, RPC reference, and smart contract deployment.',
  openGraph: {
    title: 'Mythic Developer Docs',
    description: 'Build on Solana\'s AI-Native L2',
    images: [{
      url: '/brand/og-docs.png',
      width: 1200,
      height: 630,
      alt: 'Mythic Developer Docs — Build on Solana\'s AI-Native L2',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mythic Developer Docs',
    description: 'Build on Solana\'s AI-Native L2',
    images: ['/brand/og-docs.png'],
  },
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children
}
