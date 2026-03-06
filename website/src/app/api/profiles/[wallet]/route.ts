import { NextRequest, NextResponse } from 'next/server'
import { getProfile, updateProfile, isUsernameTaken } from '@/lib/profiles'

function checkAuth(req: NextRequest): string | null {
  const apiKey = process.env.TASKS_API_KEY
  if (apiKey && req.headers.get('x-api-key') === apiKey) return '__admin__'
  const wallet = req.headers.get('x-wallet-address')
  if (wallet) return wallet
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params
  const profile = await getProfile(wallet)
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (profile.privacy_shield) {
    return NextResponse.json({
      profile: {
        wallet_address: profile.wallet_address,
        username: '',
        display_name: profile.wallet_address.slice(0, 4) + '...' + profile.wallet_address.slice(-4),
        bio: '',
        pfp_url: '',
        role: profile.role,
        privacy_shield: true,
        setup_completed: profile.setup_completed,
        created_at: profile.created_at,
      },
    })
  }

  return NextResponse.json({ profile })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const caller = checkAuth(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { wallet } = await params

  // Only own profile or admin
  if (caller !== '__admin__' && caller !== wallet) {
    return NextResponse.json({ error: 'Cannot update another wallet\'s profile' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const allowed = ['username', 'display_name', 'bio', 'pfp_url', 'privacy_shield', 'setup_completed'] as const
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key]
    }
    // Only admin can change role
    if (caller === '__admin__' && body.role) updates.role = body.role

    // Validate username uniqueness if changing
    if (updates.username) {
      const taken = await isUsernameTaken(updates.username as string, wallet)
      if (taken) {
        return NextResponse.json({ error: 'Username already taken', field: 'username' }, { status: 409 })
      }
    }

    const profile = await updateProfile(wallet, updates)
    if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    return NextResponse.json({ error: 'Update failed', detail: String(err) }, { status: 500 })
  }
}
