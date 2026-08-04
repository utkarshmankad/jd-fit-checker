# Branch Strategy — jd-fit-checker

## Branches
- `main` — Production. Deploys to jobsnob.fyi
- `dev` — Test/staging. Deploys to preview environment

## Required flow

Every bug fix and every feature — no exceptions — follows this:

1. **Fork a branch off `dev`** — `fix/<short-description>` or `feat/<short-description>`.
2. **Do the work** on that branch: implement, run `npm run typecheck && npm run lint && npm run build` locally before pushing.
3. **PR into `dev`** ("promote to test"). The `CI` GitHub Actions workflow (`.github/workflows/ci.yml`: typecheck, lint, build) must pass — it's a required status check, merge button is blocked otherwise. Merging pushes to Vercel's `dev`-branch deployment (test environment) automatically via Vercel's git integration.
4. **Verify on the test deployment.** Don't skip this — it's the only environment that runs against real (non-placeholder) env values before production.
5. **PR `dev` → `main`** ("promote to production") once test is verified. Same CI gate applies. Merging deploys to production (jobsnob.fyi) automatically via Vercel's git integration.

Never commit directly to `main` or `dev` — always PRs, always through this sequence. Skipping the `dev`/test stage and going straight `feature → main` is not allowed even for small fixes.

## CI

`.github/workflows/ci.yml` runs on every PR into `dev` or `main`, and on every push to those branches: `npm run typecheck`, `npm run lint`, `npm run build` (against placeholder env values — this checks the code compiles and type-checks, not runtime behavior against real infra). It's wired up as a required status check on both branches in GitHub's branch protection settings.

## Deployment

Actual deployment is handled by Vercel's GitHub git integration (not a GitHub Actions deploy step) — a push to `dev` or `main` triggers Vercel to build and deploy using that project's real, environment-scoped secrets:
- `main` → production (jobsnob.fyi)
- `dev` → test/preview deployment
