import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}))

const profilesSelectSingle = vi.fn()
const profilesUpdateEq = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: profilesSelectSingle,
        })),
      })),
      update: vi.fn(() => ({
        eq: profilesUpdateEq,
      })),
    })),
  })),
}))

const KEY_SECRET = 'test-key-secret'
const USER_ID = 'user-123'
const ORDER_ID = 'order_abc'
const PAYMENT_ID = 'pay_xyz'

function sign(orderId: string, paymentId: string, secret = KEY_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/payment/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/payment/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    profilesSelectSingle.mockResolvedValue({ data: { pending_order_id: ORDER_ID } })
    profilesUpdateEq.mockResolvedValue({ data: null, error: null })
  })

  it('accepts a valid signature and marks the user paid', async () => {
    const { POST } = await import('../route')
    const razorpay_signature = sign(ORDER_ID, PAYMENT_ID)
    const res = await POST(
      makeRequest({
        razorpay_order_id: ORDER_ID,
        razorpay_payment_id: PAYMENT_ID,
        razorpay_signature,
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true })
    expect(profilesUpdateEq).toHaveBeenCalledWith('id', USER_ID)
  })

  it('rejects a tampered signature', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest({
        razorpay_order_id: ORDER_ID,
        razorpay_payment_id: PAYMENT_ID,
        razorpay_signature: sign(ORDER_ID, PAYMENT_ID) + 'ff',
      })
    )

    expect(res.status).toBe(400)
    expect(profilesUpdateEq).not.toHaveBeenCalled()
  })

  it('rejects when required fields are missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makeRequest({ razorpay_order_id: ORDER_ID }))

    expect(res.status).toBe(400)
    expect(profilesUpdateEq).not.toHaveBeenCalled()
  })

  it('rejects a replayed order_id that no longer matches the pending order', async () => {
    profilesSelectSingle.mockResolvedValue({ data: { pending_order_id: null } })
    const { POST } = await import('../route')
    const razorpay_signature = sign(ORDER_ID, PAYMENT_ID)
    const res = await POST(
      makeRequest({
        razorpay_order_id: ORDER_ID,
        razorpay_payment_id: PAYMENT_ID,
        razorpay_signature,
      })
    )

    expect(res.status).toBe(403)
    expect(profilesUpdateEq).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest({
        razorpay_order_id: ORDER_ID,
        razorpay_payment_id: PAYMENT_ID,
        razorpay_signature: sign(ORDER_ID, PAYMENT_ID),
      })
    )

    expect(res.status).toBe(401)
  })
})
