import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { sessionToken } from '@/lib/auth/admin-session'

const COOKIE_NAME = 'admin_session'
const COOKIE_MAX_AGE = 60 * 60 * 12 // 12h
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// In-memory, per-instance limiter — no DB table backs this login endpoint,
// unlike invite/apply's RPC-based one. Weaker under serverless (resets per
// cold start, doesn't share state across instances) but still raises the
// cost of brute-forcing ADMIN_SECRET well above "unlimited free attempts".
const attempts = new Map<string, { count: number; windowStart: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > MAX_ATTEMPTS
}

// Constant-time compare — a plain !== leaks how many leading characters
// matched via response timing, letting an attacker brute-force the secret
// one character at a time instead of needing the whole thing at once.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function POST(request: NextRequest) {
  const validKey = process.env.ADMIN_SECRET
  if (!validKey) {
    return NextResponse.json({ error: 'Admin access is not configured' }, { status: 503 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  if (rateLimited(ip)) {
    const url = new URL('/admin', request.url)
    url.searchParams.set('error', '1')
    return NextResponse.redirect(url, { status: 303 })
  }

  const form = await request.formData()
  const key = String(form.get('key') ?? '')

  if (!key || !safeEqual(key, validKey)) {
    const url = new URL('/admin', request.url)
    url.searchParams.set('error', '1')
    return NextResponse.redirect(url, { status: 303 })
  }

  const response = NextResponse.redirect(new URL('/admin', request.url), { status: 303 })
  // The admin key never appears in the URL (no ?key=... to leak into
  // browser history, server access logs, or Referer headers) — this is the
  // only place it's transmitted, once, over POST, then held as an httpOnly
  // cookie the client-side JS can never read.
  response.cookies.set(COOKIE_NAME, sessionToken(validKey), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/admin',
  })
  return response
}
