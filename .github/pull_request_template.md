<!-- See .github/BRANCH_STRATEGY.md — every bug fix and feature follows: branch off dev -> PR to dev (test) -> verify -> PR dev to main (production). -->

## Summary

## Test plan
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] Verified on the `dev` test deployment (required before a `dev` -> `main` PR)
