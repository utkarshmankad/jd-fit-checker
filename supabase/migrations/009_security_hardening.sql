-- ============================================================
-- 009_security_hardening.sql
-- Fixes found in a security review of the payment/webhook/auth
-- flows (see PR #54 for the full writeup).
--
-- Authorization contract after this migration:
--   * profiles: anon has no INSERT/UPDATE. authenticated may UPDATE
--     only the self-editable columns below (RLS still pins the row).
--     All app writes already go through the service-role client.
--   * reserve_screens / refund_screens: service_role ONLY. Called
--     from /api/screen with the service-role client after the route
--     has authenticated the user. A signed-in user calling the RPC
--     directly could otherwise refund themselves without limit.
--   * increment_referral_bonus: service_role ONLY.
--   * check_and_increment_invite_attempts: authenticated only, row
--     pinned to auth.uid(), limits fixed in the function.
--
-- Note: service_role has BYPASSRLS, which does NOT bypass function
-- EXECUTE privileges — every grant below is explicit.
--
-- Deploy order: ship the app change that moves reserve/refund to
-- the service-role client BEFORE applying this migration, otherwise
-- /api/screen gets "permission denied" for free/beta users.
--
-- Atomic: the whole file runs in one transaction. Paste the entire
-- file into the SQL editor; any error rolls everything back.
-- Recovery script: supabase/rollbacks/009_security_hardening_rollback.sql
-- ============================================================

begin;

-- a) profiles: no direct inserts, column-scoped UPDATE grant.
--    Supabase's default table grants give anon/authenticated
--    INSERT and UPDATE on every column, so RLS (row ownership) was the
--    only guard and `update({ tier: 'paid' })` from the browser worked.
revoke insert, update on table public.profiles from anon, authenticated;
grant update (
  full_name,
  resume_text,
  api_key_encrypted,
  api_provider,
  hard_reject_filters,
  preferences
) on table public.profiles to authenticated;

-- b) reserve_screens / refund_screens: server-only, validated amounts.
create or replace function public.reserve_screens(
  p_user_id uuid,
  p_amount integer,
  p_use_weekly boolean,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_user_id is null or p_use_weekly is null or p_limit is null
     or p_amount is null or p_amount < 1 or p_amount > 50 then
    raise exception 'reserve_screens: invalid arguments'
      using errcode = '22023';
  end if;

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
$$;

create or replace function public.refund_screens(
  p_user_id uuid,
  p_amount integer,
  p_use_weekly boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_use_weekly is null
     or p_amount is null or p_amount < 1 or p_amount > 50 then
    raise exception 'refund_screens: invalid arguments'
      using errcode = '22023';
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
$$;

revoke all on function public.reserve_screens(uuid, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.refund_screens(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.reserve_screens(uuid, integer, boolean, integer) to service_role;
grant execute on function public.refund_screens(uuid, integer, boolean) to service_role;

-- c) increment_referral_bonus: service-role only (src/lib/utils/referral.ts).
revoke all on function public.increment_referral_bonus(uuid, integer) from public, anon, authenticated;
grant execute on function public.increment_referral_bonus(uuid, integer) to service_role;

-- d) check_and_increment_invite_attempts: pin the real limits (the
--    caller-supplied p_max_attempts/p_window_ms are ignored — passing
--    p_window_ms = 0 used to reset the counter before every guess),
--    and fail closed unless the caller is the row owner.
create or replace function public.check_and_increment_invite_attempts(
  p_user_id uuid,
  p_max_attempts integer,
  p_window_ms bigint
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_started timestamptz;
  current_count integer;
  allowed boolean;
  real_max_attempts constant integer := 5;
  real_window constant interval := interval '15 minutes';
begin
  if auth.uid() is null or p_user_id is null or auth.uid() <> p_user_id then
    return false;
  end if;

  select invite_attempt_window_started_at, invite_attempt_count
  into window_started, current_count
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if now() - window_started > real_window then
    current_count := 0;
    window_started := now();
  end if;

  allowed := current_count < real_max_attempts;

  if allowed then
    update public.profiles
    set invite_attempt_count = current_count + 1,
        invite_attempt_window_started_at = window_started
    where id = p_user_id;
  end if;

  return allowed;
end;
$$;

revoke all on function public.check_and_increment_invite_attempts(uuid, integer, bigint) from public, anon, authenticated;
grant execute on function public.check_and_increment_invite_attempts(uuid, integer, bigint) to authenticated, service_role;

commit;

-- ROLLBACK:
-- Executable recovery script (restores the exact pre-009 definitions and
-- ACLs, and REOPENS every vulnerability fixed above):
--   supabase/rollbacks/009_security_hardening_rollback.sql
