// Rollout guard, shadow comparison telemetry and historical-result compatibility.
import { LEGACY_SCORING_VERSION, VERDICT_V2_SCORING_VERSION, type Verdict, type VerdictEngineMode, type VerdictV2 } from './schema'

/**
 * VERDICT_ENGINE=legacy | shadow | v2. Unset or unrecognised → `shadow`: v2 is
 * computed and recorded, but the user-visible verdict stays legacy. `v2` is the
 * only value that changes what users see, and is not set anywhere in this sprint.
 */
export function verdictEngineMode(value: string | undefined = process.env.VERDICT_ENGINE): VerdictEngineMode {
  return value === 'legacy' || value === 'v2' ? value : 'shadow'
}

/** What a shadow run stores in analysis_json.verdict_v2. */
export type ShadowRecord =
  | ({ status: 'computed'; latency_ms: number } & VerdictV2)
  | { status: 'unavailable'; reason: 'no_candidate_profile' | 'no_role_profile' | 'not_a_job_page' | 'error'; scoring_version: string }

export function unavailable(reason: Extract<ShadowRecord, { status: 'unavailable' }>['reason']): ShadowRecord {
  return { status: 'unavailable', reason, scoring_version: VERDICT_V2_SCORING_VERSION }
}

/**
 * Comparison telemetry for one screened job — enums and numbers only.
 * Never includes resume text, job text, quotes, names or user identifiers.
 */
export interface ComparisonEvent {
  legacy_version: string
  legacy_verdict: Verdict
  legacy_composite: number
  v2_version: string
  v2_status: ShadowRecord['status']
  v2_verdict: Verdict | null
  v2_score: number | null
  v2_uncapped: Verdict | null
  blocker_kinds: string[]
  uncertainty: 'low' | 'medium' | 'high' | null
  agree: boolean | null
  latency_ms: number | null
}

export function comparisonEvent(legacy: { verdict: Verdict; composite_score: number }, shadow: ShadowRecord): ComparisonEvent {
  const computed = shadow.status === 'computed' ? shadow : null
  return {
    legacy_version: LEGACY_SCORING_VERSION,
    legacy_verdict: legacy.verdict,
    legacy_composite: legacy.composite_score,
    v2_version: shadow.scoring_version,
    v2_status: shadow.status,
    v2_verdict: computed?.verdict ?? null,
    v2_score: computed?.score ?? null,
    v2_uncapped: computed?.uncapped_verdict ?? null,
    blocker_kinds: computed ? [...new Set(computed.blockers.map((b) => b.kind))].sort() : [],
    uncertainty: computed?.uncertainty.level ?? null,
    agree: computed ? computed.verdict === legacy.verdict : null,
    latency_ms: computed ? computed.latency_ms : null,
  }
}

/**
 * Reads the active verdict of any stored screening result. Rows written before
 * Sprint 4 have no scoring_version: they are legacy results and stay as stored.
 */
export function readStoredVerdict(row: { verdict: Verdict; analysis_json?: Record<string, unknown> | null }): {
  verdict: Verdict; scoring_version: string; shadow: { verdict: Verdict; scoring_version: string } | null
} {
  const analysis = row.analysis_json ?? {}
  const version = typeof analysis.scoring_version === 'string' ? analysis.scoring_version : LEGACY_SCORING_VERSION
  const v2 = analysis.verdict_v2 as { status?: string; verdict?: Verdict; scoring_version?: string } | undefined
  const shadow = v2?.status === 'computed' && v2.verdict && v2.scoring_version ? { verdict: v2.verdict, scoring_version: v2.scoring_version } : null
  return { verdict: row.verdict, scoring_version: version, shadow }
}
