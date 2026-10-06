# Database Migrations — jd-fit-checker

## Rules
1. Never edit an existing migration file after it has been applied to any environment.
2. Always create a new numbered file for any schema change.
3. Always apply to dev Supabase first, test on dev.jobsnob.fyi, then apply to prod.
4. Always update `supabase/schema.sql` after applying migrations.

## Naming format
`NNN_short_description.sql`

Examples:
```
003_add_job_alerts_table.sql
004_add_credits_system.sql
```

## How to apply

### To dev Supabase:
1. Open Supabase dashboard
2. Confirm project name shows the dev project (top left of dashboard)
3. Go to SQL Editor → New query
4. Paste the migration file content
5. Run it
6. Test the feature on dev.jobsnob.fyi
7. Only proceed to prod after full testing passes

### To prod Supabase:
1. Run: `bash scripts/pre-migration-check.sh`
2. Open Supabase dashboard
3. Confirm project name shows the PROD project
4. Go to SQL Editor → New query
5. Paste the SAME migration file content
6. Run it
7. Verify on jobsnob.fyi that the feature works

## Rollback
Every migration file must include a commented rollback section at the bottom:

```
-- ROLLBACK:
-- [SQL to undo this migration]
```

## Note on history
`001` and `002` cover the schema through the beta/referral/limits system.
`003` adds the `_environment` table + its public select policy.
`004` adds the `get_screening_counts_per_user` admin RPC.
`005` and `006` back-fill the pricing/limits/referral/invite system and the
`feedback` table respectively — both were already live in `schema.sql` but
predated the numbered-migration convention (see git history prior to
2026-07-31 for context). All migrations through `006` are now the sum of
`schema.sql`'s current state; keep them in sync going forward per rule 4
above.
`007` adds the private candidate evidence knowledge base.
`008` adds the shared job-description cache.
`20260910194017` adds private, per-user recommendation corrections. Each correction stores the reviewed JD and compact feature tokens so similar future jobs can calibrate the deterministic scorer without an extra LLM call.
`009` locks down a payment-tier bypass and RPC abuse vectors found in a security review: `profiles` loses anon/authenticated INSERT and keeps only a column-scoped UPDATE for self-editable fields; `reserve_screens`/`refund_screens`/`increment_referral_bonus` become service-role-only (explicit grants — BYPASSRLS does not bypass EXECUTE); `check_and_increment_invite_attempts` pins its limits and the caller's row. Deploy the app change that moves `/api/screen` reserve/refund to the service-role client before applying it. The file runs in one transaction. Recovery: `supabase/rollbacks/009_security_hardening_rollback.sql` (reopens the vulnerabilities — read its header). Local acceptance test: `BASELINE=legacy|modern bash supabase/tests/009_acceptance.sh` against a disposable `supabase start` stack.
`010` adds `candidate_profiles`: one Candidate Intelligence Profile per user (versioned JSON with evidence quotes, built from the resume by `src/lib/candidate-profile`). Owners can SELECT their own row; only the service role writes, so users cannot forge their profile. Safe to apply before or after the app change: the app treats a missing table as "profile unavailable" and keeps the legacy flow. Runs in one transaction. Local acceptance: `bash supabase/tests/010_acceptance.sh`.
`011` adds `role_profiles`: a server-only cache of Role Intelligence Profiles keyed by the normalised job-content hash (`src/lib/role-profile`). No anon/authenticated privileges; no user ids. Safe to apply before or after the app change: without the table, profiles are built per request and simply not cached. Runs in one transaction. Local acceptance: `bash supabase/tests/011_acceptance.sh`.
