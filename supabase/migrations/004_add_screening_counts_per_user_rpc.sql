-- Aggregates lifetime screening counts per user for /admin. Runs SECURITY
-- DEFINER since it's only ever called from server code using the
-- service-role client (src/app/admin/page.tsx) — never exposed to the
-- anon/authenticated roles, so bypassing RLS here doesn't expose anything
-- a request-scoped caller could reach anyway.
create or replace function public.get_screening_counts_per_user()
returns table(user_id uuid, count bigint)
language sql security definer as $$
  select user_id, count(*) as count
  from public.screening_results
  group by user_id;
$$;

revoke all on function public.get_screening_counts_per_user() from public, anon, authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.get_screening_counts_per_user();
