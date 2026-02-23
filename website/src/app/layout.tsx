import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { WalletProvider } from '@/providers/WalletProvider'

export const metadata: Metadata = {
  metadataBase: new URL('https://mythic.sh'),
  title: {
    default: 'Mythic | Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute. 1M+ TPS.',
    template: '%s | Mythic',
  },
  description: 'Solana SVM Layer 2 built on Firedancer with AI consensus, decentralized compute, and 1M+ TPS throughput.',
  keywords: ['Mythic', 'AI blockchain', 'Solana Layer 2', 'L2', 'Firedancer', 'SVM', 'MYTH token', 'decentralized AI', 'compute network', 'AI consensus', 'high throughput blockchain', '1M TPS'],
  authors: [{ name: 'Mythic Labs', url: 'https://mythiclabs.io' }],
  creator: 'Mythic Labs',
  publisher: 'Mythic Labs',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://mythic.sh',
    siteName: 'Mythic',
    title: 'Mythic | Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute. 1M+ TPS.',
    description: 'Solana SVM Layer 2 built on Firedancer with AI consensus, decentralized compute, and 1M+ TPS throughput.',
    images: [{
      url: '/brand/og.svg',
      width: 1200,
      height: 630,
      alt: 'Mythic | Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute. 1M+ TPS.',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mythic | Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute. 1M+ TPS.',
    description: 'Solana SVM Layer 2 built on Firedancer with AI consensus, decentralized compute, and 1M+ TPS throughput.',
    creator: '@Mythic_L2',
    images: ['/brand/og.svg'],
  },
  alternates: {
    canonical: 'https://mythic.sh',
  },
  category: 'technology',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@100;200;300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Mythic',
              description: 'Solana SVM Layer 2 built on Firedancer. AI consensus. Decentralized compute. 1M+ TPS.',
              url: 'https://mythic.sh',
              applicationCategory: 'Blockchain',
              operatingSystem: 'Web',
              creator: {
                '@type': 'Organization',
                name: 'Mythic Labs',
                url: 'https://mythiclabs.io',
              },
            }),
          }}
        />
      </head>
      <body className="min-h-screen bg-mythic-bg text-white antialiased font-sans">
        <WalletProvider>
          <Navbar />
          <main className="min-h-[calc(100vh-4rem)]">
            {children}
          </main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  )
}
