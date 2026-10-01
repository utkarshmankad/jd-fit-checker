import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const verifyOtp = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { verifyOtp },
  })),
}))

const USER_ID = 'user-123'

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/auth/confirm?${query}`)
}

describe('GET /auth/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyOtp.mockResolvedValue({
      data: { user: { id: USER_ID, app_metadata: { provider: 'email' }, user_metadata: { registration_completed: true } } },
      error: null,
    })
  })

  it('redirects to /auth/login when token_hash or type is missing', async () => {
    const { GET } = await import('../route')
    const res = await GET(makeRequest(''))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
  })

  it('redirects to the login page with the Supabase error on a failed OTP', async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'Token has expired' } })
    const { GET } = await import('../route')
    const res = await GET(makeRequest('token_hash=abc&type=email'))

    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
    expect(location.searchParams.get('error')).toBe('Token has expired')
  })

  it('honors a safe relative next path on success', async () => {
    const { GET } = await import('../route')
    const res = await GET(makeRequest('token_hash=abc&type=email&next=%2Fsettings'))

    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('http://localhost')
    expect(location.pathname).toBe('/settings')
  })

  it('does not let an absolute-URL next param redirect off-site', async () => {
    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('token_hash=abc&type=email&next=https%3A%2F%2Fattacker.example%2Fphish')
    )

    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('http://localhost')
    expect(location.hostname).not.toBe('attacker.example')
  })

  it('does not let a protocol-relative next param redirect off-site', async () => {
    const { GET } = await import('../route')
    const res = await GET(makeRequest('token_hash=abc&type=email&next=%2F%2Fattacker.example'))

    const location = new URL(res.headers.get('location')!)
    expect(location.hostname).not.toBe('attacker.example')
  })
})
