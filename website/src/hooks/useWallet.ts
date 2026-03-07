'use client'

import { useState, useCallback, useEffect } from 'react'
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { LAMPORTS_PER_MYTH } from '@/lib/bridge-sdk'

/**
 * Unified wallet provider interface.
 * Works with Mythic Wallet extension, Phantom, and Solflare.
 */
interface WalletProvider {
  publicKey: PublicKey | null
  connect: () => Promise<{ publicKey: PublicKey }>
  disconnect: () => Promise<void>
  signTransaction: (tx: Transaction) => Promise<Transaction>
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>
  on: (event: string, callback: (...args: unknown[]) => void) => void
  off: (event: string, callback: (...args: unknown[]) => void) => void
}

export type WalletName = 'mythic' | 'phantom' | 'solflare' | null

function getProvider(name: WalletName): WalletProvider | null {
  if (typeof window === 'undefined' || !name) return null

  if (name === 'mythic') {
    const mythic = (window as any).mythic
    if (!mythic?.isMythicWallet) return null
    // Wrap Mythic provider to normalize PublicKey handling
    return {
      get publicKey() {
        if (!mythic.publicKey) return null
        if (typeof mythic.publicKey === 'string') {
          try { return new PublicKey(mythic.publicKey) } catch { return null }
        }
        return mythic.publicKey
      },
      async connect() {
        const result = await mythic.connect()
        const pk = typeof result.publicKey === 'string'
          ? new PublicKey(result.publicKey)
          : result.publicKey
        return { publicKey: pk }
      },
      disconnect: () => mythic.disconnect(),
      signTransaction: (tx: Transaction) => mythic.signTransaction(tx),
      signAndSendTransaction: (tx: Transaction) => mythic.signAndSendTransaction(tx),
      on: (event: string, cb: (...args: unknown[]) => void) => mythic.on(event, cb),
      off: (event: string, cb: (...args: unknown[]) => void) => mythic.off(event, cb),
    } as WalletProvider
  }
  if (name === 'phantom') {
    const solana = (window as any).solana
    return solana?.isPhantom ? (solana as WalletProvider) : null
  }
  if (name === 'solflare') {
    const solflare = (window as any).solflare
    return solflare?.isSolflare ? (solflare as WalletProvider) : null
  }
  return null
}

/**
 * Detect which wallets are available in the browser.
 */
export function detectAvailableWallets(): { mythic: boolean; phantom: boolean; solflare: boolean } {
  if (typeof window === 'undefined') return { mythic: false, phantom: false, solflare: false }
  return {
    mythic: !!(window as any).mythic?.isMythicWallet,
    phantom: !!(window as any).solana?.isPhantom,
    solflare: !!(window as any).solflare?.isSolflare,
  }
}

/**
 * Detect wallets with retry — waits for extension providers to inject.
 * Extensions inject via content scripts which may load after React hydrates.
 */
export function detectAvailableWalletsAsync(maxWaitMs = 2000): Promise<{ mythic: boolean; phantom: boolean; solflare: boolean }> {
  return new Promise((resolve) => {
    const result = detectAvailableWallets()
    // If mythic already detected, return immediately
    if (result.mythic) { resolve(result); return }

    // Listen for the mythic#initialized event from the inpage script
    const onInit = () => {
      window.removeEventListener('mythic#initialized', onInit)
      resolve(detectAvailableWallets())
    }
    window.addEventListener('mythic#initialized', onInit)

    // Also poll in case we missed the event
    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 100
      const check = detectAvailableWallets()
      if (check.mythic || elapsed >= maxWaitMs) {
        clearInterval(interval)
        window.removeEventListener('mythic#initialized', onInit)
        resolve(check)
      }
    }, 100)
  })
}

/**
 * Detect the first available wallet provider (used for auto-reconnect).
 */
function detectProvider(): { provider: WalletProvider | null; name: WalletName } {
  if (typeof window === 'undefined') return { provider: null, name: null }

  // For auto-reconnect, use getProvider which normalizes Mythic's publicKey
  const mythic = (window as any).mythic
  if (mythic?.isMythicWallet && mythic.isConnected) {
    const wrapped = getProvider('mythic')
    if (wrapped) return { provider: wrapped, name: 'mythic' }
  }

  const solana = (window as any).solana
  if (solana?.isPhantom && solana.publicKey) return { provider: solana as WalletProvider, name: 'phantom' }

  const solflare = (window as any).solflare
  if (solflare?.isSolflare && solflare.publicKey) return { provider: solflare as WalletProvider, name: 'solflare' }

  return { provider: null, name: null }
}

const L1_RPC = '/api/l1-rpc'
const L2_RPC = process.env.NEXT_PUBLIC_L2_RPC_URL || 'https://rpc.mythic.sh'

interface WalletState {
  connected: boolean
  address: string | null
  publicKey: PublicKey | null
  balance: number | null
  l2Balance: number | null
  connecting: boolean
  walletName: WalletName
  showWalletModal: boolean
  walletError: string | null
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    publicKey: null,
    balance: null,
    l2Balance: null,
    connecting: false,
    walletName: null,
    showWalletModal: false,
    walletError: null,
  })

  const refreshBalances = useCallback(async (pubkey: PublicKey) => {
    try {
      const l1Res = await fetch(L1_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getBalance',
          params: [pubkey.toBase58(), { commitment: 'confirmed' }],
        }),
      })
      const l1Data = await l1Res.json()
      const l1Balance = l1Data?.result?.value ?? 0

      let l2Bal: number | null = null
      try {
        const l2Conn = new Connection(L2_RPC, 'confirmed')
        l2Bal = await l2Conn.getBalance(pubkey)
      } catch {
        // L2 may not be reachable yet
      }

      setWallet(prev => ({
        ...prev,
        balance: l1Balance / LAMPORTS_PER_SOL,
        l2Balance: l2Bal !== null ? l2Bal / LAMPORTS_PER_MYTH : null,
      }))
    } catch {
      // silently fail on balance fetch
    }
  }, [])

  // Auto-reconnect if any supported wallet is already connected
  useEffect(() => {
    const { provider, name } = detectProvider()
    if (provider?.publicKey) {
      const pubkey = provider.publicKey
      setWallet({
        connected: true,
        address: pubkey.toBase58(),
        publicKey: pubkey,
        balance: null,
        l2Balance: null,
        connecting: false,
        walletName: name,
        showWalletModal: false,
        walletError: null,
      })
      refreshBalances(pubkey)
    }
  }, [refreshBalances])

  // Open the wallet selection modal
  const openWalletModal = useCallback(() => {
    setWallet(prev => ({ ...prev, showWalletModal: true }))
  }, [])

  const closeWalletModal = useCallback(() => {
    setWallet(prev => ({ ...prev, showWalletModal: false }))
  }, [])

  // Connect to a specific wallet by name
  const connectWallet = useCallback(async (name: WalletName) => {
    if (!name) return
    const provider = getProvider(name)
    if (!provider) return

    setWallet(prev => ({ ...prev, connecting: true, showWalletModal: false }))

    try {
      const { publicKey } = await provider.connect()
      setWallet({
        connected: true,
        address: publicKey.toBase58(),
        publicKey,
        balance: null,
        l2Balance: null,
        connecting: false,
        walletName: name,
        showWalletModal: false,
        walletError: null,
      })
      refreshBalances(publicKey)
    } catch {
      setWallet(prev => ({ ...prev, connecting: false }))
    }
  }, [refreshBalances])

  const disconnect = useCallback(async () => {
    if (wallet.walletName) {
      const provider = getProvider(wallet.walletName)
      if (provider) {
        try { await provider.disconnect() } catch { /* ignore */ }
      }
    }
    setWallet({
      connected: false,
      address: null,
      publicKey: null,
      balance: null,
      l2Balance: null,
      connecting: false,
      walletName: null,
      showWalletModal: false,
      walletError: null,
    })
  }, [wallet.walletName])

  const clearWalletError = useCallback(() => {
    setWallet(prev => ({ ...prev, walletError: null }))
  }, [])

  const isMessagePortError = (err: unknown): boolean => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      return msg.includes('message port closed') || msg.includes('message channel closed')
    }
    return String(err).toLowerCase().includes('message port closed')
  }

  const handleWalletSignError = useCallback((err: unknown) => {
    if (isMessagePortError(err)) {
      const fallback = wallet.walletName === 'mythic'
        ? 'Wallet connection lost. Try again, or use Phantom or Solflare for a more stable signing experience.'
        : 'Wallet connection lost. Please try again.'
      setWallet(prev => ({ ...prev, walletError: fallback }))
    }
  }, [wallet.walletName])

  const signAndSendTransaction = useCallback(async (tx: Transaction): Promise<{ signature: string }> => {
    const provider = wallet.walletName ? getProvider(wallet.walletName) : null
    if (!provider) throw new Error('Wallet not connected')
    setWallet(prev => ({ ...prev, walletError: null }))

    try {
      const { signature } = await provider.signAndSendTransaction(tx)
      return { signature }
    } catch (err) {
      // Retry once on message port error
      if (isMessagePortError(err)) {
        try {
          await new Promise(r => setTimeout(r, 500))
          const retryProvider = wallet.walletName ? getProvider(wallet.walletName) : null
          if (retryProvider) {
            const { signature } = await retryProvider.signAndSendTransaction(tx)
            return { signature }
          }
        } catch (retryErr) {
          handleWalletSignError(retryErr)
          throw retryErr
        }
      }
      handleWalletSignError(err)
      throw err
    }
  }, [wallet.walletName, handleWalletSignError])

  const signTransaction = useCallback(async (tx: Transaction): Promise<Transaction> => {
    const provider = wallet.walletName ? getProvider(wallet.walletName) : null
    if (!provider) throw new Error('Wallet not connected')
    setWallet(prev => ({ ...prev, walletError: null }))

    try {
      return await provider.signTransaction(tx)
    } catch (err) {
      // Retry once on message port error
      if (isMessagePortError(err)) {
        try {
          await new Promise(r => setTimeout(r, 500))
          const retryProvider = wallet.walletName ? getProvider(wallet.walletName) : null
          if (retryProvider) {
            return await retryProvider.signTransaction(tx)
          }
        } catch (retryErr) {
          handleWalletSignError(retryErr)
          throw retryErr
        }
      }
      handleWalletSignError(err)
      throw err
    }
  }, [wallet.walletName, handleWalletSignError])

  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`
    : null

  return {
    ...wallet,
    shortAddress,
    openWalletModal,
    closeWalletModal,
    connectWallet,
    disconnect,
    signAndSendTransaction,
    signTransaction,
    refreshBalances,
    clearWalletError,
  }
}
