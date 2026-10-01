import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const exchangeCodeForSession = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { exchangeCodeForSession },
  })),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/utils/referral', () => ({
  applyReferralCode: vi.fn(async () => {}),
}))

const USER_ID = 'user-123'

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/auth/callback?${query}`)
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          app_metadata: { provider: 'email' },
          user_metadata: { registration_completed: true },
        },
      },
      error: null,
    })
  })

  it('redirects to /auth/login when no code is present', async () => {
    const { GET } = await import('../route')
    const res = await GET(makeRequest(''))

    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
  })

  it('redirects to /dashboard for a registered user, ignoring any attacker-supplied redirect params', async () => {
    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('code=abc&next=https%3A%2F%2Fattacker.example&redirect=https%3A%2F%2Fattacker.example')
    )

    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('http://localhost')
    expect(location.pathname).toBe('/dashboard')
  })

  it('redirects to /auth/register for a user who has not completed registration', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          app_metadata: { provider: 'email' },
          user_metadata: { registration_completed: false },
        },
      },
      error: null,
    })
    const { GET } = await import('../route')
    const res = await GET(makeRequest('code=abc'))

    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/register')
  })
})
