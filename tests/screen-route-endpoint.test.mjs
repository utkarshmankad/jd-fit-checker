// Endpoint-level test: drives the real POST handler of /api/screen with only its
// external edges replaced — Supabase clients (in-memory fake) and the FastAPI
// screening service (stubbed fetch) — and inspects what is actually saved.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createFakeDb } from './helpers/fake-supabase.mjs'

const fake = new URL('./helpers/fake-supabase.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/supabase/server' || specifier === '@/lib/supabase/service') return { url: fake, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

process.env.NEXT_PUBLIC_SCREENING_API_URL = 'http://screening.test'
process.env.LAUNCH_MODE = 'true'
process.env.BETA_TOTAL_LIMIT = '25'
const { NextRequest } = await import('next/server')
const { POST } = await import('../src/app/api/screen/route.ts')

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'candidate@example.test' }
const PROFILE = {
  id: USER.id, tier: 'free', is_beta_user: true, screens_used_total: 0, screens_used_this_week: 0, referral_bonus_screens: 0,
  week_reset_at: null, preferences: {}, hard_reject_filters: {},
  resume_text: 'Senior Software Engineer at Brookvale (fictional), 2019 - 2024. Built Python services on AWS.',
}
// Fictional job description with a misleading title.
const JD = `This is an individual contributor role with no direct reports.
You will spend 80% of your time writing code in Python.
Build and maintain data pipelines with Airflow and Spark.
Requirements:
4+ years of data engineering experience.
Base salary: $140,000 - $170,000 per year.`

const fastApiCalls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (!url.startsWith('http://screening.test/screen')) throw new Error(`unexpected network call in test: ${url}`)
  const body = JSON.parse(init.body)
  fastApiCalls.push(body)
  // Canned analysis: the route must save these scores untouched.
  return Response.json({
    ats_score: 61, role_level_score: 76, composite_score: 68, verdict: 'DECENT', hard_reject_triggered: false, hard_reject_reasons: [],
    matching_skills: ['Python'], missing_skills: ['Airflow'], role_level_assessment: 'x', gap_analysis: 'x', recommendation: 'APPLY IF — x',
    headline: 'x', requirements_met: [], soft_concerns: [], job_title: body.job_title, company: body.company, jd_text: body.jd_text,
  })
}
test.after(() => { globalThis.fetch = originalFetch })

function freshDb() {
  const db = createFakeDb({ user: USER, profile: structuredClone(PROFILE) })
  globalThis.__routeTestDb = db
  return db
}

async function post(body) {
  const response = await POST(new NextRequest('http://localhost/api/screen', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: response.status, json: await response.json() }
}

test('single jd_text: saved analysis_json.role_profile, verdict untouched, cache reused on repeat', async () => {
  const db = freshDb()
  const first = await post({ jd_text: JD, job_title: 'Engineering Manager', company: 'Fictional Co', batch_id: 'batch-1' })
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(fastApiCalls.at(-1).jd_text, JD)

  const saved = db.tables.screening_results
  assert.equal(saved.length, 1, 'exactly one screening_results row')
  const row = saved[0]
  assert.equal(row.user_id, USER.id)
  assert.equal(row.jd_text, JD)
  assert.deepEqual([row.verdict, row.composite_score, row.ats_score, row.role_level_score], ['DECENT', 68, 61, 76], 'verdict formula output saved untouched')
  const ref = row.analysis_json.role_profile
  assert.ok(ref, 'analysis_json.role_profile is stored for the single-JD path')
  assert.equal(ref.status, 'built')
  assert.equal(ref.page_kind, 'job_page')
  assert.equal(ref.identity, 'ic', 'responsibilities, not the "Engineering Manager" title, decide identity')
  assert.ok(ref.contradictions >= 1)
  assert.match(ref.content_sha256, /^[0-9a-f]{64}$/)
  assert.equal(ref.extractor_version, 'rip-deterministic-1')
  assert.ok(!JSON.stringify(ref).includes('data pipelines'), 'reference carries no job text')
  assert.deepEqual(first.json.results[0].analysis_json.role_profile, ref, 'response returns the saved row')
  const match = row.analysis_json.requirement_match
  assert.ok(match, 'analysis_json.requirement_match is stored')
  assert.equal(match.engine_version, 'match-deterministic-2')
  assert.equal(typeof match.fit_score, 'number')
  assert.ok(Object.values(match.mandatory).reduce((a, b) => a + b, 0) > 0)
  assert.ok(Array.isArray(match.explanation) && match.explanation.length > 0)
  assert.ok(!JSON.stringify(match).includes('Brookvale'), 'reference carries no resume quotes')

  assert.equal(db.tables.role_profiles.length, 1, 'profile cached once')
  const cached = db.tables.role_profiles[0]
  assert.equal(cached.content_sha256, ref.content_sha256)
  assert.equal(cached.source_kind, 'pasted')
  assert.equal(cached.profile.compensation.value.currency, 'USD')
  assert.ok(!('user_id' in cached))

  const writesBefore = db.log.filter((q) => q.table === 'role_profiles' && q.op === 'upsert').length
  const second = await post({ jd_text: JD, job_title: 'Engineering Manager', company: 'Fictional Co', batch_id: 'batch-2' })
  assert.equal(second.status, 200)
  assert.equal(db.tables.screening_results.length, 2)
  assert.equal(db.tables.screening_results[1].analysis_json.role_profile.status, 'reused')
  assert.equal(db.tables.screening_results[1].analysis_json.role_profile.content_sha256, ref.content_sha256)
  assert.equal(db.log.filter((q) => q.table === 'role_profiles' && q.op === 'upsert').length, writesBefore, 'no cache write on reuse')
})

test('jd_entries batch and single jd_text produce the same stored reference', async () => {
  const db = freshDb()
  const batch = await post({ jd_entries: [{ jd_text: JD, job_title: 'Engineering Manager', company: 'Fictional Co' }], batch_id: 'batch-3' })
  assert.equal(batch.status, 200)
  const fromBatch = db.tables.screening_results[0].analysis_json.role_profile
  const single = await post({ jd_text: JD, job_title: 'Engineering Manager', company: 'Fictional Co', batch_id: 'batch-4' })
  assert.equal(single.status, 200)
  const fromSingle = db.tables.screening_results[1].analysis_json.role_profile
  assert.deepEqual({ ...fromSingle, status: null }, { ...fromBatch, status: null })
  assert.deepEqual([fromBatch.status, fromSingle.status], ['built', 'reused'])
})

test('single jd_text save failure still returns a placeholder', async () => {
  const db = freshDb()
  const originalFrom = db.client.from
  db.client.from = (table) => {
    if (table !== 'screening_results') return originalFrom(table)
    // Any insert chain (.select(), .single(), ...) resolves to a failed write.
    const failing = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok) => ok({ data: null, error: { message: 'insert failed' } }) : () => failing) })
    const builder = originalFrom(table)
    return new Proxy({}, { get: (_t, prop) => (prop === 'insert' ? () => failing : builder[prop]) })
  }
  const originalError = console.error
  console.error = () => {}
  try {
    const res = await post({ jd_text: JD, job_title: 'Engineering Manager', company: 'Fictional Co', batch_id: 'batch-5' })
    assert.equal(res.status, 200)
    assert.equal(res.json.results.length, 1)
    assert.equal(res.json.results[0].id, '')
    assert.equal(res.json.results[0].job_title, 'Engineering Manager')
  } finally {
    console.error = originalError
  }
})

// ── Sprint 4: fit verdict v2 in shadow mode ─────────────────────────────────
const writes = (db) => db.log.filter((q) => q.op !== 'select').map((q) => `${q.table}:${q.op}`).sort()

async function screenWithMode(mode) {
  if (mode === undefined) delete process.env.VERDICT_ENGINE
  else process.env.VERDICT_ENGINE = mode
  const db = freshDb()
  const logged = []
  const originalInfo = console.info
  console.info = (...args) => logged.push(args.join(' '))
  try {
    const res = await post({ jd_text: JD, job_title: 'Engineering Manager', company: 'Fictional Co', batch_id: `batch-${mode ?? 'default'}` })
    assert.equal(res.status, 200)
    return { db, res, row: db.tables.screening_results[0], logged }
  } finally {
    console.info = originalInfo
    delete process.env.VERDICT_ENGINE
  }
}

test('shadow is the default: v2 is stored, the user-visible verdict stays legacy', async () => {
  const { row, res } = await screenWithMode(undefined)
  assert.equal(row.verdict, 'DECENT', 'legacy verdict from the scorer is what users see')
  assert.equal(row.analysis_json.verdict, 'DECENT')
  assert.equal(row.analysis_json.scoring_version, 'legacy-fast-1')
  const v2 = row.analysis_json.verdict_v2
  assert.equal(v2.status, 'computed')
  assert.equal(v2.scoring_version, 'fit-v2-1')
  assert.ok(['STRONG', 'DECENT', 'WEAK', 'REJECT'].includes(v2.verdict))
  assert.ok(v2.dimensions.identity && v2.blockers && v2.explanation.length)
  assert.equal(row.analysis_json.legacy_verdict, undefined)
  assert.deepEqual(res.json.results[0].analysis_json.verdict_v2.verdict, v2.verdict)
})

test('legacy mode computes no shadow verdict', async () => {
  const { row } = await screenWithMode('legacy')
  assert.equal(row.analysis_json.verdict_v2, undefined)
  assert.equal(row.analysis_json.scoring_version, 'legacy-fast-1')
})

test('shadow execution causes no extra quota, payment, profile or tracker mutation', async () => {
  const legacy = await screenWithMode('legacy')
  const shadow = await screenWithMode('shadow')
  assert.deepEqual(shadow.db.rpcs.map(([name]) => name), legacy.db.rpcs.map(([name]) => name), 'identical RPC calls (quota reserve/refund, resets)')
  assert.deepEqual(writes(shadow.db), writes(legacy.db), 'identical write operations')
  for (const db of [legacy.db, shadow.db]) {
    for (const table of ['profiles', 'job_tracker', 'payments', 'orders', 'subscriptions']) {
      assert.ok(!db.log.some((q) => q.table === table && q.op !== 'select'), `${table} not written`)
    }
  }
  assert.deepEqual(shadow.db.tables.profiles, legacy.db.tables.profiles, 'quota counters untouched by shadow')
})

test('comparison telemetry is logged without resume or job contents', async () => {
  const { logged } = await screenWithMode('shadow')
  const line = logged.find((l) => l.includes('"event":"verdict_shadow"'))
  assert.ok(line, 'telemetry emitted')
  const event = JSON.parse(line)
  assert.equal(event.items, 1)
  assert.equal(event.comparisons[0].legacy_verdict, 'DECENT')
  for (const leak of ['Brookvale', 'Python services', 'individual contributor', 'data pipelines', '140,000', USER.id, USER.email]) assert.ok(!line.includes(leak), `telemetry leaked "${leak}"`)
})

test('rollout guard: only VERDICT_ENGINE=v2 switches the visible verdict, keeping the legacy one', async () => {
  const { row } = await screenWithMode('v2')
  const v2 = row.analysis_json.verdict_v2
  assert.equal(row.verdict, v2.verdict)
  assert.equal(row.analysis_json.scoring_version, 'fit-v2-1')
  assert.equal(row.analysis_json.legacy_verdict, 'DECENT')
  assert.deepEqual([row.ats_score, row.composite_score], [61, 68], 'legacy scores preserved for comparison')
})
