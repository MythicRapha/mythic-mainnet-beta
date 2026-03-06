'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { useWalletContext } from '@/providers/WalletProvider'

type ProfileContextType = ReturnType<typeof useProfile>

const ProfileContext = createContext<ProfileContextType | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { address } = useWalletContext()
  const profileState = useProfile(address)

  return (
    <ProfileContext.Provider value={profileState}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfileContext() {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfileContext must be used within ProfileProvider')
  return context
}
