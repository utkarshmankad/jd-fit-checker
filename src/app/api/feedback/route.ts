import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

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

  const { data: inserted, error } = await supabase
    .from('feedback')
    .insert({
      user_id: user.id,
      email: user.email ?? null,
      message: trimmed,
      page: page?.slice(0, MAX_PAGE_CHARS) ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('feedback insert failed:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }

  // Send immediately instead of waiting for the daily digest cron. Runs via
  // after() so the response isn't held up by the email round-trip, but
  // still completes before the function is torn down (unlike a bare
  // fire-and-forget promise, which Vercel can kill mid-flight). The digest
  // cron still exists as a fallback for rows this send fails to mark sent.
  after(async () => {
    const RESEND_KEY = process.env.RESEND_API_KEY
    const TO_EMAIL = process.env.FEEDBACK_EMAIL_TO
    if (!RESEND_KEY || !TO_EMAIL) {
      console.error('feedback: RESEND_API_KEY or FEEDBACK_EMAIL_TO not configured, skipping immediate send')
      return
    }

    const resend = new Resend(RESEND_KEY)
    const { error: sendError } = await resend.emails.send({
      from: process.env.FEEDBACK_EMAIL_FROM || 'JobSnob <onboarding@resend.dev>',
      to: TO_EMAIL,
      subject: 'JobSnob feedback — new',
      html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1B3A5C;">JobSnob — new feedback</h2>
        <div style="margin-bottom:20px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;">
          <p style="margin:0 0 8px;white-space:pre-wrap;font-size:14px;color:#111827;">${escapeHtml(trimmed)}</p>
          <p style="margin:0;font-size:12px;color:#6b7280;">
            ${escapeHtml(user.email ?? 'unknown')} · ${escapeHtml(page ?? 'unknown page')} · ${new Date().toLocaleString('en-IN')}
          </p>
        </div>
      </div>`,
    })

    if (sendError) {
      console.error('feedback immediate email failed (will be picked up by digest fallback):', sendError)
      return
    }

    const { error: updateError } = await supabase.from('feedback').update({ sent_at: new Date().toISOString() }).eq('id', inserted.id)
    if (updateError) {
      console.error('feedback: failed to mark row sent after successful immediate email:', updateError)
    }
  })

  return NextResponse.json({ success: true })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
