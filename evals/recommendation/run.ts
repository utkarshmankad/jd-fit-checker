// Recommendation evaluation suite. See evals/recommendation/README.md.
//   npm run eval:recommendation                      # frontend scorer, summary
//   npm run eval:recommendation -- --check-baseline  # fail on quality regressions
//   JD_FIT_API_DIR=../jd-fit-api npm run eval:recommendation   # + backend scorer
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { scoreJobFast } from '@/lib/screening/fast-scorer'
import { extractCandidateProfile, tracedItems } from '@/lib/candidate-profile/extract'
import { extractRoleProfile, roleTracedItems } from '@/lib/role-profile/extract'
import { matchProfiles } from '@/lib/matching/engine'
import { computeVerdictV2 } from '@/lib/verdict/engine'
import type { HardRejectFilters } from '@/types'
import { loadCases, type EvalCase } from './cases'
import { compareToBaseline, computeMetrics, fingerprint, normalize, type Metrics, type ScorerOutput, type SuiteRun } from './metrics'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const BASELINE_PATH = path.join(HERE, 'baseline.json')

interface Options { repeats: number; checkBaseline: boolean; writeBaseline: boolean; json: string | null; apiDir: string | null }

function parseArgs(argv: string[]): Options {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const apiDir = value('--api-dir') ?? process.env.JD_FIT_API_DIR ?? null
  return {
    repeats: Math.max(2, Number(value('--repeats') ?? 5)),
    checkBaseline: argv.includes('--check-baseline'),
    writeBaseline: argv.includes('--write-baseline'),
    json: value('--json') ?? null,
    apiDir: apiDir ? path.resolve(apiDir) : null,
  }
}

function runFrontend(cases: EvalCase[], repeats: number): SuiteRun {
  const score = (c: EvalCase) => scoreJobFast({
    jdText: c.job.jd_text, resumeText: c.candidate.resume_text, filters: c.candidate.filters as unknown as HardRejectFilters,
    jobTitle: c.job.title, company: c.job.company, evidence: [], corrections: [],
  })
  cases.forEach(score) // untimed warm-up pass so JIT compilation is not billed to the first case
  const perCase = new Map(cases.map((c) => [c.id, { fingerprints: [] as string[], latenciesMs: [] as number[], output: null as ScorerOutput | null }]))
  const batchMs: number[] = []
  for (let r = 0; r < repeats; r += 1) {
    const batchStart = performance.now()
    for (const c of cases) {
      const t0 = performance.now()
      const output = score(c)
      const elapsed = performance.now() - t0
      const slot = perCase.get(c.id)!
      slot.fingerprints.push(fingerprint(output)); slot.latenciesMs.push(elapsed); slot.output = output
    }
    batchMs.push(performance.now() - batchStart)
  }
  return { scorer: 'frontend:scoreJobFast', repeats, batchMs, cases: cases.map((c) => { const s = perCase.get(c.id)!; return { id: c.id, fingerprints: s.fingerprints, latenciesMs: s.latenciesMs, prediction: normalize(s.output!) } }) }
}

/**
 * Fit verdict v2 end to end, as the screen route would run it for a fresh job:
 * candidate + role profile extraction, requirement matching, verdict. Hard-reject
 * reasons come from the legacy filter rules so constraints are judged identically.
 */
function runV2(cases: EvalCase[], repeats: number): SuiteRun {
  const pasted = { kind: 'pasted' as const, provider: null, canonical_url: null }
  const score = (c: EvalCase): ScorerOutput & Record<string, unknown> => {
    const legacy = scoreJobFast({ jdText: c.job.jd_text, resumeText: c.candidate.resume_text, filters: c.candidate.filters as unknown as HardRejectFilters, jobTitle: c.job.title, company: c.job.company, evidence: [], corrections: [] })
    const candidate = extractCandidateProfile(c.candidate.resume_text)
    const role = extractRoleProfile({ text: c.job.jd_text, title: c.job.title, source: pasted })
    const matrix = matchProfiles(candidate, role)
    const v2 = computeVerdictV2({ matrix, candidate, role, hardRejectReasons: legacy.hard_reject_reasons })
    const identity = matrix.rows.find((r) => r.requirement.kind === 'identity')
    const seniority = matrix.rows.find((r) => r.requirement.kind === 'seniority')
    const level = candidate.seniority.demonstrated?.value ?? candidate.seniority.current?.value ?? null
    return {
      ...v2, hard_reject_reasons: legacy.hard_reject_reasons,
      role_level_score: v2.dimensions.seniority.score ?? 0,
      // Unknown identity/seniority defaults to aligned/fit (no evidence of a mismatch).
      role_identity_aligned: !identity || !['explicit_gap', 'transferable'].includes(identity.status),
      seniority_fit: !seniority || seniority.status === 'strong' || seniority.status === 'unknown' ? 'fit'
        : level !== null && seniority.requirement.required !== null && level > seniority.requirement.required ? 'over' : 'under',
    }
  }
  cases.forEach(score) // untimed warm-up
  const perCase = new Map(cases.map((c) => [c.id, { fingerprints: [] as string[], latenciesMs: [] as number[], output: null as ScorerOutput | null }]))
  const batchMs: number[] = []
  for (let r = 0; r < repeats; r += 1) {
    const batchStart = performance.now()
    for (const c of cases) {
      const t0 = performance.now(); const output = score(c); const elapsed = performance.now() - t0
      const slot = perCase.get(c.id)!
      slot.fingerprints.push(fingerprint(output)); slot.latenciesMs.push(elapsed); slot.output = output
    }
    batchMs.push(performance.now() - batchStart)
  }
  return { scorer: 'v2:fit-verdict', repeats, batchMs, cases: cases.map((c) => { const s = perCase.get(c.id)!; return { id: c.id, fingerprints: s.fingerprints, latenciesMs: s.latenciesMs, prediction: normalize(s.output!) } }) }
}

function runBackend(cases: EvalCase[], repeats: number, apiDir: string): SuiteRun {
  const python = process.env.JD_FIT_PYTHON ?? [path.join(apiDir, 'venv/bin/python'), path.join(apiDir, '.venv/bin/python')].find(existsSync) ?? 'python3'
  const proc = spawnSync(python, [path.join(HERE, 'adapters/backend_fast.py'), apiDir], { input: JSON.stringify({ repeats, cases }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (proc.status !== 0) throw new Error(`backend adapter failed (${python}):\n${proc.stderr}`)
  const { runs } = JSON.parse(proc.stdout) as { runs: Array<{ batch_ms: number; items: Array<{ id: string; ms: number; output: ScorerOutput }> }> }
  return {
    scorer: 'backend:score_jd_fast', repeats, batchMs: runs.map((run) => run.batch_ms),
    cases: cases.map((c) => {
      const items = runs.map((run) => run.items.find((item) => item.id === c.id)!)
      return { id: c.id, fingerprints: items.map((item) => fingerprint(item.output)), latenciesMs: items.map((item) => item.ms), prediction: normalize(items[items.length - 1].output) }
    }),
  }
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

// Fixture candidate identities -> Candidate Intelligence Profile identities. Career
// transitions are judged per case elsewhere, so they are excluded from identity accuracy.
const PROFILE_IDENTITY: Record<string, string> = {
  ic: 'ic', staff_ic: 'ic', principal_ic: 'ic', analyst: 'ic', qa: 'ic', tech_lead: 'technical_lead',
  people_manager: 'people_manager', senior_people_manager: 'people_manager',
}

/** Informational (not gated): how well the candidate profile recovers fixture ground truth. */
function profileReport(cases: EvalCase[]) {
  const started = performance.now()
  const profiles = cases.map((c) => ({ c, p: extractCandidateProfile(c.candidate.resume_text) }))
  const ms = performance.now() - started
  const identityCases = profiles.filter(({ c }) => PROFILE_IDENTITY[c.candidate.role_identity])
  const identityHits = identityCases.filter(({ c, p }) => p.identity?.value === PROFILE_IDENTITY[c.candidate.role_identity])
  const levelHits = profiles.filter(({ c, p }) => p.seniority.current?.value === c.candidate.level)
  const levelNear = profiles.filter(({ c, p }) => p.seniority.current && Math.abs(p.seniority.current.value - c.candidate.level) <= 1)
  const transitions = profiles.filter(({ c }) => c.profile_type === 'career_transition')
  const items = profiles.flatMap(({ p }) => tracedItems(p))
  return {
    cases: cases.length,
    identity_accuracy: identityHits.length / identityCases.length,
    identity_cases: identityCases.length,
    identity_misses: identityCases.filter((x) => !identityHits.includes(x)).map(({ c, p }) => `${c.id} ${PROFILE_IDENTITY[c.candidate.role_identity]}->${p.identity?.value ?? 'unknown'}`),
    current_level_exact: levelHits.length / cases.length,
    current_level_within_1: levelNear.length / cases.length,
    transitions_detected: transitions.filter(({ p }) => p.career_transition).length,
    transitions: transitions.length,
    traced_items: items.length,
    traced_items_with_evidence: items.filter(({ item }) => item.evidence.length > 0 && item.confidence > 0).length,
    extraction_ms_total: Number(ms.toFixed(2)),
  }
}

function printSummary(name: string, m: Metrics) {
  console.log(`\n${name}  (${m.cases} cases, fingerprint ${m.suite_fingerprint})`)
  console.log(`  verdict agreement      ${pct(m.verdict_agreement)}   by category: ${Object.entries(m.by_category).map(([k, v]) => `${k} ${pct(v.verdict_agreement)}`).join(', ')}`)
  console.log(`  false-positive rate    ${pct(m.false_positive_rate)}  (${m.counts.false_positive}/${m.counts.expected_negative} expected WEAK/REJECT predicted STRONG/DECENT)`)
  console.log(`  false-negative rate    ${pct(m.false_negative_rate)}  (${m.counts.false_negative}/${m.counts.expected_positive} expected STRONG/DECENT predicted WEAK/REJECT)`)
  console.log(`  role-identity accuracy ${pct(m.role_identity_accuracy)}${m.derived_dimensions.includes('role_identity_aligned') ? '  [derived: scorer has no role-identity output]' : ''}`)
  console.log(`  seniority accuracy     ${pct(m.seniority_accuracy)}${m.derived_dimensions.includes('seniority_fit') ? '  [derived from role_level_score; cannot express "over"]' : ''}`)
  console.log(`  repeatability          ${pct(m.deterministic_repeatability)}`)
  console.log(`  latency per job        p50 ${m.latency_ms.per_job_p50}ms  p95 ${m.latency_ms.per_job_p95}ms  max ${m.latency_ms.per_job_max}ms`)
  console.log(`  latency per batch      median ${m.latency_ms.batch_median}ms  max ${m.latency_ms.batch_max}ms`)
  if (m.disagreements.length) console.log(`  disagreements          ${m.disagreements.map((d) => `${d.id} ${d.expected}->${d.predicted}`).join('; ')}`)
}

/** Informational (not gated): how well the role profile recovers fixture job ground truth. */
function roleReport(cases: EvalCase[]) {
  const started = performance.now()
  const profiles = cases.map((c) => ({ c, p: extractRoleProfile({ text: c.job.jd_text, title: c.job.title, source: { kind: 'pasted', provider: null, canonical_url: null } }) }))
  const ms = performance.now() - started
  const identityCases = profiles.filter(({ c }) => PROFILE_IDENTITY[c.job.role_identity])
  const identityHits = identityCases.filter(({ c, p }) => p.identity?.value === PROFILE_IDENTITY[c.job.role_identity])
  const items = profiles.flatMap(({ p }) => roleTracedItems(p))
  return {
    cases: cases.length,
    job_pages: profiles.filter(({ p }) => p.page.value === 'job_page').length,
    identity_accuracy: identityHits.length / identityCases.length,
    identity_misses: identityCases.filter((x) => !identityHits.includes(x)).map(({ c, p }) => `${c.id} ${PROFILE_IDENTITY[c.job.role_identity]}->${p.identity?.value ?? 'unknown'}`),
    target_level_exact: profiles.filter(({ c, p }) => p.seniority.target?.value === c.job.level).length / cases.length,
    target_level_within_1: profiles.filter(({ c, p }) => p.seniority.target && Math.abs(p.seniority.target.value - c.job.level) <= 1).length / cases.length,
    compensation_captured: profiles.filter(({ p }) => p.compensation).length,
    contradictions: profiles.reduce((sum, { p }) => sum + p.contradictions.filter((x) => x.kind !== 'ambiguity').length, 0),
    traced_items: items.length,
    traced_items_with_evidence: items.filter(({ item }) => item.evidence.length > 0 && item.confidence > 0).length,
    extraction_ms_total: Number(ms.toFixed(2)),
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const cases = loadCases()
  const results: Record<string, Metrics> = {}
  const frontend = runFrontend(cases, options.repeats)
  results[frontend.scorer] = computeMetrics(cases, frontend)
  if (options.apiDir) {
    const backend = runBackend(cases, options.repeats, options.apiDir)
    results[backend.scorer] = computeMetrics(cases, backend)
  }
  const v2 = runV2(cases, options.repeats)
  results[v2.scorer] = computeMetrics(cases, v2)
  console.log(`Recommendation eval: ${cases.length} cases x ${options.repeats} repeats  (node ${process.version}, ${process.platform}/${process.arch})`)
  for (const [name, metrics] of Object.entries(results)) printSummary(name, metrics)
  if (!options.apiDir) console.log('\n(backend scorer skipped: set JD_FIT_API_DIR or --api-dir to include jd-fit-api)')
  const profile = profileReport(cases)
  console.log(`\ncandidate profile (informational, not gated; not used for scoring yet)`)
  console.log(`  identity accuracy      ${pct(profile.identity_accuracy)} of ${profile.identity_cases} non-transition cases${profile.identity_misses.length ? `  misses: ${profile.identity_misses.join('; ')}` : ''}`)
  console.log(`  current level          exact ${pct(profile.current_level_exact)}, within one level ${pct(profile.current_level_within_1)}`)
  console.log(`  career transitions     ${profile.transitions_detected}/${profile.transitions} detected`)
  console.log(`  traced items           ${profile.traced_items_with_evidence}/${profile.traced_items} carry evidence and confidence; extraction ${profile.extraction_ms_total}ms for all ${profile.cases} resumes`)

  const role = roleReport(cases)
  console.log(`\nrole profile (informational, not gated; not used for scoring yet)`)
  console.log(`  job pages              ${role.job_pages}/${role.cases} pasted fixtures classified as job pages`)
  console.log(`  identity accuracy      ${pct(role.identity_accuracy)}${role.identity_misses.length ? `  misses: ${role.identity_misses.join('; ')}` : ''}`)
  console.log(`  target level           exact ${pct(role.target_level_exact)}, within one level ${pct(role.target_level_within_1)}`)
  console.log(`  compensation captured  ${role.compensation_captured} (fixtures state no pay; any capture is a false positive)`)
  console.log(`  contradictions         ${role.contradictions} title/scope contradictions flagged`)
  console.log(`  traced items           ${role.traced_items_with_evidence}/${role.traced_items} carry evidence and confidence; extraction ${role.extraction_ms_total}ms for all ${role.cases} jobs`)
  if (options.json) writeFileSync(options.json, `${JSON.stringify({ ...results, candidate_profile: profile, role_profile: role }, null, 2)}\n`)
  if (options.writeBaseline) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ recorded_with: { cases: cases.length, repeats: options.repeats, node: process.version, platform: `${process.platform}/${process.arch}` }, scorers: results }, null, 2)}\n`)
    console.log(`\nWrote ${path.relative(process.cwd(), BASELINE_PATH)}`)
  }
  if (options.checkBaseline) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { scorers: Record<string, Metrics> }
    const failures = Object.entries(results).flatMap(([name, metrics]) => {
      const reference = baseline.scorers[name]
      if (!reference) return [`${name}: no baseline recorded`]
      return compareToBaseline(metrics, reference).map((problem) => `${name}: ${problem}`)
    })
    if (failures.length) {
      console.error(`\nBASELINE REGRESSION (${failures.length}):\n  ${failures.join('\n  ')}`)
      process.exitCode = 1
    } else {
      console.log('\nBaseline check passed (no quality regression; latency is reported, not gated).')
    }
  }
}

main()
