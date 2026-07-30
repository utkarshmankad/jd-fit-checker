// Reproduces the "feedback link not working" bug: POST /api/feedback as a
// real authenticated user and check it actually returns success instead of
// 500ing on the RLS insert, same class of bug as the profile RLS issue.
//
// Usage:
//   npx tsx scripts/dev-feedback-test.ts

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import WebSocket from 'ws'

;(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'))
} catch {
  console.warn('No .env.local found — relying on already-exported env vars.')
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const APP_URL = process.env.DEV_SIGNUP_APP_URL ?? 'http://localhost:3000'

const DEV_REF = 'avbufhugdkjmsypaifjx'
const PROD_REF = 'jbyowtffnhdvjnhzwest'

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local — need URL, anon key, service role key.')
  process.exit(1)
}
if (SUPABASE_URL.includes(PROD_REF)) {
  console.error('Refusing to run — .env.local points at PROD. This is a dev-only test.')
  process.exit(1)
}
if (!SUPABASE_URL.includes(DEV_REF)) {
  console.warn(`Warning: SUPABASE_URL doesn't match known dev ref (${DEV_REF}) — proceeding since .env.local is the configured source of truth.`)
}

const email = `dev-feedback-${randomUUID().slice(0, 8)}@test.com`
const initialPassword = `FeedbackInit-${randomUUID()}!`

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

function projectRef(url: string): string {
  return new URL(url).hostname.split('.')[0]
}
function buildAuthCookie(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; token_type?: string; user: unknown }) {
  const ref = projectRef(SUPABASE_URL)
  const name = `sb-${ref}-auth-token`
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64')
  return { name, value }
}

async function main() {
  console.log(`=== feedback insert test: ${email} ===\n`)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: initialPassword, email_confirm: true })
  if (createErr || !created.user) throw new Error(`signup failed: ${createErr?.message}`)
  const userId = created.user.id
  console.log(`1. created user ${userId}`)

  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY)
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: initialPassword })
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`)
    console.log('2. signed in, session acquired')

    const cookie = buildAuthCookie(signIn.session)
    const cookieHeader = `${cookie.name}=${cookie.value}`

    const res = await fetch(`${APP_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ message: 'dev-feedback-test: does this insert actually work', page: '/dashboard' }),
    })
    const text = await res.text()
    console.log(`3. POST /api/feedback -> status ${res.status}, body: ${text}`)

    if (!res.ok) {
      console.error('\nFAIL — feedback submission did not succeed.')
      process.exitCode = 1
      return
    }

    const { count } = await admin.from('feedback').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    console.log(`4. rows in feedback table for this user: ${count}`)
    if (!count) {
      console.error('\nFAIL — API returned ok but no row was actually persisted.')
      process.exitCode = 1
      return
    }

    console.log('\nPASS — feedback insert succeeds and row is persisted.')
  } finally {
    await admin.auth.admin.deleteUser(userId)
    console.log(`\ncleaned up user ${userId} (feedback row cascades via FK)`)
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
