'use client'

import { useState, useCallback } from 'react'

interface WalletState {
  connected: boolean
  address: string | null
  balance: number | null
  connecting: boolean
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    balance: null,
    connecting: false,
  })

  const connect = useCallback(async () => {
    setWallet(prev => ({ ...prev, connecting: true }))

    // Stub: simulate wallet connection delay
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Stub: generate a fake Solana address
    const fakeAddress = 'Myth' + Array.from({ length: 40 }, () =>
      '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[
        Math.floor(Math.random() * 58)
      ]
    ).join('')

    setWallet({
      connected: true,
      address: fakeAddress.slice(0, 44),
      balance: 1247.83,
      connecting: false,
    })
  }, [])

  const disconnect = useCallback(() => {
    setWallet({
      connected: false,
      address: null,
      balance: null,
      connecting: false,
    })
  }, [])

  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`
    : null

  return {
    ...wallet,
    shortAddress,
    connect,
    disconnect,
  }
}
