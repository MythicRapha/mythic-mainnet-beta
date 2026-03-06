import type { Metadata } from 'next'
import ProofDashboard from './ProofDashboard'

export const metadata: Metadata = {
  title: 'On-Chain Proof — Mythic L2',
  description: 'On-chain proof that Mythic L2 is real. 11 programs deployed, working bridge, DEX, and launchpad. Verify everything yourself.',
  openGraph: {
    type: 'website',
    title: 'Mythic L2 — On-Chain Proof. Verify Everything.',
    description: '11 programs deployed, working bridge, DEX, and launchpad. Verify it yourself on-chain.',
    url: 'https://mythic.sh/proof',
    siteName: 'Mythic',
    images: [{
      url: '/brand/og.svg',
      width: 1200,
      height: 630,
      alt: 'Mythic L2 — On-Chain Proof',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mythic L2 — On-Chain Proof. Verify Everything.',
    description: '11 programs deployed on L2, bridge and settlement on Solana mainnet. All infrastructure live and verified on-chain.',
    creator: '@Mythic_L2',
    images: ['/brand/og.svg'],
  },
}

export default function ProofPage() {
  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 grid-overlay opacity-20" />
      <ProofDashboard />
    </div>
  )
}
