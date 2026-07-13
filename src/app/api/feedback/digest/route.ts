import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'
import type { Feedback } from '@/types'

const DIGEST_BATCH_LIMIT = 200

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildDigestHtml(rows: Pick<Feedback, 'email' | 'message' | 'page' | 'created_at'>[]): string {
  const items = rows
    .map(
      (r) => `
        <div style="margin-bottom:20px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;">
          <p style="margin:0 0 8px;white-space:pre-wrap;font-size:14px;color:#111827;">${escapeHtml(r.message)}</p>
          <p style="margin:0;font-size:12px;color:#6b7280;">
            ${escapeHtml(r.email ?? 'unknown')} · ${escapeHtml(r.page ?? 'unknown page')} · ${new Date(r.created_at).toLocaleString('en-IN')}
          </p>
        </div>`
    )
    .join('')
  return `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
    <h2 style="color:#1B3A5C;">JobSnob — ${rows.length} new feedback ${rows.length === 1 ? 'item' : 'items'}</h2>
    ${items}
  </div>`
}

// Cron-triggered only (see vercel.json), not user-facing. Batches all
// not-yet-sent feedback rows into a single email instead of one email per
// submission — the whole point of a "digest" delivery model.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data: rows, error } = await service
    .from('feedback')
    .select('id, email, message, page, created_at')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(DIGEST_BATCH_LIMIT)

  if (error) {
    console.error('feedback digest query failed:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ sent: false, count: 0 })
  }

  const RESEND_KEY = process.env.RESEND_API_KEY
  const TO_EMAIL = process.env.FEEDBACK_EMAIL_TO
  if (!RESEND_KEY || !TO_EMAIL) {
    console.error('feedback digest: RESEND_API_KEY or FEEDBACK_EMAIL_TO not configured')
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
  }

  const resend = new Resend(RESEND_KEY)
  const { error: sendError } = await resend.emails.send({
    from: process.env.FEEDBACK_EMAIL_FROM || 'JobSnob <onboarding@resend.dev>',
    to: TO_EMAIL,
    subject: `JobSnob feedback — ${rows.length} new`,
    html: buildDigestHtml(rows),
  })

  if (sendError) {
    console.error('feedback digest email failed:', sendError)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  const ids = rows.map((r) => r.id)
  const { error: updateError } = await service.from('feedback').update({ sent_at: new Date().toISOString() }).in('id', ids)
  if (updateError) {
    // Email already went out — log loudly so this doesn't silently re-send
    // the same feedback in the next digest, but don't fail the request.
    console.error('feedback digest: failed to mark rows sent after successful email:', updateError)
  }

  return NextResponse.json({ sent: true, count: rows.length })
}
