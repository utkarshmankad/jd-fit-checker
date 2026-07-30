-- Back-fill of schema.sql section 11 into the numbered migration history,
-- per migrations/README.md "Note on history". No behavior change on prod
-- (already applied there) — this was also found missing from dev during
-- the PostHog analytics work, which is what surfaced this gap.
--
-- 11. feedback
--    In-app user feedback. Delivered to the app owner as a batched digest
--    email (not per-submission) via a scheduled hit to /api/feedback/digest.
--    sent_at null = not yet included in a digest.
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

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.feedback;
