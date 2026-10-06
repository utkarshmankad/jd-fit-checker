import assert from 'node:assert/strict'
import test from 'node:test'
import { extractRoleProfile, prepareRoleText, roleTracedItems, providerFromUrl } from '../src/lib/role-profile/extract.ts'
import { ensureRoleProfiles } from '../src/lib/role-profile/store.ts'
import { ROLE_PROFILE_EXTRACTOR_VERSION } from '../src/lib/role-profile/schema.ts'

// Every company, page and posting below is fictional.
const url = (u) => ({ kind: 'url', provider: providerFromUrl(u), canonical_url: u })
const pasted = { kind: 'pasted', provider: null, canonical_url: null }

const WORKDAY_IC = `Skip to main content
Careers
Search for Jobs
Sign In
Senior Backend Engineer
Apply
locations
Bengaluru, India
time type
Full time
posted on
Posted 3 Days Ago
About the team
Quillbrook Freight (fictional) builds routing software for logistics carriers.
What you'll do
Build and operate Go and Kafka services on AWS for shipment tracking.
Design scalable APIs used by partner carriers.
Participate in the on-call rotation and own services end to end.
What you'll need
5+ years of professional software engineering experience.
Strong experience with Go or Java, Kafka and PostgreSQL.
Bachelor's degree in Computer Science or equivalent experience.
Nice to have
Experience with Terraform.
Pay range: ₹45,00,000 - ₹60,00,000 per annum
Similar Jobs
Staff Engineer, Platform
Engineering Manager, Payments
Requires 15+ years leading organizations of 300 people
© 2026 Quillbrook Freight`

const GREENHOUSE_MANAGER = `Engineering Manager, Payments Platform
Remote (United States)
About the role
Larkspur Ledger (fictional) moves money for small businesses through its payments platform.
Responsibilities
Manage a team of 7 engineers with direct reports and run their performance reviews.
Hire and grow engineers across backend and infrastructure.
Partner with product managers on the payments roadmap.
Spend roughly 20% of your time on hands-on code reviews.
Qualifications
8+ years of software engineering experience.
3+ years of people management experience.
Experience operating Java services on AWS.
Compensation
The base salary range for this role is $185,000 - $225,000 USD per year.
Benefits
Comprehensive health insurance and 401(k) matching.`

const LEVER_HYBRID = `Engineering Manager — Hands-on
Juniper Cart (fictional) builds e-commerce checkout tools.
What you'll do:
Manage 4 engineers as direct reports and run their performance reviews.
Spend about 50% of your time writing production code in TypeScript and Node.js.
Build and ship checkout features with the team.
What you'll need:
6+ years of software development experience.
Experience leading small teams.`

const MISLEADING_TITLE = `Engineering Manager
This is an individual contributor role with no direct reports.
You will spend 80% of your time writing code in Python.
Build and maintain data pipelines with Airflow and Spark.
Requirements:
4+ years of data engineering experience.
Strong Python and SQL.`

const IC_TITLE_MANAGER_DUTIES = `Senior Software Engineer
Responsibilities:
Manage a team of 6 engineers with direct reports.
Own hiring and run performance reviews for the team.
Partner with product on quarterly planning.
Requirements:
7+ years of software engineering experience.`

const LISTING = `Careers at Tallowfield (fictional)
Open positions
Senior Software Engineer
Bengaluru · Full time
Apply
Staff Engineer, Platform
Remote
Apply
Engineering Manager, Payments
Hyderabad
Apply
Data Analyst
Pune
Apply
QA Automation Engineer
Remote
Apply
Product Designer
Bengaluru`

const SEARCH = `Search jobs
128 jobs found
Filter by location
Sort by: Most recent
Software Engineer II
Senior Data Engineer
Engineering Manager
Clear filters`

for (const [name, text, source, title] of [
  ['workday', WORKDAY_IC, url('https://quillbrook.wd3.myworkdayjobs.com/en-US/careers/job/Bengaluru/Senior-Backend-Engineer_R-10421'), 'Senior Backend Engineer'],
  ['greenhouse', GREENHOUSE_MANAGER, url('https://job-boards.greenhouse.io/larkspur/jobs/4410021'), 'Engineering Manager, Payments Platform'],
  ['lever', LEVER_HYBRID, url('https://jobs.lever.co/junipercart/8d1b2c'), 'Engineering Manager — Hands-on'],
  ['misleading', MISLEADING_TITLE, pasted, 'Engineering Manager'],
  ['ic-title', IC_TITLE_MANAGER_DUTIES, pasted, 'Senior Software Engineer'],
]) {
  test(`${name}: every attribute carries confidence and verbatim evidence`, () => {
    const p = extractRoleProfile({ text, title, source })
    const prepared = prepareRoleText({ text, title, source })
    assert.equal(p.page.value, 'job_page')
    assert.equal(p.extractor.ai_assisted, false)
    for (const { path, item } of roleTracedItems(p)) {
      assert.ok(item.confidence > 0 && item.confidence <= 0.95, `${path} confidence`)
      assert.ok(['explicit', 'inferred'].includes(item.basis), `${path} basis`)
      assert.ok(item.rule && item.evidence.length, `${path} rule/evidence`)
      for (const e of item.evidence) assert.equal(prepared.text.slice(e.start, e.end), e.quote, `${path} verbatim`)
    }
    for (const c of p.contradictions) for (const e of c.evidence) assert.equal(prepared.text.slice(e.start, e.end), e.quote)
  })
}

test('Workday-style IC page: navigation and similar-job tails are not requirements', () => {
  const p = extractRoleProfile({ text: WORKDAY_IC, title: 'Senior Backend Engineer', source: url('https://quillbrook.wd3.myworkdayjobs.com/x/job/y/Senior-Backend-Engineer_R-1') })
  assert.equal(p.source.provider, 'workday')
  assert.ok(p.source.removed_lines >= 8, `removed ${p.source.removed_lines}`)
  assert.equal(p.identity.value, 'ic')
  assert.equal(p.experience.minimum_years.value, 5)
  assert.equal(p.seniority.minimum.value, 4)
  assert.equal(p.seniority.target.value, 4)
  assert.equal(p.responsibilities.length, 3)
  assert.equal(p.preferred_requirements.length, 1)
  assert.match(p.preferred_requirements[0].value, /Terraform/)
  const all = JSON.stringify([p.mandatory_requirements, p.preferred_requirements, p.responsibilities])
  for (const leaked of ['Sign In', 'Search for Jobs', 'Staff Engineer, Platform', '15+ years', '300 people', '©']) assert.ok(!all.includes(leaked), `leaked "${leaked}"`)
  assert.ok(!p.experience.by_area.some((x) => x.value.years === 15), 'similar-jobs tail ignored')
  assert.equal(p.compensation.value.currency, 'INR')
  assert.ok(p.constraints.education.length === 1)
  assert.ok(p.constraints.location.some((l) => l.value.includes('Bengaluru')))
  assert.ok(p.domains.some((d) => d.value === 'logistics / freight'))
  assert.ok(p.expectations.delivery_ownership)
})

test('Greenhouse-style manager page: people management, compensation, no benefit-derived domain', () => {
  const p = extractRoleProfile({ text: GREENHOUSE_MANAGER, title: 'Engineering Manager, Payments Platform', source: url('https://job-boards.greenhouse.io/larkspur/jobs/4410021') })
  assert.equal(p.identity.value, 'people_manager')
  assert.equal(p.team.direct_reports.value, 7)
  assert.equal(p.balance.hands_on_percent, 20)
  assert.equal(p.balance.value, 'leadership')
  assert.equal(p.experience.minimum_years.value, 8, 'overall years, not people-management years')
  assert.ok(p.experience.by_area.some((x) => x.value.area === 'people management' && x.value.years === 3))
  assert.deepEqual({ currency: p.compensation.value.currency, minimum: p.compensation.value.minimum, maximum: p.compensation.value.maximum }, { currency: 'USD', minimum: '185000', maximum: '225000' })
  assert.match(p.compensation.evidence[0].quote, /\$185,000 - \$225,000/)
  assert.equal(p.constraints.work_mode.value, 'remote')
  assert.ok(p.domains.some((d) => d.value === 'payments / fintech'))
  assert.ok(!p.domains.some((d) => d.value === 'healthcare'), '"health insurance" benefit is not a healthcare domain')
  assert.equal(p.contradictions.filter((c) => c.kind !== 'ambiguity').length, 0)
})

test('Lever-style hybrid page', () => {
  const p = extractRoleProfile({ text: LEVER_HYBRID, title: 'Engineering Manager — Hands-on', source: url('https://jobs.lever.co/junipercart/8d1b2c') })
  assert.equal(p.source.provider, 'lever')
  assert.equal(p.identity.value, 'hybrid')
  assert.equal(p.balance.hands_on_percent, 50)
  assert.equal(p.balance.value, 'balanced')
  assert.ok(p.domains.some((d) => d.value === 'retail / e-commerce'))
})

test('title alone cannot override contradictory responsibilities', () => {
  const managerTitle = extractRoleProfile({ text: MISLEADING_TITLE, title: 'Engineering Manager', source: pasted })
  assert.equal(managerTitle.identity.value, 'ic')
  assert.equal(managerTitle.expectations.people_management.negated, true)
  assert.ok(managerTitle.contradictions.some((c) => c.kind === 'title_vs_responsibilities'))
  assert.ok(managerTitle.contradictions.some((c) => c.kind === 'hands_on_vs_title'))
  const icTitle = extractRoleProfile({ text: IC_TITLE_MANAGER_DUTIES, title: 'Senior Software Engineer', source: pasted })
  assert.equal(icTitle.identity.value, 'people_manager')
  assert.ok(icTitle.contradictions.some((c) => c.kind === 'title_vs_responsibilities'))
  const staff = extractRoleProfile({ text: 'Staff Engineer\nLead architecture reviews and set technical direction across teams.\nBuild prototypes in Go.\n10+ years of software engineering experience.', title: 'Staff Engineer', source: pasted })
  assert.equal(staff.identity.value, 'ic', 'staff engineers lead technically but remain ICs')
})

test('listing, search, closed and inaccessible pages yield no requirements', () => {
  const cases = [
    [LISTING, 'listing_page'],
    [SEARCH, 'search_page'],
    ['Access Denied\nYou don\'t have permission to access this page.', 'inaccessible'],
    ['Please enable JavaScript to view this page.', 'inaccessible'],
    ['Apply\nShare\nSign in', 'inaccessible'],
    ['Senior Backend Engineer\nThis job is no longer accepting applications.\nSee our other openings.', 'closed_posting'],
  ]
  for (const [text, kind] of cases) {
    const p = extractRoleProfile({ text, title: null, source: url('https://careers.tallowfield.example/jobs') })
    assert.equal(p.page.value, kind, text.slice(0, 40))
    assert.ok(p.page.reasons.length)
    assert.equal(p.mandatory_requirements.length + p.preferred_requirements.length + p.responsibilities.length, 0)
    assert.equal(p.identity, null)
  }
})

test('manually pasted descriptions without headings are understood', () => {
  const p = extractRoleProfile({ text: 'We need a backend developer to build Node.js APIs for our tutoring platform. 3+ years of experience with Node.js and PostgreSQL required. Experience with Redis is a plus.', title: null, source: pasted })
  assert.equal(p.page.value, 'job_page')
  assert.equal(p.source.kind, 'pasted')
  assert.equal(p.source.canonical_url, null)
  assert.equal(p.experience.minimum_years.value, 3)
  assert.ok(p.mandatory_requirements.some((r) => r.skills.includes('Node.js') && r.rule === 'unsectioned_mandatory_cue'))
  assert.ok(p.preferred_requirements.some((r) => r.skills.includes('Redis')))
  assert.ok(p.unknowns.includes('role_family'), 'no title → family unknown, not guessed')
})

test('salary is captured only when the source text states pay', () => {
  const none = extractRoleProfile({ text: 'Senior Engineer\nResponsibilities:\nLead a team of 10-12 engineers through annual planning.\nRequirements:\n5-7 years of experience.\nWe offer a competitive salary.', title: 'Senior Engineer', source: pasted })
  assert.equal(none.compensation, null)
  assert.ok(none.unknowns.includes('compensation'))
  const shorthand = extractRoleProfile({ text: 'Backend Engineer\nRequirements:\n3+ years of Go experience.\nBase pay: $150k - $190k per year plus equity.', title: 'Backend Engineer', source: pasted })
  assert.equal(shorthand.compensation.value.currency, 'USD')
  assert.match(shorthand.compensation.evidence[0].quote, /Base pay/)
})

test('uses the whole description, not a prefix', () => {
  const filler = Array.from({ length: 120 }, (_, i) => `Collaborate with team ${i} on reliability reviews and documentation.`).join('\n')
  const text = `Platform Engineer\nResponsibilities:\n${filler}\nRequirements:\n6+ years of platform engineering experience with Kubernetes and Terraform.`
  assert.ok(text.length > 6000)
  const p = extractRoleProfile({ text, title: 'Platform Engineer', source: pasted })
  assert.equal(p.experience.minimum_years.value, 6)
  assert.ok(p.experience.minimum_years.evidence[0].start > 6000)
  assert.ok(p.source.chunks > 1)
})

test('deterministic, chrome-insensitive cache key, and no network or AI provider needed', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('network disabled in test') }
  try {
    const a = extractRoleProfile({ text: GREENHOUSE_MANAGER, title: 'Engineering Manager, Payments Platform', source: pasted })
    const b = extractRoleProfile({ text: `Sign In\nApply\n${GREENHOUSE_MANAGER.replace(/\n/g, '\r\n')}\nSimilar jobs\nStaff Engineer`, title: 'Engineering Manager, Payments Platform', source: pasted })
    assert.equal(a.source.content_sha256, b.source.content_sha256, 'navigation and similar-job tails do not change the content hash')
    assert.deepEqual({ ...a, source: null }, { ...b, source: null })
  } finally {
    globalThis.fetch = originalFetch
  }
})

function fakeDb({ readError = null, writeError = null } = {}) {
  const state = { rows: new Map(), reads: 0, writes: 0 }
  return {
    state,
    from(table) {
      assert.equal(table, 'role_profiles')
      return {
        select: () => ({ in: async (_c, hashes) => { state.reads += 1; return { data: readError ? null : hashes.filter((h) => state.rows.has(h)).map((h) => state.rows.get(h)), error: readError } } }),
        upsert: async (rows) => { if (writeError) return { error: writeError }; state.writes += 1; rows.forEach((r) => state.rows.set(r.content_sha256, r)); return { error: null } },
      }
    },
  }
}

test('identical job content reuses the cached profile; non-job pages are not cached', async () => {
  let extractions = 0
  const extract = (input) => { extractions += 1; return extractRoleProfile(input) }
  const db = fakeDb()
  const job = { text: GREENHOUSE_MANAGER, title: 'Engineering Manager, Payments Platform', source: url('https://job-boards.greenhouse.io/larkspur/jobs/4410021') }
  const first = await ensureRoleProfiles(db, [job, job, { text: LISTING, title: null, source: url('https://careers.tallowfield.example/jobs') }, { text: 'Access Denied', title: null, source: url('https://x.example/j/1') }, { text: '  ', title: null, source: pasted }], extract)
  assert.deepEqual(first.map((r) => r.status), ['built', 'built', 'built', 'not_cached', 'unavailable'])
  assert.equal(extractions, 3, 'duplicate content in one batch is extracted once')
  assert.equal(db.state.reads, 1)
  assert.equal(db.state.writes, 1)
  assert.deepEqual([...db.state.rows.values()].map((r) => r.page_kind).sort(), ['job_page', 'listing_page'])
  const stored = [...db.state.rows.values()].find((r) => r.page_kind === 'job_page')
  assert.equal(stored.source_kind, 'url')
  assert.equal(stored.provider, 'greenhouse')
  assert.match(stored.raw_sha256, /^[0-9a-f]{64}$/)
  assert.ok(!('user_id' in stored), 'cache rows carry no user id')

  const samePastedElsewhere = { text: `Apply now\n${GREENHOUSE_MANAGER}\n\nSimilar jobs\nData Analyst`, title: 'Engineering Manager, Payments Platform', source: pasted }
  const second = await ensureRoleProfiles(db, [samePastedElsewhere], extract)
  assert.equal(second[0].status, 'reused')
  assert.equal(extractions, 3, 'no extraction on reuse')

  for (const row of db.state.rows.values()) row.extractor_version = 'rip-deterministic-0'
  assert.equal((await ensureRoleProfiles(db, [job], extract))[0].status, 'built', 'stale extractor version is rebuilt')
  assert.equal(db.state.rows.get(first[0].profile.source.content_sha256).extractor_version, ROLE_PROFILE_EXTRACTOR_VERSION)
})

test('cache failures never block screening and never log job text', async () => {
  const logged = []
  const originalWarn = console.warn
  console.warn = (...args) => logged.push(args.join(' '))
  try {
    const job = { text: GREENHOUSE_MANAGER, title: 'Engineering Manager, Payments Platform', source: pasted }
    const readFail = await ensureRoleProfiles(fakeDb({ readError: { code: '42P01', message: 'relation "public.role_profiles" does not exist' } }), [job])
    assert.equal(readFail[0].status, 'built_not_stored')
    assert.ok(readFail[0].profile)
    const writeFail = await ensureRoleProfiles(fakeDb({ writeError: { code: '42501', message: 'permission denied for table role_profiles' } }), [job])
    assert.equal(writeFail[0].status, 'built_not_stored')
  } finally {
    console.warn = originalWarn
  }
  assert.equal(logged.length, 2)
  for (const line of logged) assert.doesNotMatch(line, /Larkspur|payments roadmap|185,000|performance reviews/i)
})
