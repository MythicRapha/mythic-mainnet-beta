import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MYTH_MINT = '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

// Mythic L2 fees = 75% of Solana L1 fees (25% cheaper in USD)
const FEE_DISCOUNT = 0.75
// Solana standard base fee
const SOLANA_BASE_FEE_LAMPORTS = 5000
const SOLANA_BASE_FEE_SOL = SOLANA_BASE_FEE_LAMPORTS / 1e9
// Typical CU per transaction
const TYPICAL_CU = 200_000

let cache: { data: unknown; ts: number } | null = null

export async function GET() {
  if (cache && Date.now() - cache.ts < 30_000) {
    return NextResponse.json(cache.data)
  }

  try {
    const [solRes, mythRes] = await Promise.allSettled([
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
        .then(r => r.json()),
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${MYTH_MINT}`)
        .then(r => r.json()),
    ])

    const solPriceUSD = solRes.status === 'fulfilled'
      ? (solRes.value?.solana?.usd || 0) : 0

    let mythPriceUSD = 0
    if (mythRes.status === 'fulfilled') {
      const pairs = mythRes.value?.pairs || []
      const best = pairs.find((p: { quoteToken?: { symbol?: string } }) =>
        p.quoteToken?.symbol === 'SOL' || p.quoteToken?.symbol === 'WSOL'
      ) || pairs[0]
      mythPriceUSD = parseFloat(best?.priceUsd || '0')
    }

    // Solana L1 standard fee in USD (base fee only, no priority)
    const solanaFeeUSD = SOLANA_BASE_FEE_SOL * solPriceUSD

    // Target Mythic L2 fee = 75% of Solana fee in USD
    const targetFeeUSD = solanaFeeUSD * FEE_DISCOUNT

    // How many MYTH lamports to hit that target
    // targetFeeUSD = (totalLamports / 1e9) * mythPriceUSD
    // totalLamports = targetFeeUSD / mythPriceUSD * 1e9
    let recommendedPriorityMicroLamports = 0
    let totalFeeMYTH = SOLANA_BASE_FEE_LAMPORTS / 1e9 // minimum = base fee
    let totalFeeUSD = totalFeeMYTH * mythPriceUSD

    if (mythPriceUSD > 0) {
      const targetTotalLamports = (targetFeeUSD / mythPriceUSD) * 1e9
      const priorityLamports = Math.max(0, targetTotalLamports - SOLANA_BASE_FEE_LAMPORTS)
      recommendedPriorityMicroLamports = Math.round(
        (priorityLamports * 1_000_000) / TYPICAL_CU
      )
      totalFeeMYTH = targetTotalLamports / 1e9
      totalFeeUSD = targetFeeUSD
    }

    const data = {
      // Recommended priority fee for wallets (microlamports per CU)
      recommendedPriorityFee: recommendedPriorityMicroLamports,
      // Fee breakdown
      baseFee: SOLANA_BASE_FEE_LAMPORTS,
      totalFeeLamports: Math.round(totalFeeMYTH * 1e9),
      totalFeeMYTH,
      totalFeeUSD,
      // Comparison
      solanaFeeUSD,
      discount: '25%',
      // Prices
      solPriceUSD,
      mythPriceUSD,
      timestamp: Date.now(),
    }

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Fee oracle unavailable' }, { status: 502 })
  }
}
