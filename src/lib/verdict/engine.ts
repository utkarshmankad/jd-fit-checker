// Fit verdict v2: deterministic, transparent, multidimensional.
//
//   1. Dimension scores (0–100) from the requirement matrix and the profiles.
//      `unknown` rows are excluded from scores and reported as uncertainty.
//   2. Weighted overall score → band: ≥ 80 STRONG, ≥ 60 DECENT, else WEAK.
//   3. Deterministic blockers cap the band. A cap can only lower the verdict, so
//      a high keyword/skill score can never erase an identity or seniority
//      mismatch and a critical missing requirement is never averaged away.
//   4. Hard constraints (the user's own deal-breakers, title floor, location …)
//      force REJECT, exactly as the legacy scorer does.
import type { CandidateIntelligenceProfile } from '@/lib/candidate-profile/schema'
import type { MatchStatus, RequirementMatch, RequirementMatrix } from '@/lib/matching/schema'
import type { RoleIntelligenceProfile } from '@/lib/role-profile/schema'
import {
  VERDICT_V2_SCORING_VERSION,
  type Blocker, type Dimension, type DimensionKey, type Verdict, type VerdictV2,
} from './schema'

export const BANDS = { STRONG: 80, DECENT: 60 } as const
export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  identity: 0.16, seniority: 0.14, mandatory_coverage: 0.2, skills_capabilities: 0.1, leadership: 0.1,
  architecture: 0.06, hands_on: 0.08, domain: 0.03, delivery_stakeholder: 0.05, evidence_strength: 0.08,
  constraints: 0, // gates only (hard constraints force REJECT); never averaged
}
const VALUE: Record<Exclude<MatchStatus, 'unknown'>, number> = { strong: 1, partial: 0.6, transferable: 0.35, unsupported: 0.1, explicit_gap: 0 }
const ORDER: Verdict[] = ['REJECT', 'WEAK', 'DECENT', 'STRONG']
const lower = (a: Verdict, b: Verdict): Verdict => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b)

export interface VerdictInput {
  matrix: RequirementMatrix
  candidate: CandidateIntelligenceProfile
  role: RoleIntelligenceProfile
  /** Hard-reject reasons from the user's filters (same rules as the legacy scorer). */
  hardRejectReasons: string[]
}

const name = (r: RequirementMatch) => r.requirement.normalized.replace(/^Skill: /, '')

function dimension(rows: RequirementMatch[], weight: number, note: string): Dimension {
  const judged = rows.filter((r) => r.status !== 'unknown')
  const total = judged.reduce((s, r) => s + r.weight, 0)
  const score = judged.length && total > 0
    ? Math.round((100 * judged.reduce((s, r) => s + r.weight * VALUE[r.status as Exclude<MatchStatus, 'unknown'>], 0)) / total)
    : null
  return { score, weight: rows.length ? weight : 0, drivers: rows.map((r) => `${r.requirement.normalized}: ${r.status}`), note }
}

export function bandFor(score: number): Verdict {
  return score >= BANDS.STRONG ? 'STRONG' : score >= BANDS.DECENT ? 'DECENT' : 'WEAK'
}

export function computeVerdictV2({ matrix, candidate, role, hardRejectReasons }: VerdictInput): VerdictV2 {
  const rows = matrix.rows
  const of = (...kinds: string[]) => rows.filter((r) => kinds.includes(r.requirement.kind))
  const overallYears = rows.filter((r) => r.requirement.kind === 'experience_years' && !r.requirement.concepts.length)
  const leadershipRows = [...of('people_management', 'manages_managers', 'technical_leadership'), ...rows.filter((r) => r.requirement.kind === 'experience_years' && r.requirement.concepts.includes('People Management'))]

  // Delivery & stakeholder scope comes straight from the two profiles.
  const scopeRows: Array<{ label: string; value: number | null }> = []
  for (const [roleKey, candKey, label] of [['stakeholder_product', 'product_stakeholder', 'Product & stakeholder influence'], ['delivery_ownership', 'delivery_ownership', 'Delivery ownership']] as const) {
    const need = role.expectations[roleKey]
    if (!need || need.negated || need.value === 'low') continue
    const have = candidate.scopes[candKey]
    scopeRows.push({ label, value: !have ? null : have.negated ? 0 : have.rule === 'non_professional_context_only' ? 0.1 : have.value === 'low' ? 0.6 : 1 })
  }
  const judgedScope = scopeRows.filter((s) => s.value !== null)
  const delivery: Dimension = {
    score: judgedScope.length ? Math.round((100 * judgedScope.reduce((s, x) => s + (x.value ?? 0), 0)) / judgedScope.length) : null,
    weight: scopeRows.length ? DIMENSION_WEIGHTS.delivery_stakeholder : 0,
    drivers: scopeRows.map((s) => `${s.label}: ${s.value === null ? 'unknown' : s.value >= 1 ? 'strong' : s.value >= 0.6 ? 'partial' : 'weak'}`),
    note: 'Role expectations for stakeholder influence and delivery ownership vs the candidate\'s demonstrated scope.',
  }

  const unknownShare = rows.length ? rows.filter((r) => r.status === 'unknown').length / rows.length : 1
  const established = rows.filter((r) => r.status === 'strong' || r.status === 'partial')
  const quality = established.length ? established.reduce((s, r) => s + (r.basis === 'explicit' ? 1 : r.basis === 'inferred' ? 0.75 : 0.4), 0) / established.length : 0
  const evidence: Dimension = {
    score: rows.length ? Math.round(100 * (1 - unknownShare) * (established.length ? quality : 0.5)) : null,
    weight: DIMENSION_WEIGHTS.evidence_strength,
    drivers: [`${established.length} established, ${rows.filter((r) => r.status === 'unknown').length} unknown of ${rows.length} requirements`],
    note: 'How much of the role could be judged, and how directly the evidence is stated.',
  }

  const dimensions: Record<DimensionKey, Dimension> = {
    identity: dimension(of('identity', 'role_family'), DIMENSION_WEIGHTS.identity, 'Professional identity (IC, lead, manager, executive) and role family.'),
    seniority: dimension([...of('seniority'), ...overallYears], DIMENSION_WEIGHTS.seniority, 'Demonstrated level and years against the role.'),
    mandatory_coverage: dimension(rows.filter((r) => r.requirement.mandatory), DIMENSION_WEIGHTS.mandatory_coverage, 'Every must-have requirement.'),
    skills_capabilities: dimension(of('skill', 'capability'), DIMENSION_WEIGHTS.skills_capabilities, 'Tools and capabilities (bounded: cannot outweigh identity or seniority).'),
    leadership: dimension(leadershipRows, DIMENSION_WEIGHTS.leadership, 'People management, managing managers and technical leadership when the role asks for them.'),
    architecture: dimension(of('architecture'), DIMENSION_WEIGHTS.architecture, 'System-design scope.'),
    hands_on: dimension(of('hands_on'), DIMENSION_WEIGHTS.hands_on, 'Hands-on execution when the role is hands-on.'),
    domain: dimension(of('domain'), DIMENSION_WEIGHTS.domain, 'Industry / problem-domain relevance.'),
    delivery_stakeholder: delivery,
    evidence_strength: evidence,
    constraints: { score: hardRejectReasons.length ? 0 : 100, weight: 0, drivers: hardRejectReasons, note: 'The user\'s own deal-breakers and filters. Gate only: any hit forces REJECT.' },
  }

  const scored = Object.values(dimensions).filter((d) => d.weight > 0 && d.score !== null)
  const weightSum = scored.reduce((s, d) => s + d.weight, 0)
  const score = weightSum ? Math.round(scored.reduce((s, d) => s + d.weight * (d.score as number), 0) / weightSum) : 0
  const uncapped = bandFor(score)

  // Deterministic blockers.
  const blockers: Blocker[] = []
  const block = (kind: Blocker['kind'], cap: Verdict, reason: string) => blockers.push({ kind, cap, reason })
  if (hardRejectReasons.length) block('hard_constraint', 'REJECT', hardRejectReasons[0])
  const identity = of('identity')[0]
  if (identity?.status === 'explicit_gap') block('identity_mismatch', 'WEAK', identity.explanation)
  else if (identity && (identity.status === 'partial' || identity.status === 'transferable')) block('identity_mismatch', 'DECENT', identity.explanation)
  const family = of('role_family')[0]
  if (family?.status === 'explicit_gap') block('role_family_mismatch', 'WEAK', family.explanation)
  else if (family?.status === 'transferable') block('role_family_mismatch', 'DECENT', family.explanation)
  const seniority = of('seniority')[0]
  if (seniority?.status === 'explicit_gap') block('seniority_shortfall', 'WEAK', seniority.explanation)
  else if (seniority && (seniority.status === 'partial' || seniority.status === 'unsupported')) block('seniority_shortfall', 'DECENT', seniority.explanation)
  for (const r of overallYears) if (r.status === 'explicit_gap') block('seniority_shortfall', 'WEAK', r.explanation)
  for (const r of rows) {
    if (!r.requirement.mandatory || r.status !== 'explicit_gap') continue
    if (['identity', 'role_family', 'seniority'].includes(r.requirement.kind) || overallYears.includes(r)) continue
    block(r.requirement.kind === 'hands_on' ? 'not_hands_on' : 'mandatory_gap', 'WEAK', `${r.requirement.normalized}: ${r.explanation}`)
  }
  const claimsOnly = rows.filter((r) => r.requirement.mandatory && r.status === 'unsupported' && r.requirement.kind !== 'seniority')
  if (claimsOnly.length >= 2) block('mandatory_claims_only', 'WEAK', `Must-haves only claimed, not shown in work: ${claimsOnly.slice(0, 3).map(name).join(', ')}.`)
  else if (claimsOnly.length === 1) block('mandatory_claims_only', 'DECENT', `Must-have only claimed, not shown in work: ${name(claimsOnly[0])}.`)
  // STRONG needs the job's own must-have lines to be judgeable; structural rows
  // (identity, family, seniority) are always present and must not dilute this.
  const mandatoryLines = rows.filter((r) => r.requirement.mandatory && r.requirement.origin === 'requirement_line')
  const linesUnknown = mandatoryLines.filter((r) => r.status === 'unknown').length
  if (!rows.length || unknownShare >= 0.45 || (mandatoryLines.length >= 1 && linesUnknown / mandatoryLines.length > 0.5)) {
    block('insufficient_evidence', 'DECENT', 'Too many must-haves cannot be judged from the resume, so this cannot be rated STRONG.')
  }

  const verdict = hardRejectReasons.length ? 'REJECT' : blockers.reduce<Verdict>((v, b) => lower(v, b.cap), uncapped)
  const strongest = rows.filter((r) => r.status === 'strong' && r.requirement.mandatory).sort((a, b) => b.weight - a.weight || a.requirement.id.localeCompare(b.requirement.id)).slice(0, 4).map(name)
  const gaps = [...new Set([...blockers.map((b) => b.reason), ...rows.filter((r) => r.requirement.mandatory && r.status === 'explicit_gap').map((r) => `${name(r)}: ${r.explanation}`)])].slice(0, 4)
  const transferable = rows.filter((r) => r.status === 'transferable').slice(0, 3).map((r) => `${name(r)} — ${r.explanation}`)
  const level = unknownShare < 0.2 ? 'low' : unknownShare < 0.45 ? 'medium' : 'high'
  const unknownCount = rows.filter((r) => r.status === 'unknown').length
  const explanation = [
    `${verdict}${verdict !== uncapped && verdict !== 'REJECT' ? ` (score ${score} alone would be ${uncapped}; capped by ${blockers.filter((b) => b.cap === verdict).map((b) => b.kind.replace(/_/g, ' ')).join(', ')})` : ` (score ${score})`}.`,
    ...(strongest.length ? [`Strongest matches: ${strongest.join(', ')}.`] : []),
    ...(gaps.length ? [`Important gaps: ${gaps.slice(0, 2).join(' ')}`] : []),
    ...(transferable.length ? [`Transferable: ${transferable.slice(0, 2).map((t) => t.split(' — ')[0]).join(', ')}.`] : []),
    ...(unknownCount ? [`Uncertainty ${level}: ${unknownCount} of ${rows.length} requirements cannot be judged from the resume.`] : []),
  ]

  return {
    scoring_version: VERDICT_V2_SCORING_VERSION,
    verdict, score, uncapped_verdict: uncapped, dimensions, blockers,
    strongest_matches: strongest, important_gaps: gaps, transferable_strengths: transferable,
    uncertainty: { unknown_share: Number(unknownShare.toFixed(2)), level, note: unknownCount ? 'Unknown means the resume says nothing either way — it is not counted as missing.' : 'Every requirement could be judged.' },
    explanation,
  }
}
