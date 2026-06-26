import { NextRequest, NextResponse } from 'next/server'
import Razorpay from 'razorpay'
import { createServiceClient } from '@/lib/supabase/service'

// Razorpay webhook event shape (minimal)
interface WebhookEvent {
  event: string
  payload: {
    payment?: {
      entity: {
        notes?: Record<string, string>
      }
    }
    subscription?: {
      entity: {
        notes?: Record<string, string>
      }
    }
  }
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const rawBody = await request.text()
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET!

  let valid: boolean
  try {
    valid = Razorpay.validateWebhookSignature(rawBody, signature, webhookSecret)
  } catch {
    valid = false
  }

  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(rawBody) as WebhookEvent
  const service = createServiceClient()

  if (event.event === 'payment.captured') {
    const email = event.payload.payment?.entity?.notes?.user_email
    if (email) {
      await service.from('profiles').update({ tier: 'paid' }).eq('email', email)
    }
  }

  if (event.event === 'subscription.cancelled') {
    const email = event.payload.subscription?.entity?.notes?.user_email
    if (email) {
      await service.from('profiles').update({ tier: 'free' }).eq('email', email)
    }
  }

  return NextResponse.json({ received: true })
}
