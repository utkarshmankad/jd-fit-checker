# Evidence-to-requirement matching

`matchProfiles(candidateProfile, roleProfile)` compares what a role needs (the
[Role Intelligence Profile](../role-profile/README.md)) with what the candidate has actually demonstrated (the
[Candidate Intelligence Profile](../candidate-profile/README.md)). The result is a `RequirementMatrix`.

The function is pure and deterministic: no network, model or clock. Identical inputs give byte-identical matrices, and
matching takes well under a millisecond once both profiles exist. **It does not change the production verdict.** Sprint 4
decides how the matrix feeds the verdict.

| File | Role |
|---|---|
| `schema.ts` | Matrix types and `MATCHING_ENGINE_VERSION` (`match-deterministic-1`) |
| `concepts.ts` | Adjacency families (transferable, never equal), requirement phrase → capability rules |
| `engine.ts` | Requirement building, per-requirement evaluation, weighting, summary, user-facing explanation |

## Requirements
- **Requirement lines:** the role profile's mandatory and preferred lines.
  - Tools are split into groups: "Go **or** Java, Kafka and PostgreSQL" becomes `[Go|Java]`, `[Kafka]`, `[PostgreSQL]`.
  - Phrases map to capabilities: "on-call and incident response" → Incident Response; "managing engineering teams" →
    People Management; "designing distributed systems" → System Design.
  - Years against an area ("3+ years of people management") become their own row.
- **Tools named only in responsibilities** ("Build Go services on AWS") become *preferred* skill rows.
- **Structural requirements** from the role profile:
  - mandatory: role family, role identity, target seniority, minimum years;
  - for manager roles: people management and managing managers;
  - architecture (mandatory when high, preferred when medium);
  - hands-on (mandatory when the role is hands-on);
  - preferred: domain.
- **Anything not interpretable** stays as an `other` row with status `unknown`. It is never guessed.

## Statuses
| Status | Meaning |
|---|---|
| `strong` | Demonstrated in professional evidence at the required level |
| `partial` | Demonstrated, but below the required level, duration or breadth |
| `transferable` | An adjacent capability is demonstrated (Java for a Go role, mentoring for people management) — never counted as the requirement itself |
| `unsupported` | **Claimed but not demonstrated**: a skills-list entry, a course or certificate, student or hobby context, or a senior title with no demonstrated scope |
| `explicit_gap` | The resume states the opposite ("no direct reports", "have not written production code"), a measurable shortfall (years, level), or the role identities conflict |
| `unknown` | No evidence either way. **Never treated as "does not have"**: an unmentioned tool is `unknown`, not a gap |

Every row records:
- the normalised requirement and whether it is mandatory;
- the candidate evidence, with the profile field it came from and its quotes;
- confidence;
- recency (the role the evidence falls in, with its years and current flag, plus total years);
- a one-sentence explanation;
- `basis`: `explicit` (stated evidence), `inferred` (implicit capability, scope or identity), or `fallback` (deterministic
  default when nothing applies).

## Guardrails
- **Leadership words are not people management.** People management needs direct reports, performance reviews or
  hiring evidence. Mentoring and technical leadership are at most `transferable`; student or club leadership is
  `unsupported`; an explicit "no direct reports" is an `explicit_gap`.
- **Tool overlap cannot dominate.** Skill rows carry at most 40% of the total weight, and identity, role family,
  seniority, people management and hands-on rows carry the rest. A QA engineer who lists every React tool still gets a
  `transferable` role-family row.
- **Mandatory gaps cost more.** Mandatory rows weigh 1.0 against 0.35 for preferred (structural rows up to 1.5×).
  `summary.blocking_gaps` lists mandatory rows that are `explicit_gap` or `unsupported`.
- **Inflated titles.** Seniority compares the *demonstrated* level. A staff-plus or director title with no demonstrated
  scope is `unsupported`; "Senior Staff" with three years of evidence is an `explicit_gap`.
- **Claims never become evidence.** A unit-tested invariant over all 42 fixture pairs checks that every `strong` or
  `partial` row cites professional quotes, and that skills rows are never established from a list, course or student
  context.

## Output
- `matrix.rows`: the machine-readable matrix.
- `matrix.summary`:
  - `fit_score` (0–100, weighted; informational until Sprint 4);
  - status counts for mandatory and preferred rows;
  - `skill_weight_share`;
  - `blocking_gaps`.
- `matrix.explanation`: up to 5 short lines for users (identity or role-family mismatch, must-have gaps, claimed-only
  items, clear strengths, related items, and the count of unknowns).
- `/api/screen` stores `matrixReference(matrix)` in `analysis_json.requirement_match` when both profiles exist. It is
  quote-free.

## Evaluation (`npm run eval:matching`)
There are 15 labelled cases (`evals/matching/cases`, fictional) covering equivalent wording, adversarial keyword overlap,
IC vs manager, inflated titles, transferable skills, unknown vs gap and partial years. They contain 37 requirement rows
labelled by hand. The command also reports how well structural rows agree with the Sprint 0 fixtures. Measured at the
time of writing:
- **Requirement accuracy:** 35/37. **Established precision:** 16/16 rows marked strong or partial were truly strong or
  partial. **Claims promoted to evidence:** 0.
- **The two disagreements** are both the inflated "Head of Engineering" case. The engine says `unsupported` (seniority)
  and `unknown` (years) where the label says `explicit_gap`: more cautious, never more favourable to the candidate.
- **Deterministic:** 15/15. **Latency:** about 0.02 ms p50 per match, under 1 ms max (profiles precomputed).

These labels were written by the same author as the engine, and three rules were adjusted after seeing results (role
family, responsibility tools, inflated titles). Treat the numbers as a regression baseline, not an independent accuracy
estimate.

## Known limitations
- **No total years for a current role.** The candidate profile has no clock, so "2023 – present" gives no duration
  unless closed ranges exist. Experience rows are then `unknown`, as in the inflated-title case. A fix needs an as-of
  date in the profile, which means a new extractor version.
- **"Go" written bare is not detected** (only "Golang" or "Go language"), to avoid false hits on the English word, so
  "Go or Java" resolves to Java.
- **Education is not extracted from resumes,** so education rows are always `unknown`.
- **Domains** are compared by name only. A missing domain is `unknown`, never a gap.
- **Fit-score bands are not calibrated.** The 85/70 "shadow verdict" in the eval is informational.
