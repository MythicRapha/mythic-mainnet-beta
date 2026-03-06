import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MYTH_MINT = '5UP2iL9DefXC3yovX9b4XG2EiCnyxuVo3S2F6ik5pump'

// Server-side L1 RPCs — no CORS issues, env vars always available
const HELIUS_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY || process.env.HELIUS_API_KEY || ''
const L1_RPCS = [
  HELIUS_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}` : '',
  process.env.HELIUS_RPC_URL || '',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean)

export async function GET() {
  for (const rpcUrl of L1_RPCS) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenSupply',
          params: [MYTH_MINT],
        }),
      })
      const data = await res.json()
      const val = data?.result?.value
      if (val) {
        const supply = val.uiAmountString
          ? parseFloat(val.uiAmountString)
          : Number(val.amount) / Math.pow(10, val.decimals)
        if (supply > 0) {
          return NextResponse.json({ supply, mint: MYTH_MINT })
        }
      }
    } catch { /* try next RPC */ }
  }

  return NextResponse.json(
    { error: 'Failed to fetch supply', supply: null },
    { status: 502 }
  )
}
