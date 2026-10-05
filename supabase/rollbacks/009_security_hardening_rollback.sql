-- ============================================================
-- RECOVERY for 009_security_hardening.sql — NOT a migration.
--
-- WARNING: running this REOPENS the vulnerabilities 009 closed.
-- Use only if 009 breaks production and a forward fix is not possible.
--
-- Restores the exact pre-009 function bodies (from
-- 005_pricing_limits_referrals_invites.sql: no search_path, SECURITY
-- DEFINER, owner unchanged) and the pre-009 ACLs of a Supabase project
-- whose public-schema defaults grant anon/authenticated/service_role
-- full table privileges and function EXECUTE (the long-standing
-- Supabase default). Before applying 009, record the real ACLs with:
--
--   select p.oid::regprocedure, p.proacl from pg_proc p
--   where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('reserve_screens','refund_screens',
--       'increment_referral_bonus','check_and_increment_invite_attempts');
--   select relacl from pg_class where oid = 'public.profiles'::regclass;
--
-- If profiles' relacl showed no `a`/`w` for anon/authenticated, skip
-- section 1 (re-granting would be MORE permissive than before).
--
-- Each section below states the hole it reopens. Sections are
-- independent; delete any you don't need before running. Atomic.
--
-- App compatibility: the service-role reserve/refund calls in
-- /api/screen keep working after this script runs (service_role
-- regains EXECUTE through PUBLIC as well as directly).
-- ============================================================

begin;

-- 1) profiles privileges.
--    REOPENS: any signed-in user can
--    `update({ tier: 'paid', screens_used_this_week: 0 })` on their own row
--    from the browser (payment bypass, quota reset), and insert a profile row.
revoke update (
  full_name,
  resume_text,
  api_key_encrypted,
  api_provider,
  hard_reject_filters,
  preferences
) on table public.profiles from authenticated;
grant insert, update on table public.profiles to anon, authenticated;

-- 2) reserve_screens / refund_screens.
--    REOPENS: any signed-in user can call refund_screens directly to erase
--    their own usage (unlimited free screenings), and either RPC with a
--    negative/huge p_amount or another user's id.
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
alter function public.reserve_screens(uuid, integer, boolean, integer) reset all;

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
alter function public.refund_screens(uuid, integer, boolean) reset all;

grant execute on function public.reserve_screens(uuid, integer, boolean, integer) to public, anon, authenticated, service_role;
grant execute on function public.refund_screens(uuid, integer, boolean) to public, anon, authenticated, service_role;

-- 3) increment_referral_bonus (body unchanged by 009).
--    REOPENS: any caller, including anon, can grant arbitrary
--    referral_bonus_screens to any user id.
grant execute on function public.increment_referral_bonus(uuid, integer) to public, anon, authenticated, service_role;

-- 4) check_and_increment_invite_attempts.
--    REOPENS: caller-supplied p_window_ms = 0 resets the counter before
--    every guess (unlimited BETA_INVITE_CODE brute force), and any caller
--    can lock out another user's invite attempts.
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
alter function public.check_and_increment_invite_attempts(uuid, integer, bigint) reset all;

grant execute on function public.check_and_increment_invite_attempts(uuid, integer, bigint) to public, anon, authenticated, service_role;

commit;
