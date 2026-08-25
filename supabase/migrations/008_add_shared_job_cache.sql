-- Shared cache for public job descriptions. Access is service-role only: the
-- cache is shared across users, but is never directly exposed through the
-- browser-facing Data API.
create table if not exists public.job_description_cache (
  id              uuid primary key default gen_random_uuid(),
  canonical_url   text not null unique,
  provider        text not null default 'generic',
  external_job_id text,
  job_title       text,
  company         text,
  jd_text         text not null check (char_length(jd_text) between 100 and 100000),
  content_hash    text not null,
  extraction      text not null check (extraction in ('structured', 'ats', 'generic', 'render')),
  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists job_description_cache_external_job_idx
  on public.job_description_cache(provider, external_job_id)
  where external_job_id is not null;
create index if not exists job_description_cache_expiry_idx
  on public.job_description_cache(expires_at);

alter table public.job_description_cache enable row level security;
revoke all on table public.job_description_cache from public, anon, authenticated;

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.job_description_cache;
