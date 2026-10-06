-- Read-only post-rollout check for migrations 009-011 (run on any environment
-- after applying them). Every column must read true. Errors before 010/011
-- exist (it references their tables). Runbook:
-- docs/runbooks/2026-10-06-prod-migrations-009-011.md
select
  to_regclass('public.candidate_profiles') is not null                                                   as t010_table,
  to_regclass('public.role_profiles') is not null                                                        as t011_table,
  not has_function_privilege('anon', 'public.refund_screens(uuid,integer,boolean)', 'EXECUTE')           as anon_no_refund,
  not has_function_privilege('authenticated', 'public.refund_screens(uuid,integer,boolean)', 'EXECUTE')  as auth_no_refund,
  not has_function_privilege('authenticated', 'public.reserve_screens(uuid,integer,boolean,integer)', 'EXECUTE') as auth_no_reserve,
  not has_function_privilege('authenticated', 'public.increment_referral_bonus(uuid,integer)', 'EXECUTE') as auth_no_referral,
  has_function_privilege('service_role', 'public.reserve_screens(uuid,integer,boolean,integer)', 'EXECUTE') as svc_reserve,
  has_function_privilege('service_role', 'public.refund_screens(uuid,integer,boolean)', 'EXECUTE')        as svc_refund,
  has_function_privilege('service_role', 'public.increment_referral_bonus(uuid,integer)', 'EXECUTE')      as svc_referral,
  has_function_privilege('authenticated', 'public.check_and_increment_invite_attempts(uuid,integer,bigint)', 'EXECUTE') as auth_invite,
  not has_function_privilege('anon', 'public.check_and_increment_invite_attempts(uuid,integer,bigint)', 'EXECUTE') as anon_no_invite,
  not has_column_privilege('authenticated', 'public.profiles', 'tier', 'UPDATE')                          as auth_no_tier_update,
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')                         as auth_full_name_update,
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT')                                   as auth_no_profile_insert,
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass)                           as profiles_rls,
  has_table_privilege('authenticated', 'public.candidate_profiles', 'SELECT')
    and not has_table_privilege('authenticated', 'public.candidate_profiles', 'INSERT')                   as cp_read_only,
  not has_table_privilege('authenticated', 'public.role_profiles', 'SELECT')
    and not has_table_privilege('anon', 'public.role_profiles', 'SELECT')                                 as rp_server_only,
  (select proconfig::text from pg_proc where oid = 'public.reserve_screens(uuid,integer,boolean,integer)'::regprocedure) = '{"search_path=\"\""}' as reserve_empty_search_path;
