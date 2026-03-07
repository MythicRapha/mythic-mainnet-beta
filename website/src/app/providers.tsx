'use client'

import { WalletProvider } from '@/providers/WalletProvider'
import { ProfileProvider } from '@/providers/ProfileProvider'
import ProfileSetupModal from '@/components/ProfileSetupModal'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ProfileProvider>
        {children}
        <ProfileSetupModal />
      </ProfileProvider>
    </WalletProvider>
  )
}
