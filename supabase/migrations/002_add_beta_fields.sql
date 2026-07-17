-- Migration: 002_add_beta_fields
-- Description: Beta user tracking, referral system, weekly screen counter,
--   invite codes
-- Applied to dev:  [fill in date]
-- Applied to prod: [fill in date]

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

-- ROLLBACK:
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS is_beta_user,
--   DROP COLUMN IF EXISTS screens_used_total,
--   DROP COLUMN IF EXISTS screens_used_this_week,
--   DROP COLUMN IF EXISTS week_reset_at,
--   DROP COLUMN IF EXISTS referral_code,
--   DROP COLUMN IF EXISTS referred_by,
--   DROP COLUMN IF EXISTS referral_bonus_screens,
--   DROP COLUMN IF EXISTS invite_code_used;
-- DROP FUNCTION IF EXISTS public.reset_weekly_screens_if_needed(uuid);
-- -- Note: does NOT revert handle_new_user() to its 001 definition —
-- -- that would need the original function body restored manually.
