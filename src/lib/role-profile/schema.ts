// Role Intelligence Profile — versioned, evidence-traced structure of one job
// description. Shares its vocabulary with the Candidate Intelligence Profile
// (identity, role family, seniority scale, Traced values) so the two can be
// compared field by field in a later sprint.
import type { EvidenceRef, ProfessionalIdentity, RoleFamily, Scope, SeniorityLevel, Traced } from '@/lib/candidate-profile/schema'

export type { EvidenceRef, ProfessionalIdentity, RoleFamily, Scope, SeniorityLevel, Traced }

/** Bump when the stored JSON shape changes incompatibly. */
export const ROLE_PROFILE_SCHEMA_VERSION = 1
/** Bump whenever extraction rules change; cached profiles with another version are rebuilt. */
export const ROLE_PROFILE_EXTRACTOR_VERSION = 'rip-deterministic-1'

export type PageKind = 'job_page' | 'listing_page' | 'search_page' | 'closed_posting' | 'inaccessible' | 'insufficient_content'
export type SourceKind = 'url' | 'pasted'

export interface RoleSource {
  kind: SourceKind
  /** ATS or host, for provenance only — extraction never branches on it. */
  provider: string | null
  canonical_url: string | null
}

export interface PageAssessment extends Traced<PageKind> {
  reasons: string[]
}

export type RequirementCategory = 'experience' | 'skill' | 'education' | 'leadership' | 'domain' | 'other'

export interface Requirement extends Traced<string> {
  category: RequirementCategory
  skills: string[]
  years: { minimum: number; maximum: number | null; area: string | null } | null
}

export interface Contradiction {
  kind: 'title_vs_responsibilities' | 'title_vs_experience' | 'reports_conflict' | 'work_mode_conflict' | 'hands_on_vs_title' | 'ambiguity'
  description: string
  evidence: EvidenceRef[]
}

export interface Compensation {
  raw: string
  currency: string | null
  minimum: string
  maximum: string
  period: 'year' | 'month' | 'hour' | 'day'
}

export interface RoleIntelligenceProfile {
  schema_version: number
  extractor: { method: 'deterministic'; version: string; ai_assisted: false }
  source: RoleSource & {
    /** Cache key: sha256 of the normalised title + meaningful text. */
    content_sha256: string
    raw_characters: number
    meaningful_characters: number
    /** Navigation / boilerplate / unrelated-listing lines excluded before extraction. */
    removed_lines: number
    chunks: number
  }
  page: PageAssessment
  title: string | null

  role_family: Traced<RoleFamily> | null
  identity: Traced<ProfessionalIdentity> | null
  identity_signals: { hands_on: number; technical_lead: number; people_manager: number; executive: number; ic_statements: number }

  seniority: {
    /** Floor implied by mandatory years of experience. */
    minimum: Traced<SeniorityLevel> | null
    /** Level the role is pitched at (title, then scope). */
    target: Traced<SeniorityLevel> | null
  }

  mandatory_requirements: Requirement[]
  preferred_requirements: Requirement[]
  responsibilities: Array<Traced<string>>

  balance: (Traced<'hands_on' | 'balanced' | 'leadership'> & { hands_on_percent: number | null }) | null
  expectations: {
    hands_on: Scope | null
    architecture: Scope | null
    people_management: Scope | null
    stakeholder_product: Scope | null
    delivery_ownership: Scope | null
  }
  team: {
    direct_reports: Traced<number> | null
    manages_managers: Traced<boolean> | null
  }

  domains: Array<Traced<string>>
  experience: {
    minimum_years: Traced<number> | null
    maximum_years: Traced<number> | null
    by_area: Array<Traced<{ years: number; area: string }>>
  }
  constraints: {
    education: Array<Traced<string>>
    location: Array<Traced<string>>
    work_mode: Traced<'remote' | 'hybrid' | 'onsite'> | null
    work_authorisation: Array<Traced<string>>
  }
  compensation: Traced<Compensation> | null

  contradictions: Contradiction[]
  unknowns: string[]
}

/** Compact, content-free reference attached to screening results. */
export interface RoleProfileReference {
  status: 'reused' | 'built' | 'built_not_stored' | 'not_cached' | 'unavailable'
  content_sha256: string | null
  schema_version: number | null
  extractor_version: string | null
  page_kind: PageKind | null
  identity: ProfessionalIdentity | null
  target_level: SeniorityLevel | null
  minimum_years: number | null
  contradictions: number | null
}
