import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  // Sanitize filename (prevent path traversal)
  const safe = path.basename(filename)
  if (safe !== filename || filename.includes('..')) {
    return new NextResponse('Not found', { status: 404 })
  }

  const ext = safe.split('.').pop()?.toLowerCase() || ''
  const mime = MIME_TYPES[ext]
  if (!mime) {
    return new NextResponse('Not found', { status: 404 })
  }

  try {
    const filePath = path.join(process.cwd(), 'public', 'uploads', safe)
    const data = await readFile(filePath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
