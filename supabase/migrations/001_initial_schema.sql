-- Migration: 001_initial_schema
-- Description: profiles, screening_results, shared_results (superseded by
--   shared_reports, see section 7), job_tracker, tier constraint fix
-- Applied to dev:  [fill in date]
-- Applied to prod: [fill in date]
--
-- NOTE: This migration is already applied to both environments. It is
-- recorded here for history only. Do NOT run this on an existing database.

-- ──────────────────────────────────────────────────────────
-- 1. profiles
--    One row per auth.users user. Created automatically via
--    the trigger below whenever a new user signs up.
-- ──────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text not null,
  full_name               text,
  resume_text             text,
  api_key_encrypted       text,
  api_provider            text check (api_provider in ('openai', 'anthropic')) default 'anthropic',
  hard_reject_filters     jsonb default '{}'::jsonb,
  preferences             jsonb default '{}'::jsonb,
  tier                    text check (tier in ('free', 'pro')) default 'free',
  screens_used_this_month integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Row-level security
alter table public.profiles enable row level security;

-- Users can read and write only their own profile
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ──────────────────────────────────────────────────────────
-- 2. Auto-create profile on sign-up
--    Fires after every insert into auth.users.
--    Pulls email + full_name from user_metadata (set by
--    Google OAuth or by the /auth/register form).
-- ──────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop trigger if it already exists so this script is idempotent
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ──────────────────────────────────────────────────────────
-- 3. screening_results
--    One row per JD screened. Grouped into batches via
--    batch_id (a UUID the frontend generates per submission).
-- ──────────────────────────────────────────────────────────
create table if not exists public.screening_results (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  batch_id            uuid not null,
  job_url             text,
  job_title           text,
  company             text,
  jd_text             text,
  ats_score           integer not null default 0,
  role_level_score    integer not null default 0,
  composite_score     integer not null default 0,
  verdict             text not null check (verdict in ('STRONG', 'DECENT', 'WEAK', 'REJECT')),
  hard_reject_reasons text[] default '{}',
  analysis_json       jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists screening_results_user_id_idx
  on public.screening_results(user_id);

create index if not exists screening_results_batch_id_idx
  on public.screening_results(batch_id);

create index if not exists screening_results_created_at_idx
  on public.screening_results(created_at desc);

-- Row-level security
alter table public.screening_results enable row level security;

create policy "screening_results_select_own" on public.screening_results
  for select using (auth.uid() = user_id);

create policy "screening_results_insert_own" on public.screening_results
  for insert with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────
-- 4. shared_results
--    Stores share tokens so /share/<token> is publicly readable.
--    Superseded by shared_reports (section 7) — the app no longer
--    references this table, kept here only for schema history.
-- ──────────────────────────────────────────────────────────
create table if not exists public.shared_results (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

alter table public.shared_results enable row level security;

-- Owner can create share tokens
create policy "shared_results_insert_own" on public.shared_results
  for insert with check (auth.uid() = user_id);

-- Anyone can read a shared result by token (for /share/<token> page)
create policy "shared_results_select_all" on public.shared_results
  for select using (true);

-- ──────────────────────────────────────────────────────────
-- 5. Helper: reset screens_used_this_month on the 1st of
--    each month. Schedule this via Supabase's pg_cron
--    extension (Database > Extensions > pg_cron, then run):
--
--    select cron.schedule(
--      'reset-monthly-screens',
--      '0 0 1 * *',
--      $$update public.profiles set screens_used_this_month = 0$$
--    );
-- ──────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────
-- 6. Fix profiles.tier check constraint + add pending_order_id
--
--    a) profiles.tier check constraint only allowed ('free', 'pro')
--       but every payment route in the app writes tier = 'paid' —
--       that update was violating this constraint and silently
--       failing in production.
--    b) Adds profiles.pending_order_id so /api/payment/verify can
--       confirm the Razorpay order_id being verified was actually
--       issued to the requesting user, not just that its signature
--       is valid.
-- ──────────────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_tier_check;
alter table public.profiles add constraint profiles_tier_check check (tier in ('free', 'paid'));

alter table public.profiles add column if not exists pending_order_id text;

-- ──────────────────────────────────────────────────────────
-- 7. shared_reports — the table actually used by
--    /api/share and /api/report/[slug] in the live app.
-- ──────────────────────────────────────────────────────────
create table if not exists public.shared_reports (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  batch_id         uuid not null,
  slug             text not null unique,
  results_snapshot jsonb not null default '[]'::jsonb,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

create index if not exists shared_reports_slug_idx on public.shared_reports(slug);

alter table public.shared_reports enable row level security;

-- Owner can create their own share links (defense in depth — the
-- route currently always writes via the service-role client, which
-- bypasses RLS, but this keeps the table safe if that ever changes).
create policy "shared_reports_insert_own" on public.shared_reports
  for insert with check (auth.uid() = user_id);

-- Public can read by slug (route filters expiry in application code).
create policy "shared_reports_select_all" on public.shared_reports
  for select using (true);

-- ──────────────────────────────────────────────────────────
-- 8. job_tracker
--    Manual application-tracking table. One row per job the
--    user chose to track from a screening result.
-- ──────────────────────────────────────────────────────────
create table if not exists public.job_tracker (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  screening_result_id uuid references public.screening_results(id) on delete set null,
  job_title           text,
  company             text,
  job_url             text,
  status              text not null check (status in ('Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn')) default 'Applied',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists job_tracker_user_id_idx on public.job_tracker(user_id);

-- Prevent duplicate tracker entries for the same screening result — only
-- applies when screening_result_id is set (manual/orphaned rows can repeat).
create unique index if not exists job_tracker_user_screening_result_idx
  on public.job_tracker(user_id, screening_result_id)
  where screening_result_id is not null;

alter table public.job_tracker enable row level security;

drop policy if exists "job_tracker_select_own" on public.job_tracker;
create policy "job_tracker_select_own" on public.job_tracker
  for select using (auth.uid() = user_id);

drop policy if exists "job_tracker_insert_own" on public.job_tracker;
create policy "job_tracker_insert_own" on public.job_tracker
  for insert with check (auth.uid() = user_id);

drop policy if exists "job_tracker_update_own" on public.job_tracker;
create policy "job_tracker_update_own" on public.job_tracker
  for update using (auth.uid() = user_id);

drop policy if exists "job_tracker_delete_own" on public.job_tracker;
create policy "job_tracker_delete_own" on public.job_tracker
  for delete using (auth.uid() = user_id);

-- ROLLBACK (run on a fresh DB only):
-- DROP TABLE IF EXISTS public.job_tracker;
-- DROP TABLE IF EXISTS public.shared_reports;
-- DROP TABLE IF EXISTS public.shared_results;
-- DROP TABLE IF EXISTS public.screening_results;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS pending_order_id;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user();
-- DROP TABLE IF EXISTS public.profiles;
