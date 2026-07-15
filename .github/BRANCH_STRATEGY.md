# Branch Strategy — jd-fit-checker

## Branches
- `main` — Production. Deploys to jobsnob.fyi
- `dev` — Development. Deploys to preview/staging environment

## Workflow
- Feature branches split off `dev`, merge back into `dev` via PR
- `dev` merges into `main` via PR when ready for production release
- Never commit directly to `main` or `dev` — use PRs

## Deployment
- `main` → production (jobsnob.fyi)
- `dev` → preview deployment
