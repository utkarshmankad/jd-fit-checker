-- ============================================================
-- schema.sql — jd-fit-checker
-- Complete current schema — reflects everything applied so far,
-- including changes with no numbered migration file yet (see
-- supabase/migrations/README.md "Note on history").
-- Last updated: 2026-07-16
-- To use: run this on a fresh Supabase project to create all
-- tables, indexes, RLS policies, and functions.
-- ============================================================

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
-- 6. MIGRATION — run in Supabase SQL Editor even if the tables
--    above already exist. Safe / idempotent.
--
--    a) profiles.tier check constraint only allowed
--       ('free', 'pro') but every payment route in the app
--       writes tier = 'paid' — that update has been violating
--       this constraint and silently failing in production.
--    b) Adds profiles.pending_order_id so /api/payment/verify
--       can confirm the Razorpay order_id being verified was
--       actually issued to the requesting user, not just that
--       its signature is valid (signature alone doesn't prove
--       order ownership if the order/payment/signature triple
--       leaks via logs, referrers, etc.).
-- ──────────────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_tier_check;
alter table public.profiles add constraint profiles_tier_check check (tier in ('free', 'paid'));

alter table public.profiles add column if not exists pending_order_id text;

-- ──────────────────────────────────────────────────────────
-- 7. shared_reports — the table actually used by
--    /api/share and /api/report/[slug] in the live app.
--    This schema.sql previously only documented an older
--    "shared_results" (token-based) design that the code no
--    longer references; this section syncs the doc to reality.
--    Columns/shape reconstructed from route usage — verify
--    against the live table before relying on this section.
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
--    user chose to track from a screening result. Denormalizes
--    job_title/company/job_url so tracker entries survive even
--    if the linked screening_results row is ever deleted.
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

-- ──────────────────────────────────────────────────────────
-- 9. Pricing/limit system — beta users, launch-mode total
--    limit, post-launch weekly limit, referrals, invite codes.
-- ──────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_beta_user boolean not null default false,
  add column if not exists screens_used_total integer not null default 0,
  add column if not exists screens_used_this_week integer not null default 0,
  add column if not exists week_reset_at timestamptz not null default now(),
  add column if not exists referral_code text unique,
  add column if not exists referred_by text,
  add column if not exists referral_bonus_screens integer not null default 0,
  add column if not exists invite_code_used text;

-- Backfill referral codes for any existing users (new users get one from the
-- trigger below). Re-run-safe: only touches rows still missing a code.
update public.profiles
set referral_code = upper(substring(md5(id::text) from 1 for 8))
where referral_code is null;

-- Weekly reset — called before the limit check in /api/screen for non-beta,
-- non-launch-mode users. No-ops if less than 7 days have passed.
create or replace function public.reset_weekly_screens_if_needed(
  user_id uuid
) returns void as $$
begin
  update public.profiles
  set
    screens_used_this_week = 0,
    week_reset_at = now()
  where
    id = user_id
    and week_reset_at < now() - interval '7 days';
end;
$$ language plpgsql security definer;

-- Updated signup trigger: launch-mode users start as beta users with a
-- generated referral code. Replaces the earlier handle_new_user definition
-- (same function signature, so this supersedes it in place).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  beta_mode boolean;
  new_referral_code text;
begin
  -- Hardcoded to match LAUNCH_MODE in the app env — flip to false after the
  -- launch window closes (there's no shared settings table between the DB
  -- and the app, so these must be kept in sync manually).
  beta_mode := true;

  new_referral_code := upper(substring(md5(new.id::text) from 1 for 8));

  insert into public.profiles (id, email, full_name, is_beta_user, referral_code)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    beta_mode,
    new_referral_code
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ──────────────────────────────────────────────────────────
-- 10. Race-condition hardening for §9 (post-security-review).
--
--    a) reserve_screens/refund_screens: the app previously read
--       screens_used_total/this_week, decided allowed/blocked in
--       application code, then wrote the increment later —
--       concurrent /api/screen requests could all read the same
--       stale count and all pass the check before any of them
--       committed, exceeding the limit. The UPDATE ... WHERE
--       below is atomic: Postgres locks the row, evaluates the
--       condition against the current value, and only commits
--       if it still holds — concurrent callers serialize instead
--       of racing. reserve returns false (no-op, nothing written)
--       if it would exceed p_limit; refund is used for JDs that
--       were reserved but failed to scrape/score.
--    b) increment_referral_bonus: same pattern for the referral
--       bonus counter, replacing a read-then-write in application
--       code that could lose or double-count concurrent referrals.
--    c) invite_attempt_count / invite_attempt_window_started_at:
--       BETA_INVITE_CODE is a static shared secret with no rate
--       limit on /api/invite/apply — add a DB-backed sliding
--       window (works across serverless instances, unlike an
--       in-memory counter) so it can't be brute-forced.
-- ──────────────────────────────────────────────────────────
create or replace function public.reserve_screens(
  p_user_id uuid,
  p_amount integer,
  p_use_weekly boolean,
  p_limit integer
) returns boolean as $$
declare
  affected integer;
begin
  if p_use_weekly then
    update public.profiles
    set screens_used_total = screens_used_total + p_amount,
        screens_used_this_week = screens_used_this_week + p_amount
    where id = p_user_id
      and screens_used_this_week + p_amount <= p_limit;
  else
    update public.profiles
    set screens_used_total = screens_used_total + p_amount
    where id = p_user_id
      and screens_used_total + p_amount <= p_limit;
  end if;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$ language plpgsql security definer;

create or replace function public.refund_screens(
  p_user_id uuid,
  p_amount integer,
  p_use_weekly boolean
) returns void as $$
begin
  if p_amount <= 0 then
    return;
  end if;
  if p_use_weekly then
    update public.profiles
    set screens_used_total = greatest(0, screens_used_total - p_amount),
        screens_used_this_week = greatest(0, screens_used_this_week - p_amount)
    where id = p_user_id;
  else
    update public.profiles
    set screens_used_total = greatest(0, screens_used_total - p_amount)
    where id = p_user_id;
  end if;
end;
$$ language plpgsql security definer;

create or replace function public.increment_referral_bonus(
  target_user_id uuid,
  amount integer
) returns void as $$
begin
  update public.profiles
  set referral_bonus_screens = referral_bonus_screens + amount
  where id = target_user_id;
end;
$$ language plpgsql security definer;

alter table public.profiles
  add column if not exists invite_attempt_count integer not null default 0,
  add column if not exists invite_attempt_window_started_at timestamptz not null default now();

-- Atomic check-and-increment for the invite-code attempt counter itself —
-- `for update` locks the row so concurrent brute-force attempts from the
-- same account serialize instead of all reading the same stale count.
create or replace function public.check_and_increment_invite_attempts(
  p_user_id uuid,
  p_max_attempts integer,
  p_window_ms bigint
) returns boolean as $$
declare
  window_started timestamptz;
  current_count integer;
  window_expired boolean;
  allowed boolean;
begin
  select invite_attempt_window_started_at, invite_attempt_count
  into window_started, current_count
  from public.profiles
  where id = p_user_id
  for update;

  window_expired := (extract(epoch from (now() - window_started)) * 1000) > p_window_ms;

  if window_expired then
    current_count := 0;
    window_started := now();
  end if;

  allowed := current_count < p_max_attempts;

  if allowed then
    update public.profiles
    set invite_attempt_count = current_count + 1,
        invite_attempt_window_started_at = window_started
    where id = p_user_id;
  end if;

  return allowed;
end;
$$ language plpgsql security definer;

-- ──────────────────────────────────────────────────────────
-- 11. feedback
--    In-app user feedback. Delivered to the app owner as a
--    batched digest email (not per-submission) via a scheduled
--    hit to /api/feedback/digest. sent_at null = not yet
--    included in a digest.
-- ──────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  email      text,
  message    text not null,
  page       text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

create index if not exists feedback_user_id_idx on public.feedback(user_id);
create index if not exists feedback_unsent_idx on public.feedback(created_at) where sent_at is null;

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback for insert with check (auth.uid() = user_id);

-- Deliberately no select/update/delete policy for regular users —
-- feedback is write-only from the client. The digest job reads and
-- marks rows sent via the service-role client, which bypasses RLS
-- entirely (same pattern as other service-role-only operations in
-- this schema), so no policy is needed for that path either.

-- ──────────────────────────────────────────────────────────
-- 12. _environment
--    Single-row-per-key table read by /api/health (anon client) to
--    report which database an environment is actually pointed at.
--    Needs a public select policy — it's read before any user is
--    authenticated.
-- ──────────────────────────────────────────────────────────
create table if not exists public._environment (
  key   text primary key,
  value text not null
);

-- Seed value is environment-specific — use 'development' on dev,
-- 'production' on prod.
insert into public._environment (key, value)
values ('name', 'development')
on conflict (key) do nothing;

alter table public._environment enable row level security;

drop policy if exists "environment_select_all" on public._environment;
create policy "environment_select_all" on public._environment
  for select using (true);
