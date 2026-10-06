import { extractCandidateProfile, resumeSha256 } from './extract'
import {
  CANDIDATE_PROFILE_EXTRACTOR_VERSION,
  CANDIDATE_PROFILE_SCHEMA_VERSION,
  type CandidateIntelligenceProfile,
  type StoredCandidateProfile,
} from './schema'

export const CANDIDATE_PROFILE_COLUMNS = 'user_id, resume_sha256, schema_version, extractor_version, profile, updated_at'

/** Minimal slice of the Supabase client used here (keeps this testable without a database). */
export interface ProfileTable {
  from(table: 'candidate_profiles'): {
    select(columns: string): { eq(column: 'user_id', value: string): { maybeSingle(): PromiseLike<{ data: StoredCandidateProfile | null; error: { message: string; code?: string } | null }> } }
    upsert(row: StoredCandidateProfile, options: { onConflict: 'user_id' }): PromiseLike<{ error: { message: string; code?: string } | null }>
  }
}

export type ProfileStatus = 'reused' | 'built' | 'built_not_stored' | 'unavailable'

export interface EnsureResult {
  status: ProfileStatus
  profile: CandidateIntelligenceProfile | null
}

/** A stored profile is fresh only for the same resume content, schema and extractor version. */
export function isProfileFresh(row: Pick<StoredCandidateProfile, 'resume_sha256' | 'schema_version' | 'extractor_version'> | null, resumeHash: string): boolean {
  return !!row && row.resume_sha256 === resumeHash &&
    row.schema_version === CANDIDATE_PROFILE_SCHEMA_VERSION &&
    row.extractor_version === CANDIDATE_PROFILE_EXTRACTOR_VERSION
}

/**
 * Returns the caller's profile for this exact resume version, extracting it only
 * when none is stored or the stored one is stale (different resume, schema or
 * extractor version). Must be called with a server-side service-role client and
 * a user id taken from the authenticated session; writes are not open to users.
 *
 * Logs never include resume or profile content — only error codes/messages.
 */
export async function ensureCandidateProfile(
  db: ProfileTable,
  userId: string,
  resumeText: string,
  extract: (text: string) => CandidateIntelligenceProfile = extractCandidateProfile,
): Promise<EnsureResult> {
  if (!resumeText.trim()) return { status: 'unavailable', profile: null }
  const resumeHash = resumeSha256(resumeText)

  const { data: existing, error: readError } = await db.from('candidate_profiles').select(CANDIDATE_PROFILE_COLUMNS).eq('user_id', userId).maybeSingle()
  if (readError) {
    // Migration not applied yet, or storage down: keep the legacy flow working and
    // do not extract on every scan.
    console.warn('Candidate profile unavailable:', readError.code ?? 'error', readError.message)
    return { status: 'unavailable', profile: null }
  }
  if (existing && isProfileFresh(existing, resumeHash)) return { status: 'reused', profile: existing.profile }

  const profile = extract(resumeText)
  const { error: writeError } = await db.from('candidate_profiles').upsert({
    user_id: userId,
    resume_sha256: resumeHash,
    schema_version: CANDIDATE_PROFILE_SCHEMA_VERSION,
    extractor_version: CANDIDATE_PROFILE_EXTRACTOR_VERSION,
    profile,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (writeError) {
    console.warn('Candidate profile not stored:', writeError.code ?? 'error', writeError.message)
    return { status: 'built_not_stored', profile }
  }
  return { status: 'built', profile }
}

/** Compact, content-free reference returned to clients alongside screening results. */
export function profileReference(result: EnsureResult) {
  const profile = result.profile
  return {
    status: result.status,
    schema_version: profile?.schema_version ?? null,
    extractor_version: profile?.extractor.version ?? null,
    identity: profile?.identity?.value ?? null,
    current_level: profile?.seniority.current?.value ?? null,
    demonstrated_level: profile?.seniority.demonstrated?.value ?? null,
    unknowns: profile?.unknowns.length ?? null,
  }
}
