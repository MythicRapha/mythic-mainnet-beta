import { NextResponse } from 'next/server'

let cached: { price: number; ts: number } | null = null

export async function GET() {
  // Cache for 30s server-side
  if (cached && Date.now() - cached.ts < 30_000) {
    return NextResponse.json({ solana: { usd: cached.price } })
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { next: { revalidate: 30 } },
    )
    if (res.ok) {
      const data = await res.json()
      const price = data?.solana?.usd || 0
      if (price > 0) cached = { price, ts: Date.now() }
      return NextResponse.json(data)
    }
  } catch { /* fall through */ }

  // Return cached or zero
  return NextResponse.json({ solana: { usd: cached?.price || 0 } })
}
