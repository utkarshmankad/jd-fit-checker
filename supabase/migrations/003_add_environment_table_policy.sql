-- Migration: 003_add_environment_table_policy
-- Description: _environment table (used by /api/health to report which DB
--   an environment is actually pointed at) + anon-read RLS policy.
--   The table already existed in dev without a select policy, so the
--   anon-key client used by /api/health silently failed every read and
--   fell back to the "no _environment table" message even though the
--   table was there.
-- Applied to dev:  [fill in date]
-- Applied to prod: [fill in date]

create table if not exists public._environment (
  key   text primary key,
  value text not null
);

-- Seed value is environment-specific — use 'development' on dev, 'production'
-- on prod. Change the value below before running on prod.
insert into public._environment (key, value)
values ('name', 'development')
on conflict (key) do nothing;

alter table public._environment enable row level security;

drop policy if exists "environment_select_all" on public._environment;
create policy "environment_select_all" on public._environment
  for select using (true);

-- ROLLBACK:
-- DROP TABLE IF EXISTS public._environment;
