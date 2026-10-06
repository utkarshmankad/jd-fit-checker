# Candidate Intelligence Profile

A versioned, evidence-first representation of a candidate's professional identity. It is derived
from the stored resume **once per resume version** and kept in `public.candidate_profiles`
(migration `010`).

| File | Role |
|---|---|
| `schema.ts` | Types, `CANDIDATE_PROFILE_SCHEMA_VERSION`, `CANDIDATE_PROFILE_EXTRACTOR_VERSION` |
| `extract.ts` | Deterministic extraction: normalise, chunk the **whole** resume, trace every value |
| `store.ts` | `ensureCandidateProfile()`: reuse when fresh, otherwise extract and upsert (service role only) |

## What it contains

- **identity:** `ic | technical_lead | people_manager | executive | hybrid`. `identity_signals`
  holds the raw counts behind it.
- **role_family:** `engineering | qa | data_analysis | data_science | product | non_technical`.
  Separates, for example, "QA engineer who tests React apps" from "React engineer".
- **career_transition:** a prior non-engineering career, or a non-engineering role with technical
  courses.
- **seniority.current** (from the most recent title) and **seniority.demonstrated** (from team size,
  managers of managers, cross-team or organisation-wide scope, and years). Level scale: 1 intern …
  6 principal / executive.
- **explicit_skills:** each skill with the sentences that mention it. A skill used in experience
  outranks a skills-list mention, which outranks a course, certificate or student context.
- **implicit_capabilities:** inferred from responsibilities (never from skills lists), e.g. System
  Design, People Management, Cross-team Influence, Incident Response.
- **scopes:** leadership, architecture, hands-on, product/stakeholder and delivery ownership
  (`low | medium | high`). An explicit opposite statement ("has not written production code")
  produces `negated: true`.
- **team:** largest stated team or organisation size, direct reports (including an explicit "no
  direct reports"), managers of managers.
- **domains**, **outcomes** (quantified statements), and **experience** (roles with years when date
  ranges exist, total years, latest year mentioned).
- **unknowns:** every field the resume gave no evidence for. These are reported rather than guessed.

Every value is a `Traced<T>`:

```jsonc
{
  "value": "hybrid",
  "basis": "inferred",            // or "explicit": stated directly in the resume
  "rule": "manager_with_hands_on_evidence",   // provenance: which rule produced it
  "confidence": 0.6,              // conservative; inferred values are capped below explicit ones
  "evidence": [                   // verbatim quotes; text.slice(start, end) === quote
    { "chunk": 0, "start": 0, "end": 68, "quote": "Engineering Manager at Pennyroyal Health (fictional), 2020 - present" },
    { "chunk": 0, "start": 69, "end": 147, "quote": "Managed a team of 6 engineers with direct reports and ran performance reviews." }
  ]
}
```

Example (fictional) hybrid manager:

```text
Engineering Manager at Pennyroyal Health (fictional), 2020 - present
Managed a team of 6 engineers with direct reports and ran performance reviews.
Still hands-on: built Python services on GCP and implemented the patient intake API.
Wrote Terraform modules for the clinical data platform.
```

This yields:
- identity `hybrid` (0.6);
- current seniority 4 (explicit, from the title);
- largest team 6 with direct reports (explicit);
- hands-on `medium`;
- explicit Python / GCP / Terraform skills, all from experience sentences;
- domain `healthcare`;
- `unknowns`: `scopes.architecture`, `scopes.product_stakeholder`, `scopes.delivery_ownership`,
  `team.manages_managers`, `outcomes`, `experience.total_years`.

## Lifecycle

1. **Upload** (`POST /api/parse-resume`): after the resume is saved, `ensureCandidateProfile` builds
   and stores the profile.
2. **Screening** (`POST /api/screen`): the stored profile is reused when `resume_sha256`,
   `schema_version` and `extractor_version` all match. It is rebuilt only when it is missing or stale.
   This covers resumes uploaded before this feature and version bumps, without a backfill job. The
   response includes a content-free `candidate_profile` reference. Scoring does **not** use the
   profile yet.
3. **Read** (`GET /api/candidate-profile`): returns the caller's own profile through the
   request-scoped client, so RLS enforces ownership. Responses are `Cache-Control: private,
   no-store`.

**To rebuild everyone's profile**, bump `CANDIDATE_PROFILE_EXTRACTOR_VERSION` (rules changed) or
`CANDIDATE_PROFILE_SCHEMA_VERSION` (shape changed). Each profile then rebuilds on that user's next
upload or scan.

The resume hash is computed after normalisation (line endings, repeated spaces), so formatting-only
re-uploads reuse the stored profile.

## Guarantees and limits

- **Deterministic, no provider:** no network, model call or clock, so the same text always yields the
  same profile and AI outages cannot affect it. A provider outage still fails the *legacy*
  `/api/parse-resume` AI parse (pre-existing behaviour); a resume stored earlier is still profiled
  lazily at screening time.
- **Whole resume:** the text is split into contiguous chunks of at most 1,200 characters on
  line/word boundaries, and every chunk is processed. Upload already caps the text at 50,000
  characters.
- **Conservative inference:**
  - negated statements ("no direct reports", "no cross-team projects") never count as evidence;
  - student, course, certificate and personal-project contexts are down-weighted;
  - titles are only read from role lines, so "principal component analysis" is not a principal title.
- **Privacy:** profiles contain resume quotes. They are readable only by their owner and writable
  only by the service role. Logs contain error codes and messages only, never resume or profile text.
- **Not semantic understanding:** this is rule-based. Unusual phrasing yields `unknowns` rather than
  wrong values, which is the intended failure mode. An AI-assisted extractor would be a new
  `extractor_version`, constrained to evidence quotes that exist verbatim in the resume.
