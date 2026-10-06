import { createHash } from 'node:crypto'
import { extractRoleProfile, prepareRoleText, type RoleInput } from './extract'
import {
  ROLE_PROFILE_EXTRACTOR_VERSION, ROLE_PROFILE_SCHEMA_VERSION,
  type PageKind, type RoleIntelligenceProfile, type RoleProfileReference,
} from './schema'

export const ROLE_PROFILE_COLUMNS = 'content_sha256, schema_version, extractor_version, profile'

/**
 * Pages worth caching. Inaccessible / insufficient pages are usually transient
 * (bot walls, partial loads), so they are re-evaluated next time instead.
 */
export const CACHEABLE_PAGES: PageKind[] = ['job_page', 'listing_page', 'search_page', 'closed_posting']

interface CachedRow { content_sha256: string; schema_version: number; extractor_version: string; profile: RoleIntelligenceProfile }
interface DbError { message: string; code?: string }

/** Minimal slice of the Supabase client used here (keeps this testable without a database). */
export interface RoleProfileTable {
  from(table: 'role_profiles'): {
    select(columns: string): { in(column: 'content_sha256', values: string[]): PromiseLike<{ data: CachedRow[] | null; error: DbError | null }> }
    upsert(rows: Record<string, unknown>[], options: { onConflict: 'content_sha256' }): PromiseLike<{ error: DbError | null }>
  }
}

export type RoleProfileStatus = RoleProfileReference['status']
export interface RoleProfileResult { status: RoleProfileStatus; profile: RoleIntelligenceProfile | null }

const fresh = (row: CachedRow | undefined) => !!row && row.schema_version === ROLE_PROFILE_SCHEMA_VERSION && row.extractor_version === ROLE_PROFILE_EXTRACTOR_VERSION

/**
 * Returns a role profile for each input, keyed by normalised content hash:
 * one read for the whole batch, extraction only for content not cached at the
 * current schema/extractor version, and one upsert for the new rows. Identical
 * content inside the batch is extracted once. Storage failures never block
 * screening: profiles are still returned, just not cached.
 *
 * Logs contain counts and error codes/messages only — never job text.
 */
export async function ensureRoleProfiles(
  db: RoleProfileTable,
  inputs: RoleInput[],
  extract: (input: RoleInput) => RoleIntelligenceProfile = extractRoleProfile,
): Promise<RoleProfileResult[]> {
  const prepared = inputs.map((input) => (input.text.trim() ? prepareRoleText(input) : null))
  const hashes = [...new Set(prepared.filter((p): p is NonNullable<typeof p> => !!p).map((p) => p.contentSha256))]
  if (!hashes.length) return inputs.map(() => ({ status: 'unavailable', profile: null }))

  let cached = new Map<string, CachedRow>()
  let storage = true
  const { data, error } = await db.from('role_profiles').select(ROLE_PROFILE_COLUMNS).in('content_sha256', hashes)
  if (error) {
    storage = false
    console.warn('Role profile cache unavailable:', error.code ?? 'error', error.message)
  } else {
    cached = new Map((data ?? []).map((row) => [row.content_sha256, row]))
  }

  const built = new Map<string, RoleProfileResult>()
  const rows: Record<string, unknown>[] = []
  const results = inputs.map((input, index): RoleProfileResult => {
    const prep = prepared[index]
    if (!prep) return { status: 'unavailable', profile: null }
    const row = cached.get(prep.contentSha256)
    if (fresh(row)) return { status: 'reused', profile: row!.profile }
    const already = built.get(prep.contentSha256)
    if (already) return already
    const profile = extract(input)
    const cacheable = storage && CACHEABLE_PAGES.includes(profile.page.value)
    const result: RoleProfileResult = { status: cacheable ? 'built' : storage ? 'not_cached' : 'built_not_stored', profile }
    built.set(prep.contentSha256, result)
    if (cacheable) {
      rows.push({
        content_sha256: prep.contentSha256,
        schema_version: ROLE_PROFILE_SCHEMA_VERSION,
        extractor_version: ROLE_PROFILE_EXTRACTOR_VERSION,
        page_kind: profile.page.value,
        source_kind: input.source.kind,
        provider: input.source.provider,
        canonical_url: input.source.kind === 'url' ? input.source.canonical_url : null,
        source_text: prep.text,
        raw_sha256: createHash('sha256').update(input.text).digest('hex'),
        profile,
        updated_at: new Date().toISOString(),
      })
    }
    return result
  })

  if (rows.length) {
    const { error: writeError } = await db.from('role_profiles').upsert(rows, { onConflict: 'content_sha256' })
    if (writeError) {
      console.warn('Role profiles not cached:', writeError.code ?? 'error', writeError.message, `(${rows.length} rows)`)
      for (const result of built.values()) if (result.status === 'built') result.status = 'built_not_stored'
    }
  }
  return results
}

/** Compact, content-free reference attached to screening results. */
export function roleProfileReference(result: RoleProfileResult): RoleProfileReference {
  const p = result.profile
  return {
    status: result.status,
    content_sha256: p?.source.content_sha256 ?? null,
    schema_version: p?.schema_version ?? null,
    extractor_version: p?.extractor.version ?? null,
    page_kind: p?.page.value ?? null,
    identity: p?.identity?.value ?? null,
    target_level: p?.seniority.target?.value ?? null,
    minimum_years: p?.experience.minimum_years?.value ?? null,
    contradictions: p ? p.contradictions.length : null,
  }
}
