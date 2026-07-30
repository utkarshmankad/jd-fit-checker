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
