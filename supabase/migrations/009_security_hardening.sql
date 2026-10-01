-- ============================================================
-- 009_security_hardening.sql
-- Fixes found in a security review of the payment/webhook/auth
-- flows (see PR for the full writeup).
--
-- a) profiles_update_own had no column restriction and the table
--    had no explicit grants, so Supabase's default table-level
--    UPDATE grant to `authenticated` let any logged-in user run
--    `supabase.from('profiles').update({ tier: 'paid' })` directly
--    from the browser (anon key + their own session), completely
--    bypassing Razorpay and /api/payment/verify. Lock UPDATE down
--    to only the columns the app actually lets users self-edit;
--    tier/pending_order_id/usage counters/beta+referral state stay
--    writable only via the service-role client (which bypasses
--    grants entirely), same as every other service-role write path
--    in this schema.
--
-- b) reserve_screens/refund_screens are SECURITY DEFINER and take
--    p_amount as a plain, unvalidated parameter. They're invoked
--    through the request-scoped (authenticated-role) client from
--    /api/screen, which always passes a sane literal (1) — but
--    nothing stops a caller from hitting the RPC endpoint directly
--    with a negative p_amount, driving screens_used_total /
--    screens_used_this_week arbitrarily negative and getting
--    unlimited free screenings forever. Clamp p_amount server-side
--    and pin the row to the caller's own auth.uid() so the RPC
--    can't be pointed at another user's profile either.
--
-- c) increment_referral_bonus is SECURITY DEFINER, takes an
--    arbitrary target_user_id and amount, and (unlike every other
--    privileged RPC in this schema) was never revoked from
--    public/anon/authenticated — any logged-in user could call it
--    directly to grant themselves unlimited referral_bonus_screens
--    or vandalize another user's balance. It's only ever called
--    from server code via the service-role client (see
--    src/lib/utils/referral.ts), so it doesn't need to be callable
--    by anon/authenticated at all.
--
-- d) check_and_increment_invite_attempts is a DB-backed rate
--    limiter for the BETA_INVITE_CODE brute-force guard, but it
--    trusts caller-supplied p_max_attempts/p_window_ms. The app
--    always passes the real limits (5 / 15 min), but a caller can
--    hit the RPC directly with p_window_ms = 0 before every guess
--    to force the window to "expire" and reset the counter, which
--    defeats the whole point of the limiter. Pin the limits inside
--    the function and ignore whatever the caller sends; also pin
--    the row to the caller's own auth.uid().
-- ============================================================

-- a) profiles: column-scoped UPDATE grant
revoke update on public.profiles from authenticated;
grant update (
  full_name,
  resume_text,
  api_key_encrypted,
  api_provider,
  hard_reject_filters,
  preferences
) on public.profiles to authenticated;

-- b) reserve_screens / refund_screens: validate amount, pin to caller
create or replace function public.reserve_screens(
  p_user_id uuid,
  p_amount integer,
  p_use_weekly boolean,
  p_limit integer
) returns boolean as $$
declare
  affected integer;
  safe_amount integer;
begin
  -- Only the row owner may reserve against their own counters.
  if auth.uid() is not null and auth.uid() != p_user_id then
    return false;
  end if;

  -- A screening batch is capped well below this in application code;
  -- this is a hard backstop against a negative/huge caller-supplied
  -- amount being used to manipulate the counters directly.
  safe_amount := greatest(1, least(p_amount, 50));

  if p_use_weekly then
    update public.profiles
    set screens_used_total = screens_used_total + safe_amount,
        screens_used_this_week = screens_used_this_week + safe_amount
    where id = p_user_id
      and screens_used_this_week + safe_amount <= p_limit;
  else
    update public.profiles
    set screens_used_total = screens_used_total + safe_amount
    where id = p_user_id
      and screens_used_total + safe_amount <= p_limit;
  end if;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.refund_screens(
  p_user_id uuid,
  p_amount integer,
  p_use_weekly boolean
) returns void as $$
declare
  safe_amount integer;
begin
  if auth.uid() is not null and auth.uid() != p_user_id then
    return;
  end if;

  safe_amount := greatest(0, least(p_amount, 50));
  if safe_amount <= 0 then
    return;
  end if;

  if p_use_weekly then
    update public.profiles
    set screens_used_total = greatest(0, screens_used_total - safe_amount),
        screens_used_this_week = greatest(0, screens_used_this_week - safe_amount)
    where id = p_user_id;
  else
    update public.profiles
    set screens_used_total = greatest(0, screens_used_total - safe_amount)
    where id = p_user_id;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- c) increment_referral_bonus: service-role only, never callable by
--    anon/authenticated directly.
revoke all on function public.increment_referral_bonus(uuid, integer) from public, anon, authenticated;

-- d) check_and_increment_invite_attempts: pin the real limits, ignore
--    caller-supplied ones, and pin the row to the caller's own id.
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
  real_max_attempts constant integer := 5;
  real_window_ms constant bigint := 15 * 60 * 1000;
begin
  if auth.uid() is null or auth.uid() != p_user_id then
    return false;
  end if;

  select invite_attempt_window_started_at, invite_attempt_count
  into window_started, current_count
  from public.profiles
  where id = p_user_id
  for update;

  window_expired := (extract(epoch from (now() - window_started)) * 1000) > real_window_ms;

  if window_expired then
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
$$ language plpgsql security definer set search_path = public;

-- ROLLBACK:
-- grant update on public.profiles to authenticated;
-- revoke update (full_name, resume_text, api_key_encrypted, api_provider, hard_reject_filters, preferences) on public.profiles from authenticated;
-- grant execute on function public.increment_referral_bonus(uuid, integer) to authenticated;
-- (reserve_screens/refund_screens/check_and_increment_invite_attempts would need to be
--  recreated from the prior definitions in 005_pricing_limits_referrals_invites.sql.)
