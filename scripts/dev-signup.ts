// Scriptable signup for the dev environment — automates what a human would
// do through /auth/login + magic link + /auth/register, without waiting on
// a real email. Bypasses email delivery via the admin API (email_confirm:
// true), exactly like scripts/test-rls.ts already does for its throwaway
// users. NOT for prod — refuses to run unless NEXT_PUBLIC_SUPABASE_URL
// points at the dev project ref.
//
// Usage:
//   npx tsx scripts/dev-signup.ts [--email=you@test.com] [--password=Something123!] [--keep]
//
// --keep leaves the user in place instead of deleting it at the end, and
// prints its email/password so you can sign in through the real /auth/login
// form manually — useful for reproducing UI-only bugs (e.g. client-side
// redirects) that a pure HTTP round trip can't catch.
//
// What it does, end to end, against a running `next dev` on localhost:3000:
//   1. admin.createUser(email, password, email_confirm: true)   — signup
//   2. signInWithPassword                                       — session
//   3. auth.updateUser({ password, full_name, registration_completed })
//      — same call /auth/register's _form.tsx makes
//   4. builds the sb-<ref>-auth-token cookie @supabase/ssr expects, so the
//      session can be replayed against the app's own HTTP routes
//   5. PUT /api/profile (isOnboarding-style payload) then GET /api/profile
//      — same calls the profile page makes on save/load
//   6. prints the resulting `preferences.onboarding_completed` value and the
//      isNewUser check from (app)/layout.tsx, so a regression is visible
//      immediately instead of requiring a manual browser walkthrough
//   7. deletes the test user unless --keep is passed

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

if (!SUPABASE_URL.includes(DEV_REF) && !SUPABASE_URL.includes(PROD_REF)) {
  console.warn(`Warning: SUPABASE_URL doesn't match either known ref (dev ${DEV_REF} / prod ${PROD_REF}) — proceeding since .env.local is the configured source of truth.`)
}

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1]
const passwordArg = args.find((a) => a.startsWith('--password='))?.split('=')[1]

// A fresh random email + password every run (unless overridden) — each
// invocation is meant to exercise a genuine first-time user, not reuse
// state from a previous test that might already have onboarding_completed
// set from an earlier run.
const email = emailArg ?? `dev-signup-${randomUUID().slice(0, 8)}@test.com`
// Two distinct passwords: real signups arrive via magic link with no
// password set yet, so /auth/register's updateUser() call is setting a
// password for the first time. createUser() here has to set *something* to
// unlock signInWithPassword, so the register-step call must use a different
// value or Supabase rejects it as "New password should be different from
// the old password" (which is a quirk of this script, not the app).
const initialPassword = `DevSignupInit-${randomUUID()}!`
const password = passwordArg ?? `DevSignup-${randomUUID()}!`
const fullName = 'Dev Signup Test'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

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
  console.log(`=== dev signup: ${email} ===\n`)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    throw new Error(`signup failed: ${createErr?.message}`)
  }
  const userId = created.user.id
  console.log(`1. created user ${userId}`)

  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY)
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: initialPassword })
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`)
    console.log('2. signed in, session acquired')

    const { error: updateErr } = await anon.auth.updateUser({
      password,
      data: { full_name: fullName, registration_completed: true },
    })
    if (updateErr) throw new Error(`register step (updateUser) failed: ${updateErr.message}`)
    console.log('3. registration completed (password set, full_name + registration_completed metadata)')

    const cookie = buildAuthCookie(signIn.session)
    const cookieHeader = `${cookie.name}=${cookie.value}`

    const putRes = await fetch(`${APP_URL}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        full_name: fullName,
        preferences: { onboarding_completed: true },
      }),
    })
    if (!putRes.ok) {
      throw new Error(`PUT /api/profile failed: ${putRes.status} ${await putRes.text()}`)
    }
    console.log('4. PUT /api/profile ok')

    const getRes = await fetch(`${APP_URL}/api/profile`, {
      headers: { Cookie: cookieHeader },
    })
    if (!getRes.ok) {
      throw new Error(`GET /api/profile failed: ${getRes.status} ${await getRes.text()}`)
    }
    const { profile } = (await getRes.json()) as { profile: { preferences?: Record<string, unknown> } }
    const onboardingCompleted = profile.preferences?.onboarding_completed
    const isNewUser = !onboardingCompleted
    console.log(`5. GET /api/profile ok — onboarding_completed=${onboardingCompleted}, isNewUser=${isNewUser}`)

    if (onboardingCompleted !== true) {
      console.error('\nFAIL — onboarding_completed did not persist; user would be stuck in the /auth/register redirect loop.')
      process.exitCode = 1
      return
    }
    console.log('5. onboarding_completed persisted via /api/profile')

    // (app)/layout.tsx reads `profiles` server-side to compute isNewUser —
    // a *separate* code path from /api/profile, and one that broke silently
    // when it used the request-scoped client against RLS that doesn't
    // actually work on the live DB. Request /dashboard directly (no
    // redirect-follow) to check the server component's own read, not just
    // the API's.
    const dashRes = await fetch(`${APP_URL}/dashboard`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    })
    const bouncedToProfile = dashRes.status >= 300 && dashRes.status < 400 &&
      (dashRes.headers.get('location') ?? '').includes('/profile')
    console.log(`6. GET /dashboard -> status ${dashRes.status}${bouncedToProfile ? `, redirected to ${dashRes.headers.get('location')}` : ''}`)

    if (bouncedToProfile) {
      console.error('\nFAIL — /dashboard bounced back to /profile even though onboarding_completed is true (layout.tsx isNewUser check is stale).')
      process.exitCode = 1
    } else {
      console.log('\nPASS — signup -> register -> profile save -> onboarding flag -> /dashboard access all consistent.')
    }
  } finally {
    if (!keep) {
      await admin.auth.admin.deleteUser(userId)
      console.log(`\ncleaned up user ${userId}`)
    } else {
      console.log(`\n--keep passed, left user ${userId} in place — login credentials:`)
      console.log(`  email:    ${email}`)
      console.log(`  password: ${password}`)
    }
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
