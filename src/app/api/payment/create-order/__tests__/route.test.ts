import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}))

const profilesUpdateEq = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: profilesUpdateEq })),
    })),
  })),
}))

const ordersCreate = vi.fn()
vi.mock('razorpay', () => ({
  default: vi.fn().mockImplementation(function RazorpayMock(this: { orders: unknown }) {
    this.orders = { create: ordersCreate }
  }),
}))

const USER_ID = 'user-123'
const USER_EMAIL = 'user@example.com'

describe('POST /api/payment/create-order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_KEY_ID = 'key_id'
    process.env.RAZORPAY_KEY_SECRET = 'key_secret'
    getUser.mockResolvedValue({ data: { user: { id: USER_ID, email: USER_EMAIL } } })
    ordersCreate.mockResolvedValue({ id: 'order_abc', amount: 49900, currency: 'INR' })
    profilesUpdateEq.mockResolvedValue({ data: null, error: null })
  })

  it('returns 401 for an unauthenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('../route')
    const res = await POST()

    expect(res.status).toBe(401)
    expect(ordersCreate).not.toHaveBeenCalled()
  })

  it('derives the amount from the server for a plain request with no body', async () => {
    const { POST } = await import('../route')
    const res = await POST()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.amount).toBe(49900)
    expect(ordersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 49900,
        notes: { user_id: USER_ID, user_email: USER_EMAIL },
      })
    )
  })
})
