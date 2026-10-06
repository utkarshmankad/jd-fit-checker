# Role Intelligence Profile

A versioned, evidence-traced structure for one job description. It is cached by normalised content
hash in `public.role_profiles` (migration `011`). It shares its vocabulary with the
[Candidate Intelligence Profile](../candidate-profile/README.md): identity, role family, the 1–6
seniority scale, `Traced<T>` values and `Scope`. That lets the two be compared field by field.

| File | Role |
|---|---|
| `schema.ts` | Types, `ROLE_PROFILE_SCHEMA_VERSION`, `ROLE_PROFILE_EXTRACTOR_VERSION`, `RoleProfileReference` |
| `extract.ts` | Text preparation, page assessment and deterministic extraction |
| `store.ts` | `ensureRoleProfiles()`: batched cache read, extraction of misses, one upsert |

## Pipeline (source-agnostic)

Workday, Greenhouse, Lever, custom career sites and pasted text all go through the same steps. The
provider is recorded for provenance only; extraction never branches on it.

1. **Prepare.** Normalise the text and drop navigation or UI chrome ("Sign in", "Apply", "Share",
   cookie banners, ©…). Cut everything from a "Similar jobs / Related roles / Jobs you may like"
   marker onward, so other postings never become requirements. If the title isn't already in the
   text, prepend it so it can be quoted as evidence. The cache key is
   `sha256(lower(title) + "\n" + cleaned text)`, so the same job with different page chrome hits the
   same entry.
2. **Assess the page:**
   - `job_page`;
   - `listing_page`: many separate job titles, few role lines;
   - `search_page`: "128 jobs found", filters, sorting;
   - `closed_posting`: "no longer accepting applications";
   - `inaccessible`: access denied, 404, JavaScript or captcha walls, login gates, almost no text;
   - `insufficient_content`.

   A pasted description is trusted as a job page unless it is clearly one of the other kinds.
   **Non-job pages yield no requirements, responsibilities or identity.**
3. **Extract** across the whole cleaned text (no prefix truncation):
   - sections: responsibilities, mandatory, preferred, other (benefits, about, EEO, pay);
   - unsectioned lines, using requirement and responsibility cues;
   - per-line overrides ("a plus", "nice to have" → preferred; "must", "required" → mandatory).

## What it contains

- **page:** kind, reasons and evidence.
- **source:** kind (`url` or `pasted`), provider, canonical URL (URL sources only), content hash,
  raw and meaningful character counts, removed chrome lines, chunks.
- **role_family**, from the title.
- **identity:** `ic | technical_lead | people_manager | executive | hybrid`. **Decided by the
  responsibilities and requirements; the title is only a prior.**
  - People-management strength counts distinct markers: reports, reviews, hiring, career growth.
  - "Individual contributor" or "no direct reports" statements override manager titles.
  - Staff and principal engineers who lead technically remain `ic`.
  - `identity_signals` holds the raw counts.
- **seniority.minimum** (from mandatory overall years: 2–4 → 3, 5–7 → 4, 8–11 → 5, 12+ → 6) and
  **seniority.target** (the title level, raised to 5 for managers of managers).
- **mandatory_requirements / preferred_requirements:** each with a category (experience, skill,
  education, leadership, domain, other), skills, and years with area. **responsibilities.**
- **balance:** `hands_on | balanced | leadership`, from a stated percentage ("80% of your time
  writing code") or the ratio of hands-on to leadership signals.
- **expectations:** hands_on, architecture, people_management, stakeholder_product,
  delivery_ownership (`low/medium/high`, with `negated` for "no people management").
- **team** (direct reports, managers of managers), **domains** (benefit and EEO sentences are
  excluded, so "health insurance" is not a healthcare domain), and **experience** (minimum and
  maximum overall years, years by area such as "3+ years of people management").
- **constraints:** education, location, work mode (remote / hybrid / onsite) and work
  authorisation, each when present.
- **compensation:** **only** from a sentence that states pay (salary, compensation, pay, CTC, a
  currency symbol or code, a per-period phrase), and never when the range is followed by years,
  engineers, reports or %. Single figures and "competitive salary" stay unknown.
- **contradictions:**
  - `title_vs_responsibilities`: a manager or executive title with IC duties, or the reverse.
    Lead vs IC is not treated as a conflict.
  - `hands_on_vs_title`: a manager title with 70% or more hands-on work.
  - `title_vs_experience`: a level gap of 2 or more between the title and the required years.
  - `reports_conflict`, `work_mode_conflict`.
  - `ambiguity`: no requirements found.
- **unknowns:** every field without evidence.

Every value is a `Traced<T>` with `basis`, `confidence`, `rule` and verbatim evidence
(`text.slice(start, end) === quote`, offsets into the cleaned text, which is stored as
`source_text`).

## Example (fictional, abbreviated)

Input (pasted, title "Engineering Manager"):

```text
This is an individual contributor role with no direct reports.
You will spend 80% of your time writing code in Python.
Build and maintain data pipelines with Airflow and Spark.
Requirements:
4+ years of data engineering experience.
Strong Python and SQL.
Base salary: $140,000 - $170,000 per year.
```

Output:
- `page` is `job_page`.
- `identity` is `ic` (rule `explicit_individual_contributor`).
- `balance` is `hands_on`, with 80% hands-on stated.
- `expectations.people_management` is `{ value: low, negated: true }`.
- `experience.minimum_years` is 4, so `seniority.minimum` is 3; `seniority.target` is 4 from the
  title.
- `compensation` is `{ currency: USD, minimum: 140000, maximum: 170000, period: year }`, quoting the
  salary sentence.
- `contradictions` has two entries: `title_vs_responsibilities` ("The title suggests people manager,
  but the responsibilities describe ic.") and `hands_on_vs_title`.

## Caching and lifecycle

`/api/screen` calls `ensureRoleProfiles()` once per result flush:
- one `select … in (hashes)`;
- extraction only for hashes missing at the current schema and extractor version (identical
  content in the same batch is extracted once);
- one upsert.

Each screening result's `analysis_json.role_profile` gets a content-free `RoleProfileReference`.
**The verdict formula is unchanged.**

- Only `job_page`, `listing_page`, `search_page` and `closed_posting` are cached. Inaccessible and
  insufficient pages are usually transient (bot walls, partial loads), so they are re-evaluated next
  time. The table enforces this with a check constraint.
- Bumping `ROLE_PROFILE_EXTRACTOR_VERSION` or `ROLE_PROFILE_SCHEMA_VERSION` makes every cached row
  stale; each one is rebuilt the next time its content is screened.
- Without the table (migration not applied) or on any storage error, profiles are still built and
  attached, just not cached. Screening never fails because of this.
- **Provenance:** `source_kind`, `provider`, `canonical_url` (the first source seen for that
  content), `raw_sha256` (the exact raw input) and `source_text` (the cleaned text the evidence
  offsets refer to).

## Security

- `role_profiles` is server-only. RLS is on and no anon or authenticated privileges exist; only the
  service role reads and writes it. Rows carry **no user id**.
- Logs contain error codes and messages and row counts only, never job text. Unit tests assert this,
  and an end-to-end run's app log was checked.

## Limits

- Rule-based: unusual structure yields `unknowns` or `insufficient_content` rather than wrong values.
- Salary capture needs a range; a single figure ("$180,000 base") stays unknown.
- There is no AI-assisted extractor. If one is added later, it would ship as a new
  `extractor_version`, constrained to quotes that exist in `source_text`, with this deterministic
  extractor as the fallback.
