// Recommendation evaluation suite. See evals/recommendation/README.md.
//   npm run eval:recommendation                      # frontend scorer, summary
//   npm run eval:recommendation -- --check-baseline  # fail on quality regressions
//   JD_FIT_API_DIR=../jd-fit-api npm run eval:recommendation   # + backend scorer
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { scoreJobFast } from '@/lib/screening/fast-scorer'
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
  console.log(`Recommendation eval: ${cases.length} cases x ${options.repeats} repeats  (node ${process.version}, ${process.platform}/${process.arch})`)
  for (const [name, metrics] of Object.entries(results)) printSummary(name, metrics)
  if (!options.apiDir) console.log('\n(backend scorer skipped: set JD_FIT_API_DIR or --api-dir to include jd-fit-api)')

  if (options.json) writeFileSync(options.json, `${JSON.stringify(results, null, 2)}\n`)
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
