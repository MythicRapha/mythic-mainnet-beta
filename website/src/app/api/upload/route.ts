import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

// Pinata IPFS config (optional — falls back to local storage)
const PINATA_API_KEY = process.env.PINATA_API_KEY
const PINATA_SECRET = process.env.PINATA_SECRET_API_KEY
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud'

async function uploadToPinata(buffer: Buffer, filename: string): Promise<string | null> {
  if (!PINATA_API_KEY || !PINATA_SECRET) return null

  try {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(buffer)])
    formData.append('file', blob, filename)
    formData.append('pinataMetadata', JSON.stringify({ name: `mythic-pfp-${filename}` }))

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET,
      },
      body: formData,
    })

    if (!res.ok) return null
    const data = await res.json()
    return `ipfs://${data.IpfsHash}`
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use PNG, JPG, GIF, WebP, or SVG.' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const filename = `${hash}.${ext}`

    // Try IPFS first
    const ipfsUri = await uploadToPinata(buffer, filename)
    if (ipfsUri) {
      // Return both IPFS URI (for on-chain) and gateway URL (for display)
      const cid = ipfsUri.replace('ipfs://', '')
      return NextResponse.json({
        uri: ipfsUri,
        url: `${PINATA_GATEWAY}/ipfs/${cid}`,
        cid,
      })
    }

    // Fallback: local storage
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, filename), buffer)

    const url = `/api/uploads/${filename}`
    return NextResponse.json({
      uri: url,
      url,
      local: true,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Upload failed', detail: String(err) }, { status: 500 })
  }
}
