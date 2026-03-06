import { NextRequest, NextResponse } from 'next/server'

const L2_RPC_URL = process.env.L2_RPC_URL || 'https://rpc.mythic.sh'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const res = await fetch(L2_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'L2 RPC proxy error' }, id: null },
      { status: 502 }
    )
  }
}
