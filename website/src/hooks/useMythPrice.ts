'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface MythPrice {
  /** USD price per MYTH */
  priceUsd: number
  /** SOL price per MYTH (how many SOL for 1 MYTH) */
  priceSOL: number
  /** Price of SOL in USD (for conversions) */
  solPriceUsd: number
  /** 24h % change */
  change24h: number
  /** 24h volume in USD */
  volume24h: number
  /** Total liquidity in USD */
  liquidity: number
  /** Which source provided this price */
  source: 'pumpswap-rpc' | 'jupiter' | 'dexscreener'
  /** Confidence: 'high' if from on-chain, 'medium' if from API */
  confidence: 'high' | 'medium' | 'low'
  /** Timestamp of last successful fetch */
  lastUpdated: number
}

const MYTH_MINT = '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'
const SOL_MINT = 'So11111111111111111111111111111111111111112'

// Jupiter Price API v2 — aggregates all on-chain AMM/CLMM pools
const JUPITER_PRICE_USD_URL = `https://api.jup.ag/price/v2?ids=${MYTH_MINT},${SOL_MINT}`

// DexScreener as final fallback
const DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${MYTH_MINT}`

// Helius RPC for direct pool reading
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY || ''}`

// PumpSwap AMM Program ID
const PUMPSWAP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'

/**
 * Base58 encoding for pubkey bytes
 */
function encodeBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let num = BigInt(0)
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte)
  }
  let encoded = ''
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58))
    num = num / BigInt(58)
    encoded = ALPHABET[remainder] + encoded
  }
  for (const byte of bytes) {
    if (byte === 0) encoded = '1' + encoded
    else break
  }
  return encoded || '1'
}

/** Helper: call Solana RPC */
async function rpc(method: string, params: unknown[]) {
  const res = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json()
}

/**
 * Read the MYTH/SOL price directly from PumpSwap pool reserves via RPC.
 * PumpSwap Pool layout (after 8-byte Anchor discriminator):
 *   offset  0: pool_bump (1)
 *   offset  1: index (2, u16 LE)
 *   offset  3: creator (32)
 *   offset 35: base_mint (32)
 *   offset 67: quote_mint (32)
 *   offset 99: lp_mint (32)
 *   offset 131: pool_base_token_account (32)
 *   offset 163: pool_quote_token_account (32)
 *   offset 195: lp_supply (8)
 *   offset 203: coin_creator (32)
 */
async function fetchPriceFromPumpSwapRPC(): Promise<{
  priceSOL: number
  mythReserve: number
  solReserve: number
  poolAddress: string
} | null> {
  try {
    // Find largest MYTH token accounts — the PumpSwap pool vault will be among them
    const data = await rpc('getTokenLargestAccounts', [MYTH_MINT])
    const accounts = data?.result?.value || []
    if (accounts.length < 2) return null

    // Check top 8 accounts for a PumpSwap-owned vault
    for (const acc of accounts.slice(0, 8)) {
      const tokenAccountAddr = acc.address

      // Get the token account's owner (the PDA that owns this vault)
      const accData = await rpc('getAccountInfo', [tokenAccountAddr, { encoding: 'jsonParsed' }])
      const parsed = accData?.result?.value?.data?.parsed?.info
      if (!parsed?.owner) continue

      const ownerPDA = parsed.owner

      // Check if this PDA is owned by the PumpSwap program
      const ownerData = await rpc('getAccountInfo', [ownerPDA, { encoding: 'base64' }])
      const ownerInfo = ownerData?.result?.value
      if (!ownerInfo || ownerInfo.owner !== PUMPSWAP_AMM) continue

      // This is a PumpSwap Pool account. Read the vault addresses from pool data.
      const poolBuf = Buffer.from(ownerInfo.data[0], 'base64')
      if (poolBuf.length < 235) continue

      // Skip 8-byte discriminator, then read pool fields
      const baseVault = encodeBase58(poolBuf.subarray(8 + 131, 8 + 163))
      const quoteVault = encodeBase58(poolBuf.subarray(8 + 163, 8 + 195))

      // Read both vault balances in parallel
      const [baseRes, quoteRes] = await Promise.all([
        rpc('getTokenAccountBalance', [baseVault]),
        rpc('getTokenAccountBalance', [quoteVault]),
      ])

      const baseAmount = parseFloat(baseRes?.result?.value?.uiAmountString || '0')
      const quoteAmount = parseFloat(quoteRes?.result?.value?.uiAmountString || '0')

      if (baseAmount <= 0 || quoteAmount <= 0) continue

      // Determine which side is MYTH and which is SOL
      const baseMintRes = await rpc('getAccountInfo', [baseVault, { encoding: 'jsonParsed' }])
      const baseMint = baseMintRes?.result?.value?.data?.parsed?.info?.mint || ''

      let mythReserve: number, solReserve: number
      if (baseMint === MYTH_MINT) {
        mythReserve = baseAmount
        solReserve = quoteAmount
      } else {
        mythReserve = quoteAmount
        solReserve = baseAmount
      }

      // MYTH price in SOL = SOL_reserve / MYTH_reserve
      const priceSOL = solReserve / mythReserve

      return { priceSOL, mythReserve, solReserve, poolAddress: ownerPDA }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Fetch MYTH price from Jupiter Price API v2.
 */
async function fetchPriceFromJupiter(): Promise<{
  priceSOL: number
  priceUsd: number
  solPriceUsd: number
} | null> {
  try {
    const res = await fetch(JUPITER_PRICE_USD_URL)
    if (!res.ok) return null
    const data = await res.json()

    const mythData = data?.data?.[MYTH_MINT]
    const solData = data?.data?.[SOL_MINT]

    if (!mythData?.price) return null

    const priceUsd = parseFloat(mythData.price)
    const solPriceUsd = solData?.price ? parseFloat(solData.price) : 0
    const priceSOL = solPriceUsd > 0 ? priceUsd / solPriceUsd : 0

    return { priceSOL, priceUsd, solPriceUsd }
  } catch {
    return null
  }
}

/**
 * Fetch MYTH price from DexScreener (API fallback)
 */
async function fetchPriceFromDexScreener(): Promise<{
  priceSOL: number
  priceUsd: number
  change24h: number
  volume24h: number
  liquidity: number
} | null> {
  try {
    const res = await fetch(DEXSCREENER_URL)
    if (!res.ok) return null
    const data = await res.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pairs = data.pairs as any[] || []
    if (pairs.length === 0) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const solPair = pairs.find((p: any) =>
      p.quoteToken?.symbol === 'SOL' || p.quoteToken?.symbol === 'WSOL'
    )
    const bestPair = solPair || pairs[0]

    return {
      priceSOL: parseFloat(bestPair.priceNative || '0'),
      priceUsd: parseFloat(bestPair.priceUsd || '0'),
      change24h: bestPair.priceChange?.h24 || 0,
      volume24h: bestPair.volume?.h24 || 0,
      liquidity: bestPair.liquidity?.usd || 0,
    }
  } catch {
    return null
  }
}

/**
 * Fetches MYTH/SOL price using a layered approach:
 *   1. PumpSwap pool reserves via RPC — PRIMARY (most accurate, on-chain)
 *   2. Jupiter Price API — FAST FALLBACK (aggregated)
 *   3. DexScreener API — FINAL FALLBACK
 *
 * PumpSwap RPC reads every 30s, Jupiter/DexScreener every 10s.
 */
export function useMythPrice() {
  const [price, setPrice] = useState<MythPrice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const poolCacheRef = useRef<{ priceSOL: number; ts: number } | null>(null)

  const fetchPrice = useCallback(async () => {
    try {
      // Get SOL/USD price from Jupiter first (needed for all sources)
      let solPriceUsd = 0
      try {
        const solRes = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`)
        const solData = await solRes.json()
        solPriceUsd = parseFloat(solData?.data?.[SOL_MINT]?.price || '0')
      } catch { /* use 0 */ }

      // Get DexScreener metadata (volume, liquidity, change) in parallel
      const dexPromise = fetchPriceFromDexScreener().catch(() => null)

      // ── 1. PumpSwap RPC (primary — direct on-chain pool read) ─────
      const now = Date.now()
      const cache = poolCacheRef.current
      if (!cache || now - cache.ts > 30_000) {
        const pool = await fetchPriceFromPumpSwapRPC()
        if (pool && pool.priceSOL > 0) {
          poolCacheRef.current = { priceSOL: pool.priceSOL, ts: Date.now() }
          const priceUsd = pool.priceSOL * solPriceUsd
          const dex = await dexPromise

          setPrice({
            priceUsd,
            priceSOL: pool.priceSOL,
            solPriceUsd,
            change24h: dex?.change24h || 0,
            volume24h: dex?.volume24h || 0,
            liquidity: dex?.liquidity || 0,
            source: 'pumpswap-rpc',
            confidence: 'high',
            lastUpdated: Date.now(),
          })
          setError(null)
          setLoading(false)
          return
        }
      } else if (cache) {
        // Use cached PumpSwap price if fresh enough
        const priceUsd = cache.priceSOL * solPriceUsd
        const dex = await dexPromise

        setPrice(prev => ({
          priceUsd,
          priceSOL: cache.priceSOL,
          solPriceUsd,
          change24h: dex?.change24h || prev?.change24h || 0,
          volume24h: dex?.volume24h || prev?.volume24h || 0,
          liquidity: dex?.liquidity || prev?.liquidity || 0,
          source: 'pumpswap-rpc',
          confidence: 'high',
          lastUpdated: Date.now(),
        }))
        setError(null)
        setLoading(false)
        return
      }

      // ── 2. Jupiter (fast API fallback) ────────────────────────────
      const jupiter = await fetchPriceFromJupiter()
      if (jupiter && jupiter.priceUsd > 0) {
        const dex = await dexPromise

        setPrice({
          priceUsd: jupiter.priceUsd,
          priceSOL: jupiter.priceSOL,
          solPriceUsd: jupiter.solPriceUsd,
          change24h: dex?.change24h || 0,
          volume24h: dex?.volume24h || 0,
          liquidity: dex?.liquidity || 0,
          source: 'jupiter',
          confidence: 'high',
          lastUpdated: Date.now(),
        })
        setError(null)
        setLoading(false)
        return
      }

      // ── 3. DexScreener (fallback) ─────────────────────────────────
      const dex = await dexPromise
      if (dex && dex.priceUsd > 0) {
        setPrice({
          priceUsd: dex.priceUsd,
          priceSOL: dex.priceSOL,
          solPriceUsd,
          change24h: dex.change24h,
          volume24h: dex.volume24h,
          liquidity: dex.liquidity,
          source: 'dexscreener',
          confidence: 'medium',
          lastUpdated: Date.now(),
        })
        setError(null)
        setLoading(false)
        return
      }

      setError('No price data available')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Price fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrice()
    const interval = setInterval(fetchPrice, 10_000) // 10s refresh
    return () => clearInterval(interval)
  }, [fetchPrice])

  /** Convert a MYTH amount to SOL */
  const mythToSol = useCallback((mythAmount: number): number => {
    if (!price || price.priceSOL <= 0) return 0
    return mythAmount * price.priceSOL
  }, [price])

  /** Convert a SOL amount to MYTH */
  const solToMyth = useCallback((solAmount: number): number => {
    if (!price || price.priceSOL <= 0) return 0
    return solAmount / price.priceSOL
  }, [price])

  /** Convert a MYTH amount to USD */
  const mythToUsd = useCallback((mythAmount: number): number => {
    if (!price || price.priceUsd <= 0) return 0
    return mythAmount * price.priceUsd
  }, [price])

  return { price, loading, error, refresh: fetchPrice, mythToSol, solToMyth, mythToUsd }
}
