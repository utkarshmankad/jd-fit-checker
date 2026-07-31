import { NextResponse } from 'next/server'
import Razorpay from 'razorpay'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const PRICE_PAISE = 49900 // ₹499

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })

  const order = await razorpay.orders.create({
    amount: PRICE_PAISE,
    currency: 'INR',
    notes: {
      user_id: user.id,
      user_email: user.email ?? '',
    },
  })

  // Record which order belongs to this user so /payment/verify can confirm
  // ownership later — signature validity alone doesn't prove the order_id
  // being verified was actually issued to this session. Service-role write:
  // the request-scoped client's profiles RLS policy isn't actually in
  // effect against the live database, so this update would silently affect
  // 0 rows otherwise (same bug class as the feedback insert fix).
  const service = createServiceClient()
  await service.from('profiles').update({ pending_order_id: order.id }).eq('id', user.id)

  return NextResponse.json({
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    key_id: process.env.RAZORPAY_KEY_ID!,
  })
}
