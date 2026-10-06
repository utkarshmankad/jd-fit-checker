import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type Verdict = 'STRONG' | 'DECENT' | 'WEAK' | 'REJECT'
export type SeniorityFit = 'fit' | 'under' | 'over'
export type DimensionFit = 'fit' | 'partial' | 'gap' | 'over' | 'n/a'

export const VERDICTS: Verdict[] = ['STRONG', 'DECENT', 'WEAK', 'REJECT']
export const CATEGORIES = ['strong_match', 'borderline', 'misleading_keyword'] as const
export const PROFILE_TYPES = ['ic', 'tech_lead', 'people_manager', 'senior_people_manager', 'staff_ic', 'principal_ic', 'career_transition'] as const

export interface EvalCase {
  id: string
  title: string
  category: (typeof CATEGORIES)[number]
  profile_type: (typeof PROFILE_TYPES)[number]
  candidate: {
    label: string
    role_identity: string
    level: number
    years_experience: number
    resume_text: string
    filters: Record<string, unknown>
  }
  job: { title: string; company: string; role_identity: string; level: number; jd_text: string }
  expected: {
    verdict: Verdict
    role_identity_aligned: boolean
    seniority_fit: SeniorityFit
    leadership_scope_fit: DimensionFit
    hands_on_fit: DimensionFit
    domain_fit: DimensionFit
    evidence_strength: 'strong' | 'moderate' | 'weak'
    explicit_skills: string[]
    implicit_capabilities: string[]
    reason: string
  }
}

export const CASES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'cases')

const DIMENSION_VALUES: DimensionFit[] = ['fit', 'partial', 'gap', 'over', 'n/a']

/** Returns a list of human-readable problems; empty means the case is valid. */
export function validateCase(value: unknown, file = '<inline>'): string[] {
  const problems: string[] = []
  const fail = (message: string) => problems.push(`${file}: ${message}`)
  const c = value as EvalCase
  if (!c || typeof c !== 'object') return [`${file}: not an object`]
  if (!/^[a-z]{2}-\d{2}-[a-z0-9-]+$/.test(c.id ?? '')) fail('id must look like "ic-01-short-slug"')
  if (`${c.id}.json` !== path.basename(file) && file !== '<inline>') fail('file name must equal id')
  if (!CATEGORIES.includes(c.category)) fail(`category must be one of ${CATEGORIES.join(', ')}`)
  if (!PROFILE_TYPES.includes(c.profile_type)) fail(`profile_type must be one of ${PROFILE_TYPES.join(', ')}`)
  if (!c.candidate?.resume_text || c.candidate.resume_text.length < 80) fail('candidate.resume_text too short')
  if (!/^Candidate [A-Z]{2}-\d{2}$/.test(c.candidate?.label ?? '')) fail('candidate.label must be an anonymous "Candidate XX-00" label')
  if (!c.job?.jd_text || c.job.jd_text.length < 60) fail('job.jd_text too short')
  if (!Number.isInteger(c.candidate?.level) || !Number.isInteger(c.job?.level)) fail('levels must be integers (1 intern ... 6 principal)')
  const e = c.expected
  if (!e) return [...problems, `${file}: expected missing`]
  if (!VERDICTS.includes(e.verdict)) fail('expected.verdict invalid')
  if (typeof e.role_identity_aligned !== 'boolean') fail('expected.role_identity_aligned must be boolean')
  if (!['fit', 'under', 'over'].includes(e.seniority_fit)) fail('expected.seniority_fit invalid')
  for (const key of ['leadership_scope_fit', 'hands_on_fit', 'domain_fit'] as const) if (!DIMENSION_VALUES.includes(e[key])) fail(`expected.${key} invalid`)
  if (!['strong', 'moderate', 'weak'].includes(e.evidence_strength)) fail('expected.evidence_strength invalid')
  if (!Array.isArray(e.explicit_skills) || !Array.isArray(e.implicit_capabilities)) fail('expected skill lists must be arrays')
  if (!e.reason || e.reason.length > 220) fail('expected.reason must be present and concise (<=220 chars)')
  return problems
}

export function loadCases(dir = CASES_DIR): EvalCase[] {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  const cases = files.map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as EvalCase)
  const problems = cases.flatMap((value, index) => validateCase(value, files[index]))
  const ids = new Set<string>()
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`duplicate id ${c.id}`)
    ids.add(c.id)
  }
  if (problems.length) throw new Error(`Invalid evaluation fixtures:\n${problems.join('\n')}`)
  return cases
}
