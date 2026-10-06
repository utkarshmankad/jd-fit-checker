# Recommendation evaluation baseline

A fixed, fictional benchmark for the deterministic recommendation scorers that produce
production verdicts:

| Scorer | Where it runs in production |
|---|---|
| `frontend:scoreJobFast` (`src/lib/screening/fast-scorer.ts`) | `/api/screen` for URL jobs (lightweight fetch and cache hits) |
| `backend:score_jd_fast` (`jd-fit-api/scorer.py`) | FastAPI `/screen` with `analysis_mode: "fast"`: pasted JDs and the render fallback |

The suite measures behaviour. It does not change either scorer.

## Commands

```bash
npm run eval:recommendation                                   # frontend scorer, compact summary
JD_FIT_API_DIR=../jd-fit-api npm run eval:recommendation      # + backend scorer (uses ../jd-fit-api/venv if present)
npm run eval:recommendation -- --check-baseline               # exit 1 on any quality regression
npm run eval:recommendation -- --json /tmp/eval.json          # full machine-readable report
npm run eval:recommendation -- --repeats 10                   # default 5, minimum 2
npm run eval:recommendation -- --write-baseline               # ONLY for an intentional, reviewed baseline change
npm run test:unit                                             # fixture schema, coverage, privacy and metric tests
```

`JD_FIT_PYTHON` overrides the Python interpreter used for the backend adapter.

## Layout

- `cases/*.json`: one reviewable file per scenario; the file name equals `id`.
- `cases.ts`: fixture types, validation and loading. Invalid fixtures abort the run.
- `metrics.ts`: output normalisation, metrics and baseline comparison.
- `run.ts`: runner and summary printer.
- `adapters/backend_fast.py`: calls `jd-fit-api`'s `score_jd_fast` directly (no network or LLM).
- `baseline.json`: the recorded baseline (quality metrics, per-case disagreements, measured latency).
- `alias-hooks.mjs`: lets Node resolve `@/…` imports without a build.

## Fixture contract

Each case has a fictional candidate (`resume_text`, anonymous `label`, `role_identity`, `level`,
`years_experience`, hard-reject `filters`) and a fictional job (`title`, `company`,
`role_identity`, `level`, `jd_text`). `expected` holds the **human judgement**, written without
reference to scorer output:

- `verdict`: `STRONG | DECENT | WEAK | REJECT`, plus a concise `reason` (≤ 220 chars).
- `role_identity_aligned`: whether candidate and job are the same kind of role (IC, tech lead,
  people manager, manager of managers, staff, principal).
- `seniority_fit`: `fit | under | over`.
- `leadership_scope_fit`, `hands_on_fit`, `domain_fit`: `fit | partial | gap | over | n/a`.
- `evidence_strength`: `strong | moderate | weak`. Concrete outcomes are strong; skills lists,
  certificates and student activities are weak.
- `explicit_skills`, `implicit_capabilities`: what the evidence supports.

Levels: 1 intern, 2 junior/associate, 3 mid, 4 senior/tech lead/EM, 5 staff/senior manager/director,
6 principal.

Coverage (enforced by `tests/recommendation-eval-unit.test.mjs`): ≥ 24 cases; every profile
type (`ic`, `tech_lead`, `people_manager`, `senior_people_manager`, `staff_ic`, `principal_ic`,
`career_transition`); every category (`strong_match`, `borderline`, `misleading_keyword`); every
verdict; under- and over-levelled seniority; leadership, hands-on and domain gaps; role-identity
mismatches.

**Privacy:** every person, company and history is invented. Candidates are labelled
`Candidate XX-00`, employers in resumes are marked `(fictional)`, and the unit test rejects emails,
phone-like numbers and URLs. Never paste real resumes, job posts or user data into fixtures.

## Metrics

"Positive" means `STRONG` or `DECENT` (the scorer tells the user to apply).

| Metric | Definition |
|---|---|
| Verdict agreement | exact `verdict` matches / cases (also reported per category) |
| False-positive rate | expected `WEAK`/`REJECT` but predicted positive, divided by expected `WEAK`/`REJECT` |
| False-negative rate | expected positive but predicted `WEAK`/`REJECT`, divided by expected positives |
| Role-identity accuracy | predicted `role_identity_aligned` equals expected / cases |
| Seniority accuracy | predicted `seniority_fit` equals expected / cases |
| Deterministic repeatability | cases whose full scorer output (sha-256 of canonical JSON) is identical across every repeat / cases |
| Per-job latency | p50 / p95 / max of single-case scoring time across all repeats (after an untimed warm-up pass) |
| Batch latency | median / max wall time to score the whole fixture set once |
| Suite fingerprint | hash of every case's output; equal fingerprints mean byte-identical behaviour |

**Derived dimensions.** Today's fast scorers emit no role-identity field and only a numeric
`role_level_score`. The harness therefore derives:

- `seniority_fit` = `fit` when `role_level_score >= 92` (level gap ≤ 0), otherwise `under`.
  The current scorers cannot say `over`.
- `role_identity_aligned` = `true` unless a hard-reject reason is about role type or the title floor.

These are flagged as `[derived]` in the summary. When a scorer starts emitting
`role_identity_aligned` or `seniority_fit`, `normalize()` uses the emitted value automatically.

## Recorded baseline

Measured on 2026-10-06 against `dev` @ `b51573b` and `jd-fit-api` `dev` @ `e974dfe` (27 cases ×
5 repeats, Node v24.18.0 and Python 3.11.15 from the local `jd-fit-api` venv on darwin/arm64; backend CI uses 3.13). The numbers are in `baseline.json`.

| | frontend `scoreJobFast` | backend `score_jd_fast` |
|---|---|---|
| Verdict agreement | 40.7 % (11/27) | 40.7 % (11/27) |
| strong_match / borderline / misleading_keyword | 100 % / 33.3 % / 7.7 % | 100 % / 33.3 % / 7.7 % |
| False-positive rate | 85.7 % (12/14) | 85.7 % (12/14) |
| False-negative rate | 0 % (0/13) | 0 % (0/13) |
| Role-identity accuracy (derived) | 63.0 % | 63.0 % |
| Seniority accuracy (derived) | 59.3 % | 59.3 % |
| Repeatability | 100 % | 100 % |

Measured latency is in `baseline.json`. It is machine-dependent: the frontend scorer runs
sub-millisecond per job in-process, and the backend scorer takes about 0.4–0.5 ms per job inside
Python, excluding HTTP. Treat it as an order of magnitude, not a target.

Main finding: both scorers return `STRONG` for every misleading-keyword case except the one
resolved by a hard-reject filter. Keyword overlap plus "senior-sounding" words (`principal`,
`leadership`, `manager`) dominate. They don't model role identity, hands-on expectations,
leadership scope or evidence strength.

## How future sprints must use this baseline

1. **Before changing recommendation code** (either scorer, prompts that feed verdicts, or the
   verdict thresholds), run with both scorers and save the JSON report:
   `JD_FIT_API_DIR=../jd-fit-api npm run eval:recommendation -- --check-baseline --json before.json`.
2. **After the change**, run the same command. `--check-baseline` fails (exit 1) if any of the following happen:
   - verdict agreement, role-identity accuracy, seniority accuracy or repeatability drops;
   - the false-positive or false-negative rate rises;
   - any case that agreed with the baseline now disagrees;
   - output stops being deterministic across repeats.

   CI runs this check for the frontend scorer on every PR. Run it locally with
   `JD_FIT_API_DIR` for backend changes, because CI does not check out `jd-fit-api`.
3. **Improvements:** if a change genuinely improves the numbers, re-record with
   `--write-baseline` in the same PR. Paste the before/after summaries into the PR description,
   and have a reviewer check every case that changed. Never re-record to hide a regression.
4. **Fixtures are append-mostly.** Add cases for every new failure mode or user-reported
   misjudgement (fictional rewrite only). Changing an existing `expected` needs a written
   justification in the PR. New cases change the denominators, so re-record the baseline in that
   PR.
5. **Both scorers must move together.** The frontend and backend fast scorers are intended to be
   equivalent. A change to one without the other shows up as diverging summaries.
6. **Latency is reported, not gated.** Compare it on the same machine before and after a change.
   Investigate any per-job p95 increase greater than 2× before merging.
