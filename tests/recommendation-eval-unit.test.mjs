import assert from 'node:assert/strict'
import test from 'node:test'
import { CATEGORIES, PROFILE_TYPES, loadCases, validateCase } from '../evals/recommendation/cases.ts'
import { compareToBaseline, computeMetrics, fingerprint, normalize } from '../evals/recommendation/metrics.ts'
import { scoreJobFast } from '../src/lib/screening/fast-scorer.ts'

const cases = loadCases()

test('fixture set meets coverage requirements', () => {
  assert.ok(cases.length >= 24, `expected >= 24 cases, got ${cases.length}`)
  for (const type of PROFILE_TYPES) assert.ok(cases.some((c) => c.profile_type === type), `missing profile type ${type}`)
  for (const category of CATEGORIES) assert.ok(cases.some((c) => c.category === category), `missing category ${category}`)
  for (const verdict of ['STRONG', 'DECENT', 'WEAK', 'REJECT']) assert.ok(cases.some((c) => c.expected.verdict === verdict), `no case expects ${verdict}`)
  const mismatches = (key, value) => cases.some((c) => c.expected[key] === value)
  assert.ok(mismatches('seniority_fit', 'under') && mismatches('seniority_fit', 'over'), 'need under- and over-levelled cases')
  assert.ok(mismatches('leadership_scope_fit', 'gap') && mismatches('hands_on_fit', 'gap') && mismatches('domain_fit', 'gap'), 'need leadership, hands-on and domain gaps')
  assert.ok(mismatches('role_identity_aligned', false), 'need role-identity mismatches')
  assert.ok(cases.some((c) => c.expected.implicit_capabilities.length), 'need implicit capabilities')
})

test('fixtures contain no real personal data', () => {
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/
  const phone = /\+?\d[\d\s().-]{8,}\d/
  const url = /https?:\/\/|www\./i
  for (const c of cases) {
    const text = JSON.stringify(c)
    assert.doesNotMatch(text, email, `${c.id} contains an email address`)
    assert.doesNotMatch(text, phone, `${c.id} contains a phone-like number`)
    assert.doesNotMatch(text, url, `${c.id} contains a URL`)
    assert.match(c.candidate.label, /^Candidate [A-Z]{2}-\d{2}$/, `${c.id} candidate must be anonymous`)
    assert.match(c.candidate.resume_text, /\(fictional/, `${c.id} resume employers must be marked fictional`)
  }
})

test('validateCase rejects malformed fixtures', () => {
  const broken = structuredClone(cases[0])
  broken.expected.verdict = 'MAYBE'
  broken.candidate.label = 'Real Person'
  const problems = validateCase(broken)
  assert.ok(problems.some((p) => p.includes('expected.verdict')))
  assert.ok(problems.some((p) => p.includes('candidate.label')))
})

test('normalize derives missing dimensions and prefers emitted ones', () => {
  const derived = normalize({ verdict: 'STRONG', role_level_score: 76, hard_reject_reasons: [] })
  assert.equal(derived.seniority_fit, 'under')
  assert.equal(derived.role_identity_aligned, true)
  assert.deepEqual(derived.derived, ['seniority_fit', 'role_identity_aligned'])
  const emitted = normalize({ verdict: 'WEAK', role_level_score: 92, hard_reject_reasons: [], seniority_fit: 'over', role_identity_aligned: false })
  assert.equal(emitted.seniority_fit, 'over')
  assert.equal(emitted.role_identity_aligned, false)
  assert.deepEqual(emitted.derived, [])
})

test('computeMetrics counts agreement, error rates, repeatability and latency', () => {
  const sample = cases.slice(0, 4).map((c, i) => ({ ...c, expected: { ...c.expected, verdict: ['STRONG', 'DECENT', 'WEAK', 'REJECT'][i], role_identity_aligned: true, seniority_fit: 'fit' } }))
  const predicted = ['STRONG', 'WEAK', 'DECENT', 'REJECT']
  const run = {
    scorer: 'test', repeats: 2, batchMs: [4, 6],
    cases: sample.map((c, i) => ({
      id: c.id, latenciesMs: [1, 2],
      fingerprints: i === 3 ? ['a', 'b'] : ['x', 'x'],
      prediction: { verdict: predicted[i], role_identity_aligned: true, seniority_fit: i === 0 ? 'under' : 'fit', derived: [] },
    })),
  }
  const m = computeMetrics(sample, run)
  assert.equal(m.verdict_agreement, 0.5)
  assert.equal(m.false_positive_rate, 0.5)
  assert.equal(m.false_negative_rate, 0.5)
  assert.equal(m.role_identity_accuracy, 1)
  assert.equal(m.seniority_accuracy, 0.75)
  assert.equal(m.deterministic_repeatability, 0.75)
  assert.equal(m.latency_ms.per_job_max, 2)
  assert.equal(m.latency_ms.batch_max, 6)
  const regressions = compareToBaseline(m, { ...m, verdict_agreement: 0.75, false_positive_rate: 0.25, disagreements: [] })
  assert.ok(regressions.some((r) => r.startsWith('verdict_agreement dropped')))
  assert.ok(regressions.some((r) => r.startsWith('false_positive_rate rose')))
  assert.ok(regressions.some((r) => r.includes('not deterministic')))
  assert.ok(regressions.some((r) => r.includes('now disagrees')))
})

test('frontend fast scorer is deterministic over the whole fixture set', () => {
  const run = () => cases.map((c) => fingerprint(scoreJobFast({ jdText: c.job.jd_text, resumeText: c.candidate.resume_text, filters: c.candidate.filters, jobTitle: c.job.title, company: c.job.company, evidence: [], corrections: [] })))
  assert.deepEqual(run(), run())
})
