import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ORACLE_URL = process.env.SUPPLY_ORACLE_URL || 'http://localhost:4002'

async function fetchOracle(path: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${ORACLE_URL}${path}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`Oracle responded ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET() {
  try {
    const [supply, stats] = await Promise.all([
      fetchOracle('/api/supply'),
      fetchOracle('/api/supply/stats'),
    ])

    return NextResponse.json(
      { supply, stats, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } },
    )
  } catch (err) {
    return NextResponse.json(
      {
        supply: null,
        stats: null,
        fetchedAt: new Date().toISOString(),
        error: 'Supply oracle unavailable',
      },
      { status: 503, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } },
    )
  }
}
