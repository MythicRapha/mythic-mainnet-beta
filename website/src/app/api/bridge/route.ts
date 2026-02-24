import { NextRequest, NextResponse } from 'next/server'

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:4003'
const EXPLORER_API = process.env.EXPLORER_API || 'http://localhost:4000'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const address = searchParams.get('address')

  if (action === 'history' && address) {
    try {
      // Try relayer first
      const res = await fetch(`${RELAYER_URL}/bridge/history?address=${address}`, {
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json(data)
      }
    } catch {}

    // Fallback to explorer API
    try {
      const res = await fetch(`${EXPLORER_API}/transactions?address=${address}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json(data)
      }
    } catch {}

    return NextResponse.json([])
  }

  if (action === 'stats') {
    try {
      const res = await fetch(`${RELAYER_URL}/bridge/stats`)
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json(data)
      }
    } catch {}

    return NextResponse.json({
      totalDeposits: 0,
      totalWithdrawals: 0,
      tvl: 0,
      activeBridges: 0,
      avgBridgeTime: 'N/A',
      error: 'Bridge stats unavailable',
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, amount, tokenMint, sender, recipient, l1Recipient, blockhash } = body

    if (action === 'deposit') {
      // Forward to relayer for deposit processing
      try {
        const res = await fetch(`${RELAYER_URL}/bridge/deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, tokenMint, sender, recipient, blockhash }),
        })
        if (res.ok) {
          const data = await res.json()
          return NextResponse.json(data)
        }
      } catch {}

      // Relayer unavailable — return error
      return NextResponse.json(
        { error: 'Bridge relayer is temporarily unavailable. Please try again later.' },
        { status: 503 },
      )
    }

    if (action === 'withdraw') {
      try {
        const res = await fetch(`${RELAYER_URL}/bridge/withdraw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, tokenMint, sender, l1Recipient }),
        })
        if (res.ok) {
          const data = await res.json()
          return NextResponse.json(data)
        }
      } catch {}

      return NextResponse.json(
        { error: 'Bridge relayer is temporarily unavailable. Please try again later.' },
        { status: 503 },
      )
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
