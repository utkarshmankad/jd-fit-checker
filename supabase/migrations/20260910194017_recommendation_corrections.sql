-- User-reviewed screening mistakes. These rows are private calibration memory:
-- future jobs with similar titles/requirements can reuse the user's correction.
create table if not exists public.recommendation_corrections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  screening_result_id  uuid not null references public.screening_results(id) on delete cascade,
  original_verdict     text not null check (original_verdict in ('STRONG', 'DECENT', 'WEAK', 'REJECT')),
  corrected_verdict    text not null check (corrected_verdict in ('STRONG', 'DECENT', 'WEAK', 'REJECT')),
  reason               text not null check (char_length(reason) between 3 and 1000),
  job_title             text,
  company               text,
  jd_text               text not null,
  feature_tokens        text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, screening_result_id)
);

create index if not exists recommendation_corrections_user_created_idx
  on public.recommendation_corrections(user_id, created_at desc);

alter table public.recommendation_corrections enable row level security;

create policy "recommendation_corrections_select_own"
  on public.recommendation_corrections for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "recommendation_corrections_insert_own"
  on public.recommendation_corrections for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "recommendation_corrections_update_own"
  on public.recommendation_corrections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "recommendation_corrections_delete_own"
  on public.recommendation_corrections for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.recommendation_corrections to authenticated;

-- ROLLBACK:
-- drop table if exists public.recommendation_corrections;
