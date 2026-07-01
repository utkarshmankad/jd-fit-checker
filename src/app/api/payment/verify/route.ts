import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    razorpay_payment_id: string
    razorpay_order_id: string
    razorpay_signature: string
  }

  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = body

  const { data: profile } = await supabase
    .from('profiles')
    .select('pending_order_id')
    .eq('id', user.id)
    .single()

  if (!profile?.pending_order_id || profile.pending_order_id !== razorpay_order_id) {
    return NextResponse.json({ error: 'Order does not belong to this user' }, { status: 403 })
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex')

  if (expectedSignature !== razorpay_signature) {
    return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
  }

  const service = createServiceClient()
  await service.from('profiles').update({ tier: 'paid', pending_order_id: null }).eq('id', user.id)

  return NextResponse.json({ success: true })
}
