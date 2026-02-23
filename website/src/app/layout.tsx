import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { WalletProvider } from '@/providers/WalletProvider'

export const metadata: Metadata = {
  title: 'Mythic — The AI-Native Blockchain',
  description: 'Mythic is a Solana SVM Layer 2 built on Firedancer. AI consensus, decentralized compute, 1M+ TPS.',
  keywords: ['Mythic', 'Solana', 'Layer 2', 'L2', 'AI', 'Blockchain', 'Firedancer', 'SVM', 'MYTH'],
  openGraph: {
    title: 'Mythic — The AI-Native Blockchain',
    description: 'Solana SVM Layer 2 built on Firedancer. AI consensus, decentralized compute, 1M+ TPS.',
    siteName: 'Mythic',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mythic — The AI-Native Blockchain',
    description: 'Solana SVM Layer 2 built on Firedancer. AI consensus, decentralized compute, 1M+ TPS.',
    creator: '@MythicL2',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-mythic-bg text-white antialiased">
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
