import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkResume, extractCandidateProfile, normaliseResume, resumeSha256, tracedItems, MAX_CHUNK_CHARS } from '../src/lib/candidate-profile/extract.ts'
import { ensureCandidateProfile, isProfileFresh } from '../src/lib/candidate-profile/store.ts'
import { CANDIDATE_PROFILE_EXTRACTOR_VERSION, CANDIDATE_PROFILE_SCHEMA_VERSION } from '../src/lib/candidate-profile/schema.ts'

// All resumes below are fictional.
const RESUMES = {
  ic: `Senior Software Engineer at Brookvale Payments (fictional), 2019 - 2024
- Built TypeScript and Node.js services on AWS backed by PostgreSQL for card settlement.
- Implemented distributed tracing and reduced p95 latency by 38%.
- Wrote integration tests with Jest and shipped weekly.
Software Engineer at Tidewater Apps (fictional), 2016 - 2019
- Developed React interfaces and REST APIs.
Skills: TypeScript, Node.js, React, AWS, PostgreSQL, Docker, Kubernetes`,
  manager: `Engineering Manager at Larkhill Logistics (fictional), 2018 - present
Managed a team of 9 engineers with direct reports; ran performance reviews and hiring.
Partnered with product on the freight routing roadmap and owned quarterly delivery.
The team owned Java and Kafka services on AWS.
I have not written production code in the last three years.`,
  hybrid: `Engineering Manager at Pennyroyal Health (fictional), 2020 - present
Managed a team of 6 engineers with direct reports and ran performance reviews.
Still hands-on: built Python services on GCP and implemented the patient intake API.
Wrote Terraform modules for the clinical data platform.`,
  principal: `Principal Engineer at Coldwater Bank (fictional), 2015 - present
Owns multi-year architecture for distributed systems across a 300-engineer organization.
Chairs the architecture review board; designed the highly available ledger platform adopted by 14 teams.
Has never had direct reports.`,
  transition: `Junior Software Engineer at Fernleaf Tutoring (fictional), 2023 - present, after 7 years as a secondary-school teacher and a bootcamp.
Builds React and TypeScript features with Jest tests for a lesson planning tool used by 400 teachers.`,
}

function assertInvariants(name, resume) {
  const profile = extractCandidateProfile(resume)
  const text = normaliseResume(resume)
  assert.equal(profile.schema_version, CANDIDATE_PROFILE_SCHEMA_VERSION)
  assert.equal(profile.extractor.version, CANDIDATE_PROFILE_EXTRACTOR_VERSION)
  assert.equal(profile.extractor.ai_assisted, false)
  assert.equal(profile.source.resume_sha256, resumeSha256(resume))
  for (const { path, item } of tracedItems(profile)) {
    assert.ok(['explicit', 'inferred'].includes(item.basis), `${name} ${path} basis`)
    assert.ok(item.confidence > 0 && item.confidence <= 0.95, `${name} ${path} confidence ${item.confidence}`)
    if (item.basis === 'inferred') assert.ok(item.confidence <= 0.9, `${name} ${path} inferred confidence capped`)
    assert.ok(item.rule, `${name} ${path} rule`)
    assert.ok(item.evidence.length > 0, `${name} ${path} has evidence`)
    for (const e of item.evidence) assert.equal(text.slice(e.start, e.end), e.quote, `${name} ${path} quote is verbatim`)
  }
  return profile
}

test('IC resume: hands-on IC with explicit, evidenced skills', () => {
  const p = assertInvariants('ic', RESUMES.ic)
  assert.equal(p.identity.value, 'ic')
  assert.equal(p.role_family.value, 'engineering')
  assert.equal(p.seniority.current.value, 4)
  assert.equal(p.scopes.hands_on.value, 'high')
  const ts = p.explicit_skills.find((s) => s.value === 'TypeScript')
  assert.equal(ts.rule, 'used_in_experience')
  const k8s = p.explicit_skills.find((s) => s.value === 'Kubernetes')
  assert.equal(k8s.rule, 'skills_list_only', 'skills-list-only mentions are weaker')
  assert.ok(k8s.confidence < ts.confidence)
  assert.equal(p.experience.total_years.value, 8)
  assert.equal(p.experience.most_recent_activity_year.value, 2024)
  assert.ok(p.outcomes.some((o) => o.value.includes('38%')))
  assert.ok(p.domains.some((d) => d.value === 'payments / fintech'))
  assert.equal(p.team.largest_team_size, null)
  assert.ok(p.unknowns.includes('team.largest_team_size'))
})

test('manager resume: people manager, explicit non-coding statement wins', () => {
  const p = assertInvariants('manager', RESUMES.manager)
  assert.equal(p.identity.value, 'people_manager')
  assert.equal(p.team.largest_team_size.value, 9)
  assert.equal(p.team.has_direct_reports.value, true)
  assert.equal(p.scopes.hands_on.negated, true)
  assert.equal(p.scopes.hands_on.value, 'low')
  assert.ok(p.scopes.product_stakeholder)
  assert.ok(p.implicit_capabilities.some((c) => c.value === 'People Management' && c.basis === 'inferred'))
  assert.ok(p.implicit_capabilities.some((c) => c.value === 'Hiring'))
})

test('hybrid resume: manager with current hands-on evidence', () => {
  const p = assertInvariants('hybrid', RESUMES.hybrid)
  assert.equal(p.identity.value, 'hybrid')
  assert.ok(p.identity.confidence <= 0.6, 'hybrid is a lower-confidence call')
  assert.equal(p.scopes.hands_on.negated, false)
  assert.ok(p.domains.some((d) => d.value === 'healthcare'))
})

test('principal resume: org-wide IC without direct reports', () => {
  const p = assertInvariants('principal', RESUMES.principal)
  assert.equal(p.identity.value, 'ic')
  assert.equal(p.seniority.current.value, 6)
  assert.equal(p.seniority.demonstrated.value, 6)
  assert.equal(p.team.has_direct_reports.value, false)
  assert.equal(p.team.has_direct_reports.rule, 'explicit_no_direct_reports')
  assert.ok(p.implicit_capabilities.some((c) => c.value === 'Cross-team Influence'))
  assert.ok(!p.implicit_capabilities.some((c) => c.value === 'People Management'), 'negated reports are not management evidence')
})

test('career-transition resume: prior career recorded, seniority stays junior', () => {
  const p = assertInvariants('transition', RESUMES.transition)
  assert.equal(p.career_transition.value, 'from secondary-school teacher')
  assert.equal(p.career_transition.basis, 'explicit')
  assert.equal(p.seniority.current.value, 2)
  assert.ok(p.domains.some((d) => d.value === 'education'))
})

test('keyword traps are not promoted to capabilities or seniority', () => {
  const pca = assertInvariants('pca', 'Data Engineer at Fieldmouse Insights (fictional), 4 years.\nImplemented principal component analysis features in Python and Spark.')
  assert.equal(pca.seniority.current.value, 3, '"principal component analysis" is not a principal title')
  const student = assertInvariants('student', 'Associate Software Engineer at Kestrel Apps (fictional), 2 years.\nBuilt React features.\nShowed leadership as captain of a university hackathon team and mentoring students in a coding club.')
  assert.equal(student.scopes.leadership.rule, 'non_professional_context_only')
  assert.ok(student.scopes.leadership.confidence <= 0.3)
  const mentoring = student.implicit_capabilities.find((c) => c.value === 'Mentoring')
  assert.ok(!mentoring || mentoring.confidence <= 0.3)
  const certificate = assertInvariants('cert', 'Logistics Operations Officer (fictional service branch), 9 years.\nCompleted certificates in Python and Apache Spark.')
  assert.equal(certificate.explicit_skills.find((s) => s.value === 'Python').rule, 'non_professional_context_only')
  assert.equal(certificate.identity, null, 'no engineering identity without engineering work')
  assert.ok(certificate.unknowns.includes('identity'))
})

test('never invents capabilities absent from the resume', () => {
  const p = assertInvariants('minimal', 'Software Engineer at Quietfield (fictional).\nBuilt React screens.')
  assert.deepEqual(p.explicit_skills.map((s) => s.value), ['React'])
  assert.deepEqual(p.implicit_capabilities, [])
  for (const field of ['team.largest_team_size', 'team.has_direct_reports', 'scopes.leadership', 'scopes.architecture', 'domains', 'outcomes', 'experience.total_years']) {
    assert.ok(p.unknowns.includes(field), `${field} should be unknown`)
  }
})

test('uses the entire resume through bounded chunks (no prefix truncation)', () => {
  const filler = Array.from({ length: 120 }, (_, i) => `- Maintained internal reporting job number ${i} for the finance team.`).join('\n')
  const resume = `Senior Software Engineer at Hollowmere (fictional), 2015 - 2025\n${filler}\n- Built Kafka streaming pipelines in Golang processing 3 billion events a day.`
  assert.ok(resume.length > 6000)
  const p = assertInvariants('long', resume)
  const text = normaliseResume(resume)
  const chunks = chunkResume(text)
  assert.equal(chunks[0].start, 0)
  assert.equal(chunks.at(-1).end, text.length)
  for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i].start, chunks[i - 1].end, 'chunks are contiguous')
  assert.ok(chunks.every((c) => c.end - c.start <= MAX_CHUNK_CHARS))
  const kafka = p.explicit_skills.find((s) => s.value === 'Kafka')
  assert.ok(kafka && kafka.evidence[0].start > 6000, 'evidence found beyond the old 6,000-char window')
  assert.ok(kafka.evidence[0].chunk > 0)
})

test('deterministic, whitespace-insensitive, and needs no network or AI provider', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('network disabled in test') }
  try {
    const a = extractCandidateProfile(RESUMES.manager)
    const b = extractCandidateProfile(RESUMES.manager.replace(/\n/g, '\r\n').replace(/ /g, '  '))
    assert.deepEqual(a, b)
  } finally {
    globalThis.fetch = originalFetch
  }
})

function fakeDb({ row = null, readError = null, writeError = null } = {}) {
  const state = { row, reads: 0, writes: [] }
  return {
    state,
    from(table) {
      assert.equal(table, 'candidate_profiles')
      return {
        select: () => ({ eq: (_column, userId) => ({ maybeSingle: async () => { state.reads += 1; return { data: state.row && state.row.user_id === userId ? state.row : null, error: readError } } }) }),
        upsert: async (value) => { if (writeError) return { error: writeError }; state.writes.push(value); state.row = value; return { error: null } },
      }
    },
  }
}

test('profile is extracted once per resume version and rebuilt when stale', async () => {
  let extractions = 0
  const extract = (text) => { extractions += 1; return extractCandidateProfile(text) }
  const db = fakeDb()
  const first = await ensureCandidateProfile(db, 'user-1', RESUMES.ic, extract)
  assert.equal(first.status, 'built')
  const second = await ensureCandidateProfile(db, 'user-1', `${RESUMES.ic}\n\n`, extract)
  assert.equal(second.status, 'reused', 'whitespace-only change is the same resume version')
  assert.equal(extractions, 1)
  const changed = await ensureCandidateProfile(db, 'user-1', `${RESUMES.ic}\n- Led the migration to Kubernetes.`, extract)
  assert.equal(changed.status, 'built')
  assert.equal(extractions, 2)
  db.state.row = { ...db.state.row, extractor_version: 'cip-deterministic-0' }
  assert.equal((await ensureCandidateProfile(db, 'user-1', `${RESUMES.ic}\n- Led the migration to Kubernetes.`, extract)).status, 'built', 'old extractor version is rebuilt')
  db.state.row = { ...db.state.row, schema_version: 0 }
  assert.equal(isProfileFresh(db.state.row, resumeSha256(RESUMES.ic)), false)
  assert.equal(extractions, 3)
  assert.equal(db.state.writes.at(-1).user_id, 'user-1')
})

test('storage failures keep the legacy flow and never log resume content', async () => {
  const logged = []
  const originalWarn = console.warn
  console.warn = (...args) => logged.push(args.join(' '))
  try {
    let extractions = 0
    const missing = await ensureCandidateProfile(fakeDb({ readError: { code: '42P01', message: 'relation "public.candidate_profiles" does not exist' } }), 'u', RESUMES.manager, (t) => { extractions += 1; return extractCandidateProfile(t) })
    assert.equal(missing.status, 'unavailable')
    assert.equal(extractions, 0, 'no per-scan extraction when storage is unavailable')
    const notStored = await ensureCandidateProfile(fakeDb({ writeError: { code: '42501', message: 'permission denied for table candidate_profiles' } }), 'u', RESUMES.manager)
    assert.equal(notStored.status, 'built_not_stored')
    assert.ok(notStored.profile)
    assert.equal((await ensureCandidateProfile(fakeDb(), 'u', '   ')).status, 'unavailable')
  } finally {
    console.warn = originalWarn
  }
  assert.equal(logged.length, 2)
  for (const line of logged) {
    assert.doesNotMatch(line, /Larkhill|freight|performance reviews|direct reports/i, 'logs must not contain resume text')
  }
})
