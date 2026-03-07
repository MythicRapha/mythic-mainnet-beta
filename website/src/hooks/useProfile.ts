'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Profile } from '@/lib/profiles'
import { isDomainRegistered } from '@/lib/myth-names-sdk'

function getWalletAddress(): string | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  if (w.mythic?.isMythicWallet && w.mythic.publicKey) return w.mythic.publicKey.toBase58()
  if (w.solana?.isPhantom && w.solana.publicKey) return w.solana.publicKey.toBase58()
  if (w.solflare?.isSolflare && w.solflare.publicKey) return w.solflare.publicKey.toBase58()
  return null
}

function walletHeader(): Record<string, string> {
  const addr = getWalletAddress()
  return addr ? { 'x-wallet-address': addr } : {}
}

export function useProfile(walletAddress: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  // Fetch profile when wallet connects
  useEffect(() => {
    if (!walletAddress) {
      setProfile(null)
      setNeedsSetup(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/profiles?wallet=${walletAddress}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.profile && data.profile.setup_completed) {
          setProfile(data.profile)
          setNeedsSetup(false)
        } else {
          setProfile(data.profile || null)
          setNeedsSetup(true)
        }
      })
      .catch(() => {
        if (!cancelled) setNeedsSetup(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [walletAddress])

  const checkUsername = useCallback(async (username: string): Promise<boolean> => {
    if (!username || username.length < 2) return false
    try {
      // Check both API (in-memory) and on-chain
      const [apiRes, onChain] = await Promise.all([
        fetch(`/api/profiles?check_username=${encodeURIComponent(username)}&wallet=${walletAddress || ''}`).then(r => r.json()),
        isDomainRegistered(username).catch(() => false),
      ])
      return apiRes.available === true && !onChain
    } catch {
      return false
    }
  }, [walletAddress])

  const createProfile = useCallback(async (input: { username: string; display_name: string; bio: string; pfp_url: string; privacy_shield: boolean }) => {
    if (!walletAddress) return

    // 1. Register on-chain via server-side relayer (no L2 SOL needed from user)
    let onChainSuccess = false
    try {
      const domainRes = await fetch('/api/register-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': walletAddress },
        body: JSON.stringify({
          domain: input.username,
          metadata_uri: input.pfp_url || '',
          privacy_shield: input.privacy_shield,
        }),
      })
      if (domainRes.ok) {
        onChainSuccess = true
      } else {
        const errData = await domainRes.json().catch(() => ({}))
        console.warn('On-chain domain registration:', errData.error || 'failed')
      }
    } catch (err: any) {
      console.warn('On-chain registration failed (continuing with off-chain):', err?.message)
    }

    // 2. Save to server (in-memory / Supabase)
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...walletHeader() },
      body: JSON.stringify({
        wallet_address: walletAddress,
        ...input,
        setup_completed: true,
        on_chain: onChainSuccess,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }))
      throw new Error(err.error || 'Failed to create profile')
    }
    const data = await res.json()
    setProfile(data.profile)
    setNeedsSetup(false)
    return data.profile as Profile
  }, [walletAddress])

  const updateProfile = useCallback(async (updates: Partial<Pick<Profile, 'username' | 'display_name' | 'bio' | 'pfp_url' | 'privacy_shield'>>) => {
    if (!walletAddress) return
    const res = await fetch(`/api/profiles/${walletAddress}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...walletHeader() },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }))
      throw new Error(err.error || 'Failed to update profile')
    }
    const data = await res.json()
    setProfile(data.profile)
    return data.profile as Profile
  }, [walletAddress])

  const displayName = profile
    ? (profile.privacy_shield
      ? (walletAddress?.slice(0, 4) + '...' + walletAddress?.slice(-4))
      : (profile.username ? `${profile.username}.myth` : profile.display_name || walletAddress?.slice(0, 4) + '...' + walletAddress?.slice(-4)))
    : walletAddress
      ? walletAddress.slice(0, 4) + '...' + walletAddress.slice(-4)
      : null

  const pfpUrl = profile && !profile.privacy_shield ? profile.pfp_url : null

  return {
    profile,
    loading,
    needsSetup,
    displayName,
    pfpUrl,
    createProfile,
    updateProfile,
    checkUsername,
    setNeedsSetup,
  }
}
