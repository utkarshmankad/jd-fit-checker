import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { extractCandidateProfile } from '../src/lib/candidate-profile/extract.ts'
import { extractRoleProfile } from '../src/lib/role-profile/extract.ts'
import { matchProfiles, matrixReference, skillGroups } from '../src/lib/matching/engine.ts'
import { loadCases } from '../evals/recommendation/cases.ts'

// All resumes and postings are fictional.
const pasted = { kind: 'pasted', provider: null, canonical_url: null }
const match = (resume, jobTitle, jobText) => matchProfiles(extractCandidateProfile(resume), extractRoleProfile({ text: jobText, title: jobTitle, source: pasted }))
const row = (m, kind, concept) => m.rows.find((r) => r.requirement.kind === kind && (!concept || r.requirement.concepts.includes(concept)))

const EM_JOB = `Engineering Manager
Responsibilities:
Manage a team of 8 engineers with direct reports.
Own hiring and performance reviews.
Requirements:
2+ years of people management experience.
Experience with Java and AWS.`

test('IC-versus-manager mismatch: identity and people management are gaps, not keyword matches', () => {
  const m = match(`Senior Software Engineer at Driftmere Systems (fictional), 2016 - present
Built Java microservices on AWS with Kafka.
Mentored three junior engineers and led design reviews.
No direct reports; my manager owns hiring and performance reviews.`, 'Engineering Manager', EM_JOB)
  assert.equal(row(m, 'identity').status, 'explicit_gap')
  assert.equal(row(m, 'people_management').status, 'explicit_gap')
  assert.equal(row(m, 'people_management').basis, 'explicit')
  assert.equal(row(m, 'skill', 'Java').status, 'strong', 'the tool overlap is real but does not decide fit')
  assert.ok(m.summary.blocking_gaps.some((g) => /People Management|Role identity/.test(g)))
  assert.ok(m.summary.fit_score < 60, `fit ${m.summary.fit_score}`)
  assert.ok(m.explanation[0].includes('people manager'))
})

test('generic leadership words never become proof of people management', () => {
  const m = match(`Senior Software Engineer at Thornbury Labs (fictional), 2017 - present
Built Python data services on GCP.
Mentored new hires and led the technical design of the ingestion platform. Strong leadership skills.`, 'Engineering Manager', EM_JOB)
  const pm = row(m, 'people_management')
  assert.equal(pm.status, 'transferable')
  assert.match(pm.explanation, /not people management/)
  assert.notEqual(row(m, 'experience_years', 'People Management').status, 'strong')
})

test('the reverse: a manager who stopped coding vs a hands-on IC role', () => {
  const m = match(`Engineering Manager at Coldharbour Media (fictional), 2014 - present
Managed a team of 10 with direct reports and performance reviews.
I have not written production code in the last four years.`, 'Lead Engineer', `Lead Engineer
This is an individual contributor role with no direct reports.
Spend 80% of your time writing code in React and Node.js.
Requirements:
6+ years of software engineering experience.`)
  assert.equal(row(m, 'hands_on').status, 'explicit_gap')
  assert.equal(row(m, 'identity').status, 'explicit_gap')
})

test('inflated titles: a senior title is a claim until scope supports it', () => {
  const head = match(`Head of Engineering at Pocketfern (fictional), 2023 - present
Built the MVP in React and Node.js with two contractors.`, 'Director of Engineering', `Director of Engineering
Responsibilities:
Lead 4 engineering managers and an organization of 40 engineers.
Requirements:
12+ years of software engineering experience.`)
  assert.equal(row(head, 'seniority').status, 'unsupported')
  assert.match(row(head, 'seniority').explanation, /title implies/)
  assert.notEqual(row(head, 'manages_managers').status, 'strong')
  const staff = match(`Senior Staff Engineer at Brightwick (fictional), 2022 - 2025
Built the notifications feature for one product team in TypeScript.`, 'Staff Engineer, Platform', `Staff Engineer, Platform
Responsibilities:
Drive cross-team technical strategy and lead architecture reviews.
Requirements:
10+ years of software engineering experience.`)
  assert.equal(row(staff, 'seniority').status, 'explicit_gap', 'demonstrated level, not the title, is compared')
  assert.equal(row(staff, 'experience_years').status, 'explicit_gap')
})

test('high keyword overlap with poor real fit: skills lists, certificates and student leadership', () => {
  const list = match(`Frontend Engineer at Saltire Media (fictional), 2021 - 2025
Built React and TypeScript interfaces.
Skills: Kubernetes, Kafka, Terraform, Go, React, TypeScript`, 'Senior Platform Engineer', `Senior Platform Engineer
Requirements:
Strong experience with Kubernetes and Terraform.
Experience operating Kafka in production.`)
  for (const skill of ['Kubernetes', 'Terraform', 'Kafka']) {
    assert.equal(row(list, 'skill', skill).status, 'unsupported', skill)
    assert.ok(list.summary.blocking_gaps.includes(`Skill: ${skill}`), `${skill} is a blocking gap`)
  }
  const demonstrated = match(`Platform Engineer at Saltire Media (fictional), 2021 - 2025
Built and operated Kubernetes clusters, Terraform modules and Kafka in production.`, 'Senior Platform Engineer', `Senior Platform Engineer
Requirements:
Strong experience with Kubernetes and Terraform.
Experience operating Kafka in production.`)
  assert.ok(list.summary.fit_score < demonstrated.summary.fit_score - 15, `listed ${list.summary.fit_score} vs demonstrated ${demonstrated.summary.fit_score}`)
  const cert = match(`Operations Analyst at Ferrybridge (fictional), 2019 - 2025
Completed a certificate in Apache Spark and Python.`, 'Data Engineer', 'Data Engineer\nRequirements:\nExperience building Spark pipelines in Python.')
  assert.equal(row(cert, 'skill', 'Spark').status, 'unsupported')
  assert.equal(row(cert, 'role_family').status, 'transferable', 'analyst → data engineer is related, not the same job')
  const student = match(`Associate Software Engineer at Kestrel Apps (fictional), 2023 - 2025
Built React features.
Showed leadership as captain of a university hackathon team.`, 'Tech Lead', 'Tech Lead\nRequirements:\nProven technical leadership of a team of engineers.')
  assert.equal(row(student, 'technical_leadership').status, 'unsupported')
})

test('different wording, genuinely equivalent evidence', () => {
  const pm = match(`Engineering Manager at Larchfield Pay (fictional), 2019 - present
Line-managed 7 engineers, ran performance reviews and hired 3 engineers.`, 'Engineering Manager', 'Engineering Manager\nRequirements:\nExperience managing engineering teams.')
  assert.equal(row(pm, 'people_management').status, 'strong')
  const ops = match(`Senior Software Engineer at Oxbow Health (fictional), 2018 - 2024
Wrote runbooks and reduced MTTR by 40% for the scheduling platform.`, 'Senior Backend Engineer', 'Senior Backend Engineer\nRequirements:\nComfortable with on-call and production incident response.')
  assert.equal(row(ops, 'capability', 'Incident Response').status, 'strong')
  assert.equal(row(ops, 'capability', 'Incident Response').basis, 'inferred')
  const pg = match('Software Engineer at Quayside (fictional), 2020 - 2025\nTuned Postgres queries for billing.', 'Backend Engineer', 'Backend Engineer\nRequirements:\nStrong PostgreSQL skills.\n3+ years of backend development experience.')
  assert.equal(row(pg, 'skill', 'PostgreSQL').status, 'strong')
  assert.equal(row(pg, 'skill', 'PostgreSQL').recency.start_year, 2020)
})

test('transferable evidence is recognised without being overstated', () => {
  const m = match('Senior Software Engineer at Corvale (fictional), 2016 - 2024\nBuilt Java microservices for card settlement on AWS.', 'Senior Software Engineer', 'Senior Software Engineer\nRequirements:\nStrong Golang experience.')
  const go = row(m, 'skill', 'Go')
  assert.equal(go.status, 'transferable')
  assert.ok(go.confidence < 0.6)
  assert.match(go.explanation, /may transfer/)
  assert.deepEqual(skillGroups('Go or Java, Kafka and PostgreSQL', ['Java', 'Kafka', 'PostgreSQL']), [['Java'], ['Kafka'], ['PostgreSQL']])
  assert.deepEqual(skillGroups('Golang/Java and AWS', ['Go', 'Java', 'AWS']), [['Go', 'Java'], ['AWS']])
})

test('unknown stays distinct from "does not have"', () => {
  const m = match('Software Engineer at Tidewell (fictional), 2019 - 2024\nBuilt React and Node.js features.', 'Software Engineer', `Software Engineer
Requirements:
Bachelor's degree in Computer Science.
Experience with Kafka.
Nice to have:
Payments or banking domain experience.`)
  assert.equal(row(m, 'education').status, 'unknown')
  assert.equal(row(m, 'skill', 'Kafka').status, 'unknown', 'an unmentioned tool is unknown, not a gap')
  assert.equal(row(m, 'skill', 'Kafka').basis, 'fallback')
  assert.ok(!m.summary.blocking_gaps.includes('Skill: Kafka'))
})

test('missing mandatory requirements cost more than missing preferred ones', () => {
  const resume = 'Software Engineer at Tidewell (fictional), 2019 - 2024\nBuilt React features.'
  const mandatory = match(resume, 'Software Engineer', 'Software Engineer\nRequirements:\nStrong experience with React.\nStrong experience with Kubernetes.')
  const preferred = match(resume, 'Software Engineer', 'Software Engineer\nRequirements:\nStrong experience with React.\nNice to have:\nExperience with Kubernetes.')
  assert.ok(mandatory.summary.fit_score < preferred.summary.fit_score, `${mandatory.summary.fit_score} vs ${preferred.summary.fit_score}`)
  assert.ok(row(mandatory, 'skill', 'Kubernetes').weight > row(preferred, 'skill', 'Kubernetes').weight)
})

test('tool-name overlap cannot dominate the assessment', () => {
  const m = match(`QA Automation Engineer at Brindle (fictional), 2019 - 2024
Built Cypress and Jest suites for React and TypeScript apps on AWS with Docker and GitHub Actions CI/CD and PostgreSQL fixtures.`, 'Senior React Engineer', `Senior React Engineer
Requirements:
Experience with React, TypeScript, Jest, Cypress, Docker, AWS, PostgreSQL and CI/CD.
5+ years shipping production frontend features.`)
  assert.ok(m.summary.skill_weight_share <= 0.4 + 1e-9, `skill share ${m.summary.skill_weight_share}`)
  assert.equal(row(m, 'role_family').status, 'transferable')
})

test('identical inputs produce identical matrices; non-job pages produce none', () => {
  const resume = 'Senior Software Engineer at Brookvale (fictional), 2019 - 2024\nBuilt Python services on AWS.'
  const a = match(resume, 'Engineering Manager', EM_JOB)
  const b = match(resume, 'Engineering Manager', EM_JOB)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  assert.deepEqual(matrixReference(a), matrixReference(b))
  const listing = matchProfiles(extractCandidateProfile(resume), extractRoleProfile({ text: 'Open positions\nSenior Software Engineer\nStaff Engineer\nEngineering Manager\nData Analyst\nQA Engineer\nProduct Designer', title: null, source: pasted }))
  assert.equal(listing.rows.length, 0)
  assert.match(listing.explanation[0], /listing page/)
})

test('invariant over every fixture pair: nothing is established without professional evidence', () => {
  const pairs = [
    ...loadCases().map((c) => [c.candidate.resume_text, c.job.title, c.job.jd_text]),
    ...readdirSync('evals/matching/cases').map((f) => JSON.parse(readFileSync(`evals/matching/cases/${f}`, 'utf8'))).map((c) => [c.candidate.resume_text, c.job.title, c.job.text]),
  ]
  assert.ok(pairs.length >= 40)
  for (const [resume, title, text] of pairs) {
    const candidate = extractCandidateProfile(resume)
    const m = matchProfiles(candidate, extractRoleProfile({ text, title, source: pasted }))
    for (const r of m.rows) {
      assert.ok(r.requirement.normalized && typeof r.requirement.mandatory === 'boolean' && r.explanation, 'row fields')
      assert.ok(r.confidence >= 0 && r.confidence <= 1)
      assert.ok(['explicit', 'inferred', 'fallback'].includes(r.basis))
      if (r.status === 'unknown') assert.equal(r.evidence.length, 0, 'unknown rows cite no evidence')
      if (r.status !== 'strong' && r.status !== 'partial') continue
      assert.ok(r.evidence.length > 0 && r.evidence.every((e) => e.quotes.length > 0), `${r.requirement.normalized} established without quotes`)
      if (r.requirement.kind === 'skill') {
        const skill = candidate.explicit_skills.find((s) => r.requirement.concepts.includes(s.value))
        const capability = candidate.implicit_capabilities.find((c) => r.requirement.concepts.includes(c.value))
        assert.ok(skill?.rule === 'used_in_experience' || capability?.rule === 'responsibility_pattern', `${r.requirement.normalized} established from a list, course or student context`)
      }
    }
  }
})
