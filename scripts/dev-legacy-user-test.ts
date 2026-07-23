// Reproduces the "old user stuck in /profile <-> /dashboard loop" bug:
// a profile that has real preferences/hard_reject_filters saved but was
// never touched after `onboarding_completed` was introduced, so that flag
// is missing from `preferences`. Unlike scripts/dev-signup.ts (which always
// sets onboarding_completed: true), this writes a profile the way a legacy
// user's actually looks — data present, flag absent — then checks whether
// /dashboard still bounces to /profile.
//
// Usage:
//   npx tsx scripts/dev-legacy-user-test.ts

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

const email = `dev-legacy-${randomUUID().slice(0, 8)}@test.com`
const initialPassword = `LegacyInit-${randomUUID()}!`
const fullName = 'Legacy User'

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
  console.log(`=== legacy-user dashboard-loop test: ${email} ===\n`)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: initialPassword, email_confirm: true })
  if (createErr || !created.user) throw new Error(`signup failed: ${createErr?.message}`)
  const userId = created.user.id
  console.log(`1. created user ${userId}`)

  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY)
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: initialPassword })
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`)
    console.log('2. signed in, session acquired')

    // Complete registration (same call /auth/register's _form.tsx makes) —
    // without this, every request gets gated at /auth/register regardless
    // of profile/onboarding state, which isn't the bug under test here.
    const password = `LegacyReg-${randomUUID()}!`
    const { error: updateErr } = await anon.auth.updateUser({
      password,
      data: { full_name: fullName, registration_completed: true },
    })
    if (updateErr) throw new Error(`register step (updateUser) failed: ${updateErr.message}`)
    console.log('2b. registration completed')

    // Write the profile directly via service role — simulating data that was
    // saved long ago, before onboarding_completed existed. Deliberately NOT
    // going through PUT /api/profile, since that always stamps
    // onboarding_completed: true on every successful save.
    const { error: upsertErr } = await admin.from('profiles').upsert({
      id: userId,
      email,
      full_name: fullName,
      preferences: { preferred_tech_stack: ['TypeScript', 'React'], target_industries: ['fintech'] },
      hard_reject_filters: { tech_stack_dealbreakers: ['PHP'], title_floor: 'Senior', geography_allowed: [], company_type_excluded: [], role_type_excluded: [] },
    }, { onConflict: 'id' })
    if (upsertErr) throw new Error(`legacy profile upsert failed: ${upsertErr.message}`)
    console.log('3. legacy profile written (preferences + dealbreakers, no onboarding_completed)')

    const cookie = buildAuthCookie(signIn.session)
    const cookieHeader = `${cookie.name}=${cookie.value}`

    const dashRes = await fetch(`${APP_URL}/dashboard`, { headers: { Cookie: cookieHeader }, redirect: 'manual' })
    const location = dashRes.headers.get('location') ?? ''
    const bouncedToProfile = dashRes.status >= 300 && dashRes.status < 400 && location.includes('/profile')
    console.log(`4. GET /dashboard -> status ${dashRes.status}${location ? `, location: ${location}` : ''}`)

    if (bouncedToProfile) {
      console.error('\nFAIL — legacy user with real profile data still bounced from /dashboard to /profile.')
      process.exitCode = 1
    } else {
      console.log('\nPASS — legacy user with existing preferences/dealbreakers reaches /dashboard without looping.')
    }
  } finally {
    await admin.auth.admin.deleteUser(userId)
    console.log(`\ncleaned up user ${userId}`)
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
