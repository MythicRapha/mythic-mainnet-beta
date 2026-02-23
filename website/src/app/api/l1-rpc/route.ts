import { NextRequest, NextResponse } from 'next/server'

const L1_RPC_URL = 'http://20.81.176.84:8899'

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
