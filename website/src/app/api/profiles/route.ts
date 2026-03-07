import { NextRequest, NextResponse } from 'next/server'
import { getProfile, createProfile, isUsernameTaken } from '@/lib/profiles'

function checkAuth(req: NextRequest): string | null {
  const apiKey = process.env.TASKS_API_KEY
  if (apiKey && req.headers.get('x-api-key') === apiKey) return '__admin__'
  const wallet = req.headers.get('x-wallet-address')
  if (wallet) return wallet
  return null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const wallet = searchParams.get('wallet')
  const checkUsername = searchParams.get('check_username')

  // Username availability check
  if (checkUsername) {
    const taken = await isUsernameTaken(checkUsername, wallet || undefined)
    return NextResponse.json({ username: checkUsername, available: !taken })
  }

  if (!wallet) return NextResponse.json({ error: 'wallet param required' }, { status: 400 })

  const profile = await getProfile(wallet)
  if (!profile) return NextResponse.json({ profile: null })

  // Respect privacy shield for public queries
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

export async function POST(req: NextRequest) {
  const caller = checkAuth(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const wallet = body.wallet_address || (caller !== '__admin__' ? caller : null)
    if (!wallet) return NextResponse.json({ error: 'wallet_address required' }, { status: 400 })

    // Only allow creating own profile (unless admin)
    if (caller !== '__admin__' && caller !== wallet) {
      return NextResponse.json({ error: 'Cannot create profile for another wallet' }, { status: 403 })
    }

    // Validate username uniqueness
    if (body.username) {
      const taken = await isUsernameTaken(body.username, wallet)
      if (taken) {
        return NextResponse.json({ error: 'Username already taken', field: 'username' }, { status: 409 })
      }
    }

    const profile = await createProfile({
      wallet_address: wallet,
      username: body.username || '',
      display_name: body.display_name || '',
      bio: body.bio || '',
      pfp_url: body.pfp_url || '',
      privacy_shield: body.privacy_shield ?? true,
      setup_completed: body.setup_completed ?? true,
      role: caller === '__admin__' ? (body.role || 'member') : 'member',
    })

    return NextResponse.json({ profile }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to create profile', detail: String(err) }, { status: 500 })
  }
}
