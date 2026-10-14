import assert from 'node:assert/strict'
import test from 'node:test'
import { extractCandidateProfile } from '../src/lib/candidate-profile/extract.ts'
import { extractRoleProfile } from '../src/lib/role-profile/extract.ts'
import { matchProfiles } from '../src/lib/matching/engine.ts'
import { BANDS, bandFor, computeVerdictV2 } from '../src/lib/verdict/engine.ts'
import { comparisonEvent, readStoredVerdict, unavailable, verdictEngineMode } from '../src/lib/verdict/rollout.ts'
import { LEGACY_SCORING_VERSION, VERDICT_V2_SCORING_VERSION } from '../src/lib/verdict/schema.ts'

// All resumes and postings are fictional.
const pasted = { kind: 'pasted', provider: null, canonical_url: null }
function verdictFor(resume, jobTitle, jobText, hardRejectReasons = []) {
  const candidate = extractCandidateProfile(resume)
  const role = extractRoleProfile({ text: jobText, title: jobTitle, source: pasted })
  return computeVerdictV2({ matrix: matchProfiles(candidate, role), candidate, role, hardRejectReasons })
}
const BACKEND_JOB = `Senior Backend Engineer
Responsibilities:
Build TypeScript and Node.js services on AWS with PostgreSQL.
Own services end to end and join the on-call rotation.
Requirements:
5+ years of software engineering experience.
Strong experience with TypeScript, Node.js, AWS and PostgreSQL.`
const STRONG_IC = `Senior Software Engineer at Tallowmere (fictional), 2017 - 2024
Built TypeScript and Node.js services on AWS backed by PostgreSQL.
Owned the payments API end to end and joined the on-call rotation; reduced p95 latency by 38%.`

test('score bands have exact boundaries', () => {
  assert.equal(bandFor(BANDS.STRONG), 'STRONG')
  assert.equal(bandFor(BANDS.STRONG - 1), 'DECENT')
  assert.equal(bandFor(BANDS.DECENT), 'DECENT')
  assert.equal(bandFor(BANDS.DECENT - 1), 'WEAK')
  assert.equal(bandFor(100), 'STRONG')
  assert.equal(bandFor(0), 'WEAK')
})

test('a clean, evidenced match is STRONG with every dimension explained', () => {
  const v = verdictFor(STRONG_IC, 'Senior Backend Engineer', BACKEND_JOB)
  assert.equal(v.verdict, 'STRONG')
  assert.equal(v.scoring_version, VERDICT_V2_SCORING_VERSION)
  assert.deepEqual(v.blockers, [])
  for (const key of ['identity', 'seniority', 'mandatory_coverage', 'skills_capabilities', 'leadership', 'architecture', 'hands_on', 'domain', 'delivery_stakeholder', 'evidence_strength', 'constraints']) {
    assert.ok(key in v.dimensions, key)
    assert.ok(v.dimensions[key].note, `${key} note`)
  }
  assert.ok(v.strongest_matches.length > 0)
  assert.match(v.explanation[0], /^STRONG/)
})

test('hard constraints force REJECT regardless of score', () => {
  const v = verdictFor(STRONG_IC, 'Senior Backend Engineer', BACKEND_JOB, ['Requires .NET'])
  assert.equal(v.verdict, 'REJECT')
  assert.equal(v.uncapped_verdict, 'STRONG', 'the score alone would have said STRONG')
  assert.equal(v.dimensions.constraints.score, 0)
  assert.equal(v.blockers[0].kind, 'hard_constraint')
})

test('a high skill score cannot erase an identity mismatch', () => {
  const v = verdictFor(`Senior Software Engineer at Driftmere (fictional), 2016 - present
Built Java microservices on AWS with Kafka and PostgreSQL.
Mentored three junior engineers. No direct reports.`, 'Engineering Manager', `Engineering Manager
Responsibilities:
Manage a team of 8 engineers with direct reports and run performance reviews.
Requirements:
Experience with Java, AWS, Kafka and PostgreSQL.`)
  assert.ok(v.dimensions.skills_capabilities.score >= 90, `skills ${v.dimensions.skills_capabilities.score}`)
  assert.equal(v.verdict, 'WEAK')
  assert.ok(v.blockers.some((b) => b.kind === 'identity_mismatch' && b.cap === 'WEAK'))
})

test('a seniority shortfall caps the verdict even when tools match', () => {
  const v = verdictFor(`Associate Software Engineer at Kestrel (fictional), 2023 - 2025
Built TypeScript and Node.js services on AWS with PostgreSQL.`, 'Senior Backend Engineer', BACKEND_JOB)
  assert.notEqual(v.verdict, 'STRONG')
  assert.ok(v.blockers.some((b) => b.kind === 'seniority_shortfall'))
})

test('one critical missing requirement is not averaged away', () => {
  const job = `Senior Software Engineer
Spend 80% of your time writing code in TypeScript and Node.js.
Requirements:
6+ years of software engineering experience.
Experience with TypeScript and Node.js.`
  const v = verdictFor(`Senior Software Engineer at Coldharbour (fictional), 2012 - 2024
Built TypeScript and Node.js services; owned delivery for the platform.
I have not written production code in the last four years.`, 'Senior Software Engineer', job)
  assert.ok(v.score >= BANDS.DECENT, `score ${v.score} is decent on average`)
  assert.equal(v.verdict, 'WEAK')
  assert.ok(v.blockers.some((b) => b.kind === 'not_hands_on'))
})

test('claims-only must-haves cap the verdict', () => {
  const v = verdictFor(`Frontend Engineer at Saltire (fictional), 2019 - 2025
Built React and TypeScript interfaces.
Skills: Kubernetes, Kafka, Terraform`, 'Senior Platform Engineer', `Senior Platform Engineer
Requirements:
Strong experience with Kubernetes and Terraform.
Experience operating Kafka in production.`)
  assert.equal(v.verdict, 'WEAK')
  assert.ok(v.blockers.some((b) => b.kind === 'mandatory_claims_only' && b.cap === 'WEAK'))
})

test('uncertainty is reported, never counted as missing, and blocks STRONG', () => {
  const v = verdictFor('Software Engineer at Tidewell (fictional).\nBuilt React screens.', 'Software Engineer', `Software Engineer
Requirements:
Experience with Kafka.
Experience with Snowflake.
Bachelor's degree in Computer Science.`)
  assert.ok(['medium', 'high'].includes(v.uncertainty.level))
  assert.ok(v.blockers.some((b) => b.kind === 'insufficient_evidence' && b.cap === 'DECENT'))
  assert.ok(!v.important_gaps.some((g) => /Kafka|Snowflake/.test(g)), 'unknown tools are not reported as gaps')
  assert.ok(v.explanation.some((line) => /cannot be judged/.test(line)))
})

test('missing profile fields are handled safely', () => {
  const candidate = extractCandidateProfile('Some text without a recognisable role.')
  const role = extractRoleProfile({ text: BACKEND_JOB, title: 'Senior Backend Engineer', source: pasted })
  for (const c of [candidate, { ...candidate, identity: null, role_family: null, seniority: { current: null, demonstrated: null }, explicit_skills: [], implicit_capabilities: [], scopes: { leadership: null, architecture: null, hands_on: null, product_stakeholder: null, delivery_ownership: null }, team: { largest_team_size: null, has_direct_reports: null, manages_managers: null }, domains: [], experience: { total_years: null, roles: [], most_recent_activity_year: null } }]) {
    const v = computeVerdictV2({ matrix: matchProfiles(c, role), candidate: c, role, hardRejectReasons: [] })
    assert.ok(['STRONG', 'DECENT', 'WEAK'].includes(v.verdict))
    assert.notEqual(v.verdict, 'STRONG')
    assert.ok(Number.isFinite(v.score))
    assert.equal(v.uncertainty.level, 'high')
  }
  const empty = computeVerdictV2({ matrix: { ...matchProfiles(candidate, role), rows: [] }, candidate, role, hardRejectReasons: [] })
  assert.equal(empty.verdict, 'WEAK')
  assert.ok(empty.blockers.some((b) => b.kind === 'insufficient_evidence'))
})

test('identical inputs give identical verdicts', () => {
  assert.equal(JSON.stringify(verdictFor(STRONG_IC, 'Senior Backend Engineer', BACKEND_JOB)), JSON.stringify(verdictFor(STRONG_IC, 'Senior Backend Engineer', BACKEND_JOB)))
})

test('rollout guard defaults to shadow; only v2 switches', () => {
  assert.equal(verdictEngineMode(undefined), 'shadow')
  assert.equal(verdictEngineMode(''), 'shadow')
  assert.equal(verdictEngineMode('V2'), 'shadow', 'case-sensitive: only the exact value activates v2')
  assert.equal(verdictEngineMode('legacy'), 'legacy')
  assert.equal(verdictEngineMode('v2'), 'v2')
})

test('historical results stay readable and keep their stored verdict', () => {
  assert.deepEqual(readStoredVerdict({ verdict: 'DECENT', analysis_json: { ats_score: 50 } }), { verdict: 'DECENT', scoring_version: LEGACY_SCORING_VERSION, shadow: null })
  assert.deepEqual(readStoredVerdict({ verdict: 'WEAK', analysis_json: null }), { verdict: 'WEAK', scoring_version: LEGACY_SCORING_VERSION, shadow: null })
  const v2 = verdictFor(STRONG_IC, 'Senior Backend Engineer', BACKEND_JOB)
  const shadowRow = { verdict: 'DECENT', analysis_json: { scoring_version: LEGACY_SCORING_VERSION, verdict_v2: { status: 'computed', latency_ms: 0.2, ...v2 } } }
  assert.deepEqual(readStoredVerdict(shadowRow), { verdict: 'DECENT', scoring_version: LEGACY_SCORING_VERSION, shadow: { verdict: 'STRONG', scoring_version: VERDICT_V2_SCORING_VERSION } })
  assert.equal(readStoredVerdict({ verdict: 'WEAK', analysis_json: { verdict_v2: unavailable('no_candidate_profile') } }).shadow, null)
})

test('comparison telemetry carries enums and numbers only', () => {
  const resume = `${STRONG_IC}\nPersonal note: lives at 12 Fictional Lane.`
  const v2 = verdictFor(resume, 'Senior Backend Engineer', BACKEND_JOB)
  const event = comparisonEvent({ verdict: 'STRONG', composite_score: 88 }, { status: 'computed', latency_ms: 0.3, ...v2 })
  const text = JSON.stringify(event)
  for (const leak of ['Tallowmere', 'Fictional Lane', 'payments API', 'p95', 'TypeScript']) assert.ok(!text.includes(leak), leak)
  assert.deepEqual(Object.keys(event).sort(), ['agree', 'blocker_kinds', 'latency_ms', 'legacy_composite', 'legacy_verdict', 'legacy_version', 'uncertainty', 'v2_score', 'v2_status', 'v2_uncapped', 'v2_verdict', 'v2_version'])
})
