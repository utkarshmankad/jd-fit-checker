import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import crypto from 'crypto'

const EXPIRY_DAYS = 30

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { batch_id?: string }
  const { batch_id } = body
  if (!batch_id) return NextResponse.json({ error: 'batch_id required' }, { status: 400 })

  const { data: results, error } = await supabase
    .from('screening_results')
    .select('*')
    .eq('batch_id', batch_id)
    .eq('user_id', user.id)

  if (error || !results?.length) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  // 6 random bytes → 8 URL-safe base64 chars (no padding)
  const slug = crypto.randomBytes(6).toString('base64url')
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const service = createServiceClient()
  const { error: insertError } = await service.from('shared_reports').insert({
    user_id: user.id,
    batch_id,
    slug,
    results_snapshot: results,
    expires_at: expiresAt,
  })

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return NextResponse.json({ slug, url: `${appUrl}/report/${slug}` })
}
