// Requirement-matching matrix: for every important role requirement, what the
// candidate has actually demonstrated. Built from a Candidate Intelligence
// Profile and a Role Intelligence Profile; deterministic and evidence-traced.
import type { EvidenceRef } from '@/lib/candidate-profile/schema'

/** Bump whenever matching rules or weights change. */
export const MATCHING_ENGINE_VERSION = 'match-deterministic-1'

export type MatchStatus =
  | 'strong'          // demonstrated in professional evidence at the required level
  | 'partial'         // demonstrated, but below the required level, duration or breadth
  | 'transferable'    // an adjacent capability is demonstrated; not the requirement itself
  | 'unsupported'     // claimed (skills list, course, student context) but not demonstrated
  | 'explicit_gap'    // the resume states the opposite, or a measurable shortfall
  | 'unknown'         // no evidence either way — never treated as "does not have"

export type RequirementKind =
  | 'skill' | 'experience_years' | 'identity' | 'role_family' | 'seniority' | 'people_management' | 'manages_managers'
  | 'technical_leadership' | 'architecture' | 'hands_on' | 'domain' | 'capability' | 'education' | 'other'

/** Where the conclusion came from. */
export type ConclusionBasis = 'explicit' | 'inferred' | 'fallback'

export interface RoleRequirement {
  id: string
  kind: RequirementKind
  /** Normalised requirement, e.g. "Skill: Kafka", "People management", "Seniority ≥ level 4". */
  normalized: string
  /** Concept keys this requirement needs; `any_of` means one of them suffices ("Go or Java"). */
  concepts: string[]
  any_of: boolean
  mandatory: boolean
  /** Role-side origin: an explicit requirement line or a structural attribute of the role. */
  origin: 'requirement_line' | 'role_structure'
  role_evidence: EvidenceRef[]
  /** Required quantity when stated (years, level, team size). */
  required: number | null
}

export interface CandidateEvidence {
  /** Candidate-profile field the evidence came from, e.g. "explicit_skills", "team.has_direct_reports". */
  source: string
  /** Concept or value demonstrated. */
  value: string
  quotes: EvidenceRef[]
}

export interface Recency {
  role_title: string | null
  start_year: number | null
  end_year: number | null
  is_current: boolean | null
  /** Candidate's total years when the requirement is about duration. */
  total_years: number | null
}

export interface RequirementMatch {
  requirement: RoleRequirement
  status: MatchStatus
  basis: ConclusionBasis
  confidence: number
  evidence: CandidateEvidence[]
  recency: Recency | null
  explanation: string
  /** Contribution weight used by the summary score (mandatory > preferred; skills capped). */
  weight: number
}

export interface MatchSummary {
  /** 0–100, weighted by requirement importance; informational until Sprint 4. */
  fit_score: number
  mandatory: Record<MatchStatus, number>
  preferred: Record<MatchStatus, number>
  /** Share of total weight carried by tool/skill rows (capped so tool overlap cannot dominate). */
  skill_weight_share: number
  /** Mandatory requirements with an explicit gap or only unsupported claims. */
  blocking_gaps: string[]
}

export interface RequirementMatrix {
  engine_version: string
  candidate: { schema_version: number; extractor_version: string; resume_sha256: string }
  role: { schema_version: number; extractor_version: string; content_sha256: string; page_kind: string }
  rows: RequirementMatch[]
  summary: MatchSummary
  /** Concise user-facing explanation. */
  explanation: string[]
}

/** Compact, quote-free reference stored with screening results. */
export interface RequirementMatchReference {
  engine_version: string
  fit_score: number
  mandatory: Record<MatchStatus, number>
  preferred: Record<MatchStatus, number>
  blocking_gaps: string[]
  explanation: string[]
}
