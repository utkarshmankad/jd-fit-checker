-- Back-fill of schema.sql sections 9-10 into the numbered migration
-- history, per migrations/README.md "Note on history". No behavior
-- change — this is the schema that has already been applied to both
-- dev and prod; filing it here just gives it a numbered record.
--
-- 9. Pricing/limit system — beta users, launch-mode total limit,
--    post-launch weekly limit, referrals, invite codes.
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

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.check_and_increment_invite_attempts(uuid, integer, bigint);
-- DROP FUNCTION IF EXISTS public.increment_referral_bonus(uuid, integer);
-- DROP FUNCTION IF EXISTS public.refund_screens(uuid, integer, boolean);
-- DROP FUNCTION IF EXISTS public.reserve_screens(uuid, integer, boolean, integer);
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS invite_attempt_window_started_at,
--   DROP COLUMN IF EXISTS invite_attempt_count;
-- DROP FUNCTION IF EXISTS public.reset_weekly_screens_if_needed(uuid);
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS invite_code_used,
--   DROP COLUMN IF EXISTS referral_bonus_screens,
--   DROP COLUMN IF EXISTS referred_by,
--   DROP COLUMN IF EXISTS referral_code,
--   DROP COLUMN IF EXISTS week_reset_at,
--   DROP COLUMN IF EXISTS screens_used_this_week,
--   DROP COLUMN IF EXISTS screens_used_total,
--   DROP COLUMN IF EXISTS is_beta_user;
-- (handle_new_user is left as-is on rollback — reverting it would break
-- the on_auth_user_created trigger's expected signature)
