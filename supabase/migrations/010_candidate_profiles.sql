-- ============================================================
-- 010_candidate_profiles.sql
-- Candidate Intelligence Profile: one versioned, evidence-traced profile per
-- user, derived from the stored resume (src/lib/candidate-profile).
--
-- Security contract:
--   * anon: no access.
--   * authenticated: SELECT own row only (RLS). No INSERT/UPDATE/DELETE —
--     the profile is server-derived from the resume, so users must not be
--     able to forge identity, seniority or capabilities.
--   * service_role: full access (explicit grants; BYPASSRLS does not cover
--     table privileges on projects with restricted defaults).
-- The profile contains resume quotes, so it is as sensitive as resume_text and
-- must never be logged or exposed to other users.
--
-- Atomic: run the whole file at once (SQL editor) — any error rolls back.
-- ============================================================

begin;

create table if not exists public.candidate_profiles (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  resume_sha256     text not null check (resume_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version    integer not null check (schema_version > 0),
  extractor_version text not null check (char_length(extractor_version) between 1 and 64),
  profile           jsonb not null check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 524288),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.candidate_profiles enable row level security;

revoke all on table public.candidate_profiles from public, anon, authenticated;
grant select on table public.candidate_profiles to authenticated;
grant select, insert, update, delete on table public.candidate_profiles to service_role;

drop policy if exists "candidate_profiles_select_own" on public.candidate_profiles;
create policy "candidate_profiles_select_own" on public.candidate_profiles
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

commit;

-- ROLLBACK:
-- Drops every stored profile; the app falls back to the legacy flow and
-- rebuilds profiles lazily if the table is recreated.
--   begin;
--   drop table if exists public.candidate_profiles;
--   commit;
