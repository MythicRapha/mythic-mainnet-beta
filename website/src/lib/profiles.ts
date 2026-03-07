import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

export interface Profile {
  wallet_address: string
  username: string          // e.g. "mythic" (stored without .myth suffix)
  display_name: string
  bio: string
  pfp_url: string
  role: 'admin' | 'council' | 'member' | 'banned'
  privacy_shield: boolean
  setup_completed: boolean  // true only after user manually saves profile
  created_at: string
  updated_at: string
}

// Shared profile store across all Mythic sites (survives PM2 restarts)
const DATA_DIR = process.env.PROFILES_DIR || '/mnt/data/shared'
const PROFILES_FILE = process.env.PROFILES_PATH || path.join(DATA_DIR, 'profiles.json')

const profileStore = new Map<string, Profile>()

function loadProfiles() {
  profileStore.clear()
  try {
    const raw = readFileSync(PROFILES_FILE, 'utf-8')
    const arr: Profile[] = JSON.parse(raw)
    for (const p of arr) {
      profileStore.set(p.wallet_address, p)
    }
  } catch {
    // No file yet — start fresh
  }
}

function saveProfiles() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(PROFILES_FILE, JSON.stringify(Array.from(profileStore.values()), null, 2))
  } catch (err) {
    console.error('Failed to persist profiles:', err)
  }
}

// Admin wallets get role=admin but setup_completed=false so modal still shows
const ADMIN_WALLETS = new Set([
  '4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s',
  '6SrpJsrLHFAs6iPHRNYmtEHUVnXyd1Q3iSqcVp8myth',
])

export function isAdmin(wallet: string): boolean {
  return ADMIN_WALLETS.has(wallet)
}

export async function getProfile(wallet: string): Promise<Profile | null> {
  loadProfiles()
  return profileStore.get(wallet) || null
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  loadProfiles()
  const lower = username.toLowerCase().replace(/\.myth$/, '')
  for (const p of profileStore.values()) {
    if (p.username.toLowerCase() === lower) return p
  }
  return null
}

export async function isUsernameTaken(username: string, excludeWallet?: string): Promise<boolean> {
  loadProfiles()
  const lower = username.toLowerCase().replace(/\.myth$/, '')
  if (!lower) return false
  for (const p of profileStore.values()) {
    if (p.username.toLowerCase() === lower && p.wallet_address !== excludeWallet) return true
  }
  return false
}

export async function createProfile(input: Partial<Profile> & { wallet_address: string }): Promise<Profile> {
  loadProfiles()
  const now = new Date().toISOString()
  const profile: Profile = {
    wallet_address: input.wallet_address,
    username: (input.username || '').toLowerCase().replace(/\.myth$/, ''),
    display_name: input.display_name || '',
    bio: input.bio || '',
    pfp_url: input.pfp_url || '',
    role: ADMIN_WALLETS.has(input.wallet_address) ? 'admin' : (input.role || 'member'),
    privacy_shield: input.privacy_shield ?? true,
    setup_completed: input.setup_completed ?? false,
    created_at: now,
    updated_at: now,
  }
  profileStore.set(profile.wallet_address, profile)
  saveProfiles()
  return profile
}

export async function updateProfile(wallet: string, updates: Partial<Profile>): Promise<Profile | null> {
  loadProfiles()
  const existing = profileStore.get(wallet)
  if (!existing) return null
  if (updates.username !== undefined) {
    updates.username = updates.username.toLowerCase().replace(/\.myth$/, '')
  }
  const updated = { ...existing, ...updates, updated_at: new Date().toISOString() }
  profileStore.set(wallet, updated)
  saveProfiles()
  return updated
}

export async function getAllProfiles(): Promise<Profile[]> {
  loadProfiles()
  return Array.from(profileStore.values())
}

export function getPublicDisplay(profile: Profile): { name: string; pfp: string | null } {
  if (profile.privacy_shield) {
    return {
      name: profile.wallet_address.slice(0, 4) + '...' + profile.wallet_address.slice(-4),
      pfp: null,
    }
  }
  const displayUsername = profile.username ? `${profile.username}.myth` : null
  return {
    name: displayUsername || profile.display_name || profile.wallet_address.slice(0, 4) + '...' + profile.wallet_address.slice(-4),
    pfp: profile.pfp_url || null,
  }
}
