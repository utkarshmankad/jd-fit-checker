# Fit verdict v2 (`fit-v2-1`)

A transparent, multidimensional verdict built from the
[requirement matrix](../matching/README.md) and the candidate and role intelligence profiles. It still produces the
four existing categories, `STRONG | DECENT | WEAK | REJECT`, so the UI and stored data keep their meaning.

**Status: shadow only.** `VERDICT_ENGINE` defaults to `shadow`. v2 is computed and stored in
`analysis_json.verdict_v2`, while users keep seeing the legacy verdict (`legacy-fast-1`).

| File | Role |
|---|---|
| `schema.ts` | Types and versions: `LEGACY_SCORING_VERSION = legacy-fast-1`, `VERDICT_V2_SCORING_VERSION = fit-v2-1` |
| `engine.ts` | `computeVerdictV2()`: dimensions, score, bands, blockers, explanation |
| `rollout.ts` | Rollout guard (`verdictEngineMode`), shadow records, comparison telemetry, historical reader |

## Formula
**1. Dimensions (0–100).** Each dimension is the weight-averaged value of its matrix rows:
- strong 1;
- partial 0.6;
- transferable 0.35;
- unsupported 0.1;
- explicit gap 0;
- **unknown rows are excluded from scores and reported as uncertainty.**

A dimension the role doesn't ask for has weight 0.

| Dimension | Rows / source | Weight |
|---|---|---|
| Professional-identity fit | Identity and role-family rows | 0.16 |
| Seniority fit | Seniority and overall-years rows | 0.14 |
| Mandatory-requirement coverage | Every mandatory row | 0.20 |
| Skill & capability fit | Skill and capability rows (skills are already capped at 40% of matrix weight) | 0.10 |
| Leadership-scope fit | People management, managing managers, technical leadership, people-management years | 0.10 |
| Architecture & system design | Architecture rows | 0.06 |
| Hands-on execution | Hands-on row | 0.08 |
| Domain relevance | Domain rows | 0.03 |
| Delivery & stakeholder scope | Role expectations (stakeholder/product, delivery ownership) vs the candidate's demonstrated scopes | 0.05 |
| Evidence strength | `100 × (1 − unknown share) × quality`, where quality is explicit 1, inferred 0.75, fallback 0.4 for established rows | 0.08 |
| Explicit constraints | The user's own filters (deal-breakers, title floor, location…), same rules as legacy | 0 (gate only) |

**2. Score and band.** The score is the weight-averaged dimension score over the dimensions that could be scored.
`≥ 80 → STRONG`, `≥ 60 → DECENT`, otherwise `WEAK`. This is `uncapped_verdict`.

**3. Blockers.** Deterministic and evaluated in order; each one caps the verdict. A cap can only lower it, never
raise it. **A high keyword score cannot erase an identity or seniority mismatch, and a critical missing requirement
is never averaged away.**

| Blocker | Trigger | Cap |
|---|---|---|
| `hard_constraint` | Any of the user's filters fires | **REJECT** (forced) |
| `identity_mismatch` | Identity row `explicit_gap` (e.g. IC ↔ people manager) | WEAK |
| | Identity `partial` or `transferable` | DECENT |
| `role_family_mismatch` | Role family `explicit_gap` (e.g. product → engineering) | WEAK |
| | Role family `transferable` (QA, analyst, data science ↔ engineering) | DECENT |
| `seniority_shortfall` | Seniority `explicit_gap` (≥ 2 levels below), or overall years `explicit_gap` (< 60% of required) | WEAK |
| | Seniority `partial` (one level below, or ≥ 2 above) or `unsupported` (inflated title) | DECENT |
| `mandatory_gap` / `not_hands_on` | Any other mandatory row with `explicit_gap` (no direct reports, not hands-on, …) | WEAK |
| `mandatory_claims_only` | ≥ 2 mandatory rows only claimed (skills list, course, student context) | WEAK |
| | Exactly 1 | DECENT |
| `insufficient_evidence` | More than half of the job's own must-have lines are `unknown`, or ≥ 45% of all rows are `unknown`, or there are no rows | DECENT (cannot be STRONG) |

**Final verdict** is `REJECT` if a hard constraint fired; otherwise the lowest of the uncapped band and every cap.

**4. User-facing output:** `strongest_matches` (mandatory strong rows), `important_gaps` (blocker reasons and mandatory
gaps), `transferable_strengths`, `uncertainty` (unknown share and level low/medium/high, plus "unknown is not
missing"), and `explanation` (starting with the verdict and, when capped, which blocker capped it).

Not yet applied in v2: the user's personal recommendation corrections. The legacy scorer calibrates with them; v2 will
in a later version.

## Rollout guard
| `VERDICT_ENGINE` | Behaviour |
|---|---|
| unset / anything else | **shadow**: v2 stored in `analysis_json.verdict_v2`; the visible `verdict` stays legacy; `scoring_version = legacy-fast-1` |
| `legacy` | v2 not computed |
| `v2` (exact) | The visible `verdict`, `headline` and `recommendation` come from v2; `scoring_version = fit-v2-1`; the replaced verdict is kept in `legacy_verdict`; legacy scores (`ats_score`, `composite_score`, …) are preserved |

Shadow computation is pure: no quota RPCs, payment or tracker writes, and no profile updates. An endpoint test checks
that the RPC calls and write operations are identical with and without shadow.

## Telemetry
Each `/api/screen` flush logs one `verdict_shadow` line:
`{ mode, items, agree, comparisons: [{ legacy_version, legacy_verdict, legacy_composite, v2_version, v2_status, v2_verdict, v2_score, v2_uncapped, blocker_kinds, uncertainty, agree, latency_ms }] }`.
These are enums and numbers only: **no resume or job text, quotes, names, emails or user ids**. A test enforces this.

## Historical compatibility
Rows written before Sprint 4 have no `scoring_version`, so they are `legacy-fast-1` and keep their stored verdict.
`readStoredVerdict(row)` returns `{ verdict, scoring_version, shadow }` for any row. The `screening_results.verdict`
column and the UI display mapping are unchanged.
