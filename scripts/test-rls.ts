// Standalone RLS verification script — NOT part of the app, run manually:
//   npx tsx scripts/test-rls.ts
//
// Creates two throwaway users, exercises cross-user access through their own
// sessions (never the service role), and confirms Postgres RLS policies
// actually block what they're supposed to block — not just that they exist.
// Cleans up both users and any rows it created when it's done, even on failure.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import WebSocket from 'ws'

// supabase-js always spins up a RealtimeClient, which needs a global
// WebSocket implementation on Node < 22.
;(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'))
} catch {
  console.warn('No .env.local found at project root — relying on already-exported env vars.')
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || SUPABASE_URL.includes('YOUR_') || SERVICE_KEY.includes('YOUR_')) {
  console.error(
    'Missing or placeholder Supabase credentials in .env.local.\n' +
    'Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY ' +
    'to real values before running this script — it needs a live project to test against.'
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = `Rls-test-${randomUUID()}!`
const USER_A_EMAIL = 'test-user-a@test.com'
const USER_B_EMAIL = 'test-user-b@test.com'

type CheckResult = { name: string; pass: boolean; detail?: string }
const results: CheckResult[] = []

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function deleteUserByEmailIfExists(email: string) {
  const { data } = await admin.auth.admin.listUsers()
  const existing = data.users.find((u) => u.email === email)
  if (existing) await admin.auth.admin.deleteUser(existing.id)
}

async function makeUserClient(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function main() {
  console.log('=== RLS verification: scripts/test-rls.ts ===\n')

  let userAId = ''
  let userBId = ''
  let rowId = ''
  let sharedSlug = ''
  const batchId = randomUUID()

  try {
    // Preflight: clear out any leftover test users from a previous failed run.
    await deleteUserByEmailIfExists(USER_A_EMAIL)
    await deleteUserByEmailIfExists(USER_B_EMAIL)

    const { data: a, error: aErr } = await admin.auth.admin.createUser({
      email: USER_A_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    })
    if (aErr || !a.user) throw new Error(`create test-user-a failed: ${aErr?.message}`)
    userAId = a.user.id

    const { data: b, error: bErr } = await admin.auth.admin.createUser({
      email: USER_B_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    })
    if (bErr || !b.user) throw new Error(`create test-user-b failed: ${bErr?.message}`)
    userBId = b.user.id

    console.log(`Created test-user-a (${userAId}) and test-user-b (${userBId})\n`)

    const clientA = await makeUserClient(USER_A_EMAIL)
    const clientB = await makeUserClient(USER_B_EMAIL)
    const clientAnon = createClient(SUPABASE_URL, ANON_KEY)

    // 2. As test-user-a (own session), insert a screening_results row.
    const { data: inserted, error: insertErr } = await clientA
      .from('screening_results')
      .insert({
        user_id: userAId,
        batch_id: batchId,
        job_url: 'https://example.com/jobs/rls-test',
        job_title: 'RLS Test Role',
        company: 'Test Co',
        jd_text: 'dummy JD text for RLS verification',
        ats_score: 50,
        role_level_score: 50,
        composite_score: 50,
        verdict: 'DECENT',
        hard_reject_reasons: [],
        analysis_json: {},
      })
      .select()
      .single()

    if (insertErr || !inserted) {
      throw new Error(`test-user-a insert into screening_results failed: ${insertErr?.message}`)
    }
    rowId = inserted.id
    console.log(`test-user-a inserted screening_results row ${rowId}\n`)

    // 3a. test-user-b SELECT all rows — test-user-a's row must not be visible.
    const { data: bSelect } = await clientB.from('screening_results').select('*')
    const visibleToB = (bSelect ?? []).some((r) => r.id === rowId)
    record('3a. test-user-b cannot SELECT test-user-a row', !visibleToB)

    // 3b. test-user-b attempts UPDATE on test-user-a's row.
    const { data: bUpdate, error: bUpdateErr } = await clientB
      .from('screening_results')
      .update({ verdict: 'REJECT' })
      .eq('id', rowId)
      .select()
    const updateBlocked = bUpdateErr ? true : (bUpdate ?? []).length === 0
    record('3b. test-user-b cannot UPDATE test-user-a row', updateBlocked, bUpdateErr?.message)

    // 3c. test-user-b attempts DELETE on test-user-a's row.
    const { data: bDelete, error: bDeleteErr } = await clientB
      .from('screening_results')
      .delete()
      .eq('id', rowId)
      .select()
    const deleteBlocked = bDeleteErr ? true : (bDelete ?? []).length === 0
    record('3c. test-user-b cannot DELETE test-user-a row', deleteBlocked, bDeleteErr?.message)

    // Confirm the row actually survived untouched (admin bypasses RLS).
    const { data: stillThere } = await admin
      .from('screening_results')
      .select('verdict')
      .eq('id', rowId)
      .single()
    record(
      '3d. row intact after blocked update/delete attempts',
      stillThere?.verdict === 'DECENT',
      `verdict=${stillThere?.verdict ?? 'ROW MISSING'}`
    )

    // 4. test-user-a reads their own profile.
    const { data: ownProfile, error: ownProfileErr } = await clientA
      .from('profiles')
      .select('id, email')
      .eq('id', userAId)
      .single()
    record('4. test-user-a can read own profile', !!ownProfile && !ownProfileErr, ownProfileErr?.message)

    // 5a. test-user-a creates a shared report.
    sharedSlug = `rls-test-${randomUUID().slice(0, 8)}`
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { data: sharedRow, error: sharedErr } = await clientA
      .from('shared_reports')
      .insert({
        user_id: userAId,
        batch_id: batchId,
        slug: sharedSlug,
        results_snapshot: [inserted],
        expires_at: expiresAt,
      })
      .select()
      .single()
    record('5a. test-user-a can create a shared_reports row', !!sharedRow && !sharedErr, sharedErr?.message)

    // 5b. Unauthenticated request reads the shared report via slug — must succeed.
    const { data: publicRead, error: publicReadErr } = await clientAnon
      .from('shared_reports')
      .select('*')
      .eq('slug', sharedSlug)
      .single()
    record(
      '5b. unauthenticated read of shared_reports by slug succeeds',
      !!publicRead && !publicReadErr,
      publicReadErr?.message
    )

    // 5c. Unauthenticated request reads screening_results directly — must fail.
    const { data: publicScreening } = await clientAnon
      .from('screening_results')
      .select('*')
      .eq('id', rowId)
    const directReadBlocked = (publicScreening ?? []).length === 0
    record('5c. unauthenticated cannot read screening_results directly', directReadBlocked)
  } catch (e) {
    console.error('\nFATAL — test sequence threw before completing:', e instanceof Error ? e.message : e)
  } finally {
    console.log('\n=== cleanup ===')
    if (rowId) await admin.from('screening_results').delete().eq('id', rowId)
    if (sharedSlug) await admin.from('shared_reports').delete().eq('slug', sharedSlug)
    if (userAId) await admin.auth.admin.deleteUser(userAId)
    if (userBId) await admin.auth.admin.deleteUser(userBId)
    console.log('Deleted test users and any leftover rows.\n')
  }

  console.log('=== Summary ===')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} — ${r.name}`)

  const anyFail = results.length === 0 || results.some((r) => !r.pass)
  if (anyFail) {
    console.log('\nSome checks did not pass — see above for which RLS policy needs fixing.')
    process.exit(1)
  }
  console.log('\nAll RLS checks passed.')
}

main()
