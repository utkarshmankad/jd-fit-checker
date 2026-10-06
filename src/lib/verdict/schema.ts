// Multidimensional fit verdict (v2): built from the requirement matrix and the
// candidate / role intelligence profiles instead of keyword overlap.
import type { AnalysisResult } from '@/types'

/** Scoring version of the legacy keyword scorer (src/lib/screening/fast-scorer.ts, jd-fit-api score_jd_fast). */
export const LEGACY_SCORING_VERSION = 'legacy-fast-1'
/** Bump whenever v2 rules, weights or bands change. */
export const VERDICT_V2_SCORING_VERSION = 'fit-v2-1'

export type Verdict = AnalysisResult['verdict']

export type DimensionKey =
  | 'identity' | 'seniority' | 'mandatory_coverage' | 'skills_capabilities' | 'leadership' | 'architecture'
  | 'hands_on' | 'domain' | 'delivery_stakeholder' | 'evidence_strength' | 'constraints'

export interface Dimension {
  /** 0–100; null when nothing in this dimension could be judged. */
  score: number | null
  /** Weight in the overall score (0 when the role does not ask for it). */
  weight: number
  /** Matrix rows (normalised requirements) that determined this dimension. */
  drivers: string[]
  note: string
}

export type BlockerKind =
  | 'hard_constraint' | 'identity_mismatch' | 'role_family_mismatch' | 'seniority_shortfall' | 'mandatory_gap'
  | 'mandatory_claims_only' | 'not_hands_on' | 'insufficient_evidence'

export interface Blocker {
  kind: BlockerKind
  /** Highest verdict allowed while this blocker stands. */
  cap: Verdict
  reason: string
}

export interface VerdictV2 {
  scoring_version: string
  verdict: Verdict
  /** Weighted dimension score before caps (0–100). */
  score: number
  /** Verdict from the score alone, before blockers capped it. */
  uncapped_verdict: Verdict
  dimensions: Record<DimensionKey, Dimension>
  blockers: Blocker[]
  strongest_matches: string[]
  important_gaps: string[]
  transferable_strengths: string[]
  uncertainty: { unknown_share: number; level: 'low' | 'medium' | 'high'; note: string }
  explanation: string[]
}

/** Engine selection — the rollout guard. Default `shadow`: users keep seeing the legacy verdict. */
export type VerdictEngineMode = 'legacy' | 'shadow' | 'v2'
