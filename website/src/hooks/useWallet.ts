'use client'

import { useState, useCallback, useEffect } from 'react'
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'

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

/**
 * Detect the best available wallet provider.
 * Priority: Mythic Wallet > Phantom > Solflare
 */
function detectProvider(): { provider: WalletProvider | null; name: WalletName } {
  if (typeof window === 'undefined') return { provider: null, name: null }

  // 1. Mythic Wallet extension (injects window.mythic)
  const mythic = (window as any).mythic
  if (mythic?.isMythicWallet) {
    return { provider: mythic as WalletProvider, name: 'mythic' }
  }

  // 2. Phantom
  const solana = (window as any).solana
  if (solana?.isPhantom) {
    return { provider: solana as WalletProvider, name: 'phantom' }
  }

  // 3. Solflare
  const solflare = (window as any).solflare
  if (solflare?.isSolflare) {
    return { provider: solflare as WalletProvider, name: 'solflare' }
  }

  return { provider: null, name: null }
}

const L1_RPC = '/api/l1-rpc'
const L2_RPC = 'https://rpc.mythic.sh'

interface WalletState {
  connected: boolean
  address: string | null
  publicKey: PublicKey | null
  balance: number | null
  l2Balance: number | null
  connecting: boolean
  walletName: WalletName
  showInstallPrompt: boolean
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
    showInstallPrompt: false,
  })

  const refreshBalances = useCallback(async (pubkey: PublicKey) => {
    try {
      // L1 balance via our dedicated node proxy (avoids CORS / Connection issues with relative URL)
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
        l2Balance: l2Bal !== null ? l2Bal / LAMPORTS_PER_SOL : null,
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
        showInstallPrompt: false,
      })
      refreshBalances(pubkey)
    }
  }, [refreshBalances])

  const connect = useCallback(async () => {
    const { provider, name } = detectProvider()

    // No wallet found → show install prompt popup
    if (!provider) {
      setWallet(prev => ({ ...prev, showInstallPrompt: true }))
      return
    }

    setWallet(prev => ({ ...prev, connecting: true }))

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
        showInstallPrompt: false,
      })
      refreshBalances(publicKey)
    } catch {
      setWallet(prev => ({ ...prev, connecting: false }))
    }
  }, [refreshBalances])

  const disconnect = useCallback(async () => {
    const { provider } = detectProvider()
    if (provider) {
      try { await provider.disconnect() } catch { /* ignore */ }
    }
    setWallet({
      connected: false,
      address: null,
      publicKey: null,
      balance: null,
      l2Balance: null,
      connecting: false,
      walletName: null,
      showInstallPrompt: false,
    })
  }, [])

  const dismissInstallPrompt = useCallback(() => {
    setWallet(prev => ({ ...prev, showInstallPrompt: false }))
  }, [])

  const signAndSendTransaction = useCallback(async (tx: Transaction): Promise<{ signature: string }> => {
    const { provider } = detectProvider()
    if (!provider) throw new Error('Wallet not connected')
    const { signature } = await provider.signAndSendTransaction(tx)
    return { signature }
  }, [])

  const signTransaction = useCallback(async (tx: Transaction): Promise<Transaction> => {
    const { provider } = detectProvider()
    if (!provider) throw new Error('Wallet not connected')
    return provider.signTransaction(tx)
  }, [])

  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`
    : null

  return {
    ...wallet,
    shortAddress,
    connect,
    disconnect,
    dismissInstallPrompt,
    signAndSendTransaction,
    signTransaction,
    refreshBalances,
  }
}
