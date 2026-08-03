import { NextRequest, NextResponse } from 'next/server'
import Razorpay from 'razorpay'
import type { SupabaseClient } from '@supabase/supabase-js'
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
    const notes = event.payload.payment?.entity?.notes
    await updateTierByNotes(service, notes, 'paid')
  }

  if (event.event === 'subscription.cancelled') {
    const notes = event.payload.subscription?.entity?.notes
    await updateTierByNotes(service, notes, 'free')
  }

  return NextResponse.json({ received: true })
}

// user_id (set in payment/create-order's order.notes) is the authoritative
// match — emails aren't guaranteed unique/immutable on profiles, so a user
// who changed their email after creating the order would silently no-op
// on an email-only match. Fall back to email only if user_id is absent.
async function updateTierByNotes(
  service: SupabaseClient,
  notes: Record<string, string> | undefined,
  tier: 'paid' | 'free'
) {
  const userId = notes?.user_id
  const email = notes?.user_email

  if (userId) {
    const { data, error } = await service.from('profiles').update({ tier }).eq('id', userId).select('id')
    if (error) {
      console.error(`razorpay webhook: tier update by user_id failed:`, error)
    } else if (!data || data.length === 0) {
      console.error(`razorpay webhook: tier update by user_id matched no profile (user_id=${userId})`)
    }
    return
  }
  if (email) {
    const { data, error } = await service.from('profiles').update({ tier }).eq('email', email).select('id')
    if (error) {
      console.error(`razorpay webhook: tier update by email fallback failed:`, error)
    } else if (!data || data.length === 0) {
      console.error(`razorpay webhook: tier update by email fallback matched no profile (email=${email})`)
    }
    return
  }
  console.error('razorpay webhook: notes missing both user_id and user_email, cannot update tier')
}
