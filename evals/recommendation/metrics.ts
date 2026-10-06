import { createHash } from 'node:crypto'
import type { EvalCase, SeniorityFit, Verdict } from './cases'

/** The minimal scorer output the harness understands (both fast scorers return a superset). */
export interface ScorerOutput {
  verdict: Verdict
  role_level_score: number
  hard_reject_reasons: string[]
  /** Optional future fields: when a scorer starts emitting these, they are used directly. */
  role_identity_aligned?: boolean
  seniority_fit?: SeniorityFit
}

export interface Prediction {
  verdict: Verdict
  role_identity_aligned: boolean
  seniority_fit: SeniorityFit
  /** Which fields were emitted by the scorer vs derived by the harness. */
  derived: Array<'role_identity_aligned' | 'seniority_fit'>
}

export interface CaseRun {
  id: string
  /** One fingerprint per repeat of the full scorer output. */
  fingerprints: string[]
  /** One per-job latency (ms) per repeat. */
  latenciesMs: number[]
  prediction: Prediction
}

export interface SuiteRun {
  scorer: string
  repeats: number
  cases: CaseRun[]
  /** Wall-clock ms to score the whole batch once, one entry per repeat. */
  batchMs: number[]
}

const POSITIVE = new Set<Verdict>(['STRONG', 'DECENT'])
export const isPositive = (verdict: Verdict) => POSITIVE.has(verdict)

/**
 * Maps raw scorer output to the evaluated dimensions. The current fast scorers
 * have no role-identity model and can only say "meets" or "below" for seniority
 * (role_level_score 92 = level gap <= 0), so those are derived here and flagged.
 */
export function normalize(output: ScorerOutput): Prediction {
  const derived: Prediction['derived'] = []
  let seniority = output.seniority_fit
  if (!seniority) {
    seniority = output.role_level_score >= 92 ? 'fit' : 'under'
    derived.push('seniority_fit')
  }
  let identity = output.role_identity_aligned
  if (identity === undefined) {
    identity = !output.hard_reject_reasons.some((reason) => /role type|below .* level/i.test(reason))
    derived.push('role_identity_aligned')
  }
  return { verdict: output.verdict, role_identity_aligned: identity, seniority_fit: seniority, derived }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
  }
  return value
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0, 16)
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits))
const ratio = (num: number, den: number) => (den ? round(num / den) : 0)

export interface Metrics {
  cases: number
  verdict_agreement: number
  false_positive_rate: number
  false_negative_rate: number
  role_identity_accuracy: number
  seniority_accuracy: number
  deterministic_repeatability: number
  suite_fingerprint: string
  counts: { expected_positive: number; expected_negative: number; false_positive: number; false_negative: number }
  by_category: Record<string, { cases: number; verdict_agreement: number }>
  confusion: Record<Verdict, Record<Verdict, number>>
  latency_ms: { per_job_p50: number; per_job_p95: number; per_job_max: number; batch_median: number; batch_max: number }
  derived_dimensions: string[]
  disagreements: Array<{ id: string; expected: Verdict; predicted: Verdict }>
}

export function computeMetrics(cases: EvalCase[], run: SuiteRun): Metrics {
  const byId = new Map(run.cases.map((item) => [item.id, item]))
  const confusion = Object.fromEntries((['STRONG', 'DECENT', 'WEAK', 'REJECT'] as Verdict[]).map((v) => [v, { STRONG: 0, DECENT: 0, WEAK: 0, REJECT: 0 }])) as Metrics['confusion']
  let agree = 0, identity = 0, seniority = 0, repeatable = 0, fp = 0, fn = 0, pos = 0, neg = 0
  const categories: Record<string, { cases: number; agree: number }> = {}
  const disagreements: Metrics['disagreements'] = []
  const derived = new Set<string>()
  for (const c of cases) {
    const result = byId.get(c.id)
    if (!result) throw new Error(`missing result for ${c.id}`)
    const predicted = result.prediction
    result.prediction.derived.forEach((name) => derived.add(name))
    confusion[c.expected.verdict][predicted.verdict] += 1
    const bucket = (categories[c.category] ??= { cases: 0, agree: 0 })
    bucket.cases += 1
    if (predicted.verdict === c.expected.verdict) {
      agree += 1
      bucket.agree += 1
    } else {
      disagreements.push({ id: c.id, expected: c.expected.verdict, predicted: predicted.verdict })
    }
    if (isPositive(c.expected.verdict)) {
      pos += 1
      if (!isPositive(predicted.verdict)) fn += 1
    } else {
      neg += 1
      if (isPositive(predicted.verdict)) fp += 1
    }
    if (predicted.role_identity_aligned === c.expected.role_identity_aligned) identity += 1
    if (predicted.seniority_fit === c.expected.seniority_fit) seniority += 1
    if (result.fingerprints.length && result.fingerprints.every((value) => value === result.fingerprints[0])) repeatable += 1
  }
  const latencies = run.cases.flatMap((item) => item.latenciesMs)
  const n = cases.length
  return {
    cases: n,
    verdict_agreement: ratio(agree, n),
    false_positive_rate: ratio(fp, neg),
    false_negative_rate: ratio(fn, pos),
    role_identity_accuracy: ratio(identity, n),
    seniority_accuracy: ratio(seniority, n),
    deterministic_repeatability: ratio(repeatable, n),
    suite_fingerprint: fingerprint(cases.map((c) => [c.id, byId.get(c.id)!.fingerprints[0]])),
    counts: { expected_positive: pos, expected_negative: neg, false_positive: fp, false_negative: fn },
    by_category: Object.fromEntries(Object.entries(categories).sort().map(([key, value]) => [key, { cases: value.cases, verdict_agreement: ratio(value.agree, value.cases) }])),
    confusion,
    latency_ms: {
      per_job_p50: round(percentile(latencies, 50), 3),
      per_job_p95: round(percentile(latencies, 95), 3),
      per_job_max: round(percentile(latencies, 100), 3),
      batch_median: round(percentile(run.batchMs, 50), 3),
      batch_max: round(percentile(run.batchMs, 100), 3),
    },
    derived_dimensions: [...derived].sort(),
    disagreements,
  }
}

/** Quality metrics that must never get worse without an intentional baseline update. */
export const QUALITY_KEYS = ['verdict_agreement', 'role_identity_accuracy', 'seniority_accuracy', 'deterministic_repeatability'] as const
export const ERROR_KEYS = ['false_positive_rate', 'false_negative_rate'] as const

export function compareToBaseline(current: Metrics, baseline: Pick<Metrics, (typeof QUALITY_KEYS)[number] | (typeof ERROR_KEYS)[number] | 'disagreements'>): string[] {
  const regressions: string[] = []
  for (const key of QUALITY_KEYS) if (current[key] < baseline[key]) regressions.push(`${key} dropped ${baseline[key]} -> ${current[key]}`)
  for (const key of ERROR_KEYS) if (current[key] > baseline[key]) regressions.push(`${key} rose ${baseline[key]} -> ${current[key]}`)
  if (current.deterministic_repeatability < 1) regressions.push('scorer output is not deterministic across repeats')
  const previouslyDisagreeing = new Set(baseline.disagreements.map((item) => item.id))
  for (const item of current.disagreements) {
    if (!previouslyDisagreeing.has(item.id)) regressions.push(`${item.id} now disagrees (expected ${item.expected}, got ${item.predicted})`)
  }
  return regressions
}
