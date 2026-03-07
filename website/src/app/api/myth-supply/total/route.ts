import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const res = await fetch('http://127.0.0.1:4002/supply', { next: { revalidate: 0 } })
    const text = await res.text()
    return new NextResponse(text.trim(), {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache, max-age=30' },
    })
  } catch {
    return new NextResponse('999924020', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
