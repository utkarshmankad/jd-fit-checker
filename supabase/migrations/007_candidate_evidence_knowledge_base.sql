-- Phase 1: private per-candidate evidence knowledge base.
--
-- Resume-sized evidence sets are intentionally retrieved as a bounded set and
-- hybrid-ranked in the screening service. The compact real[] embedding avoids
-- a remote embedding dependency on the latency-sensitive path. If evidence
-- sets later grow beyond resume scale, this column can be migrated to pgvector
-- and queried with an owner-filtered RPC without changing the API contract.
create table if not exists public.candidate_evidence (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  source_hash   text not null,
  chunk_index   integer not null check (chunk_index >= 0),
  evidence_type text not null check (evidence_type in ('summary', 'experience', 'achievement', 'skills', 'education', 'other')),
  content       text not null check (char_length(content) between 1 and 2000),
  skills        text[] not null default '{}',
  embedding     real[] not null,
  metadata      jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, source_hash, chunk_index),
  check (cardinality(embedding) = 192)
);

create index if not exists candidate_evidence_user_id_idx
  on public.candidate_evidence(user_id);

create index if not exists candidate_evidence_search_idx
  on public.candidate_evidence using gin(search_vector);

create index if not exists candidate_evidence_skills_idx
  on public.candidate_evidence using gin(skills);

alter table public.candidate_evidence enable row level security;

revoke all on table public.candidate_evidence from anon, authenticated;
grant select, insert, update, delete on table public.candidate_evidence to authenticated;

drop policy if exists "candidate_evidence_select_own" on public.candidate_evidence;
create policy "candidate_evidence_select_own" on public.candidate_evidence
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "candidate_evidence_insert_own" on public.candidate_evidence;
create policy "candidate_evidence_insert_own" on public.candidate_evidence
  for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "candidate_evidence_update_own" on public.candidate_evidence;
create policy "candidate_evidence_update_own" on public.candidate_evidence
  for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "candidate_evidence_delete_own" on public.candidate_evidence;
create policy "candidate_evidence_delete_own" on public.candidate_evidence
  for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.candidate_evidence;

