-- ============================================================
-- 011_role_profiles.sql
-- Role Intelligence Profile cache (src/lib/role-profile): one versioned,
-- evidence-traced profile per distinct job content, keyed by the sha256 of
-- the normalised title + meaningful job text, so identical jobs (same posting
-- seen by many users, or re-screened) are extracted once.
--
-- Security contract:
--   * Server-only cache: no anon / authenticated access at all; the service
--     role reads and writes it from /api/screen.
--   * Rows carry no user id. source_text is the cleaned job description the
--     evidence offsets refer to (the same job text screening_results already
--     stores per user); raw_sha256 records exactly which raw input produced it.
--
-- Atomic: run the whole file at once (SQL editor) — any error rolls back.
-- ============================================================

begin;

create table if not exists public.role_profiles (
  content_sha256    text primary key check (content_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version    integer not null check (schema_version > 0),
  extractor_version text not null check (char_length(extractor_version) between 1 and 64),
  page_kind         text not null check (page_kind in ('job_page', 'listing_page', 'search_page', 'closed_posting')),
  source_kind       text not null check (source_kind in ('url', 'pasted')),
  provider          text check (provider is null or char_length(provider) <= 255),
  canonical_url     text check (canonical_url is null or char_length(canonical_url) <= 2048),
  source_text       text not null check (char_length(source_text) <= 60000),
  raw_sha256        text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  profile           jsonb not null check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 524288),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.role_profiles enable row level security;

revoke all on table public.role_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.role_profiles to service_role;

commit;

-- ROLLBACK:
-- Drops the cache only; screening keeps working and profiles are rebuilt
-- (uncached) per request until the table exists again.
--   begin;
--   drop table if exists public.role_profiles;
--   commit;
