import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_MESSAGE_CHARS = 5000
const MAX_PAGE_CHARS = 200

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { message, page } = body as { message?: string; page?: string }

  const trimmed = message?.trim() ?? ''
  if (!trimmed) {
    return NextResponse.json({ error: 'Feedback message is required' }, { status: 400 })
  }
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: 'Feedback is too long' }, { status: 400 })
  }

  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    email: user.email ?? null,
    message: trimmed,
    page: page?.slice(0, MAX_PAGE_CHARS) ?? null,
  })

  if (error) {
    console.error('feedback insert failed:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
