import { NextRequest, NextResponse } from 'next/server'

const HELIUS_KEY = process.env.HELIUS_API_KEY || ''
const L1_RPC_URL = process.env.HELIUS_RPC_URL
  || process.env.L1_RPC_URL
  || (HELIUS_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}` : '')
  || 'https://api.mainnet-beta.solana.com'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const res = await fetch(L1_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'L1 RPC proxy error' }, id: null },
      { status: 502 }
    )
  }
}
