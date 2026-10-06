// Candidate Intelligence Profile — versioned, evidence-first representation of a
// candidate's professional identity, derived once per resume version.
//
// Every non-unknown value carries:
//   basis      'explicit' (stated in the resume) or 'inferred' (derived by a named rule)
//   confidence 0..1, conservative; inferred values are capped below explicit ones
//   evidence   verbatim resume quotes with character offsets into the normalised text
//   rule       the extraction rule that produced it (provenance)
// Anything the resume does not support is listed in `unknowns` instead of guessed.

/** Bump when the stored JSON shape changes incompatibly. */
export const CANDIDATE_PROFILE_SCHEMA_VERSION = 1
/** Bump whenever extraction rules change; stored profiles with another version are rebuilt. */
export const CANDIDATE_PROFILE_EXTRACTOR_VERSION = 'cip-deterministic-1'

export type Basis = 'explicit' | 'inferred'

export interface EvidenceRef {
  /** Index of the chunk the quote came from (chunks cover the entire resume). */
  chunk: number
  /** Offsets into the normalised resume text; `text.slice(start, end) === quote`. */
  start: number
  end: number
  quote: string
}

export interface Traced<T> {
  value: T
  basis: Basis
  confidence: number
  rule: string
  evidence: EvidenceRef[]
}

export type ProfessionalIdentity = 'ic' | 'technical_lead' | 'people_manager' | 'executive' | 'hybrid'
export type RoleFamily = 'engineering' | 'qa' | 'data_analysis' | 'data_science' | 'product' | 'non_technical'

/** 1 intern, 2 junior, 3 mid, 4 senior / tech lead / manager, 5 staff / senior manager / director, 6 principal / VP+. */
export type SeniorityLevel = 1 | 2 | 3 | 4 | 5 | 6
export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  1: 'intern', 2: 'junior', 3: 'mid', 4: 'senior', 5: 'staff / senior manager / director', 6: 'principal / executive',
}

export type ScopeLevel = 'low' | 'medium' | 'high'

export interface Scope extends Traced<ScopeLevel> {
  /** True when the resume explicitly states the opposite (e.g. "has not written production code"). */
  negated: boolean
}

export interface RoleEntry {
  title: string
  start_year: number | null
  end_year: number | null
  is_current: boolean
  evidence: EvidenceRef[]
}

export interface CandidateIntelligenceProfile {
  schema_version: number
  extractor: { method: 'deterministic'; version: string; ai_assisted: false }
  source: { resume_sha256: string; characters: number; chunks: number; max_chunk_chars: number }

  identity: Traced<ProfessionalIdentity> | null
  identity_signals: Record<'ic' | 'technical_lead' | 'people_manager' | 'executive', number>
  /** Function of the most recent role, e.g. engineering vs QA vs data analysis vs product. */
  role_family: Traced<RoleFamily> | null
  career_transition: Traced<string> | null

  seniority: {
    /** Level of the most recent role title. */
    current: Traced<SeniorityLevel> | null
    /** Level supported by demonstrated scope (team size, managers of managers, cross-team / org-wide work). */
    demonstrated: Traced<SeniorityLevel> | null
  }

  explicit_skills: Array<Traced<string>>
  implicit_capabilities: Array<Traced<string>>

  scopes: {
    leadership: Scope | null
    architecture: Scope | null
    hands_on: Scope | null
    product_stakeholder: Scope | null
    delivery_ownership: Scope | null
  }

  team: {
    largest_team_size: Traced<number> | null
    has_direct_reports: Traced<boolean> | null
    manages_managers: Traced<boolean> | null
  }

  domains: Array<Traced<string>>
  outcomes: Array<Traced<string>>

  experience: {
    total_years: Traced<number> | null
    roles: RoleEntry[]
    most_recent_activity_year: Traced<number> | null
  }

  /** Dotted field paths that the resume gave no evidence for. */
  unknowns: string[]
}

export interface StoredCandidateProfile {
  user_id: string
  resume_sha256: string
  schema_version: number
  extractor_version: string
  profile: CandidateIntelligenceProfile
  updated_at?: string
}
