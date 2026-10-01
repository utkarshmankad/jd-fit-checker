import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const validateWebhookSignature = vi.fn()
vi.mock('razorpay', () => ({
  default: { validateWebhookSignature },
}))

const updateSelect = vi.fn()
const updateEq = vi.fn(() => ({ select: updateSelect }))
const updateMock = vi.fn(() => ({ eq: updateEq }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({ update: updateMock })),
  })),
}))

const WEBHOOK_SECRET = 'webhook-secret'
const USER_ID = 'user-123'

function makeRequest(payload: unknown, signature = 'sig') {
  return new NextRequest('http://localhost/api/webhook/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': signature },
    body: JSON.stringify(payload),
  })
}

describe('POST /api/webhook/razorpay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
    updateSelect.mockResolvedValue({ data: [{ id: USER_ID }], error: null })
  })

  it('rejects requests with an invalid HMAC signature', async () => {
    validateWebhookSignature.mockReturnValue(false)
    const { POST } = await import('../route')
    const res = await POST(makeRequest({ event: 'payment.captured', payload: {} }))

    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('accepts a valid signature and marks the user paid', async () => {
    validateWebhookSignature.mockReturnValue(true)
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest({
        event: 'payment.captured',
        payload: { payment: { entity: { notes: { user_id: USER_ID } } } },
      })
    )

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ tier: 'paid' })
    expect(updateEq).toHaveBeenCalledWith('id', USER_ID)
  })

  it('processes a duplicate/replayed event idempotently, not twice-with-side-effects', async () => {
    validateWebhookSignature.mockReturnValue(true)
    const { POST } = await import('../route')
    const event = {
      event: 'payment.captured',
      payload: { payment: { entity: { notes: { user_id: USER_ID } } } },
    }

    const first = await POST(makeRequest(event))
    const second = await POST(makeRequest(event))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(updateMock).toHaveBeenCalledTimes(2)
    // Same deterministic target state both times — replay causes no extra
    // or divergent effect beyond re-asserting tier: 'paid' for the same user.
    expect(updateMock).toHaveBeenNthCalledWith(1, { tier: 'paid' })
    expect(updateMock).toHaveBeenNthCalledWith(2, { tier: 'paid' })
  })

  it('ignores unknown event types without touching profiles', async () => {
    validateWebhookSignature.mockReturnValue(true)
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest({
        event: 'order.paid',
        payload: {},
      })
    )

    expect(res.status).toBe(200)
    expect(updateMock).not.toHaveBeenCalled()
  })
})
