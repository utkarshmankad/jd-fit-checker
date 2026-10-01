# Anonymous first-verdict experiment

## Problem

Early interest did not convert into a completed profile, resume upload or job scan. The existing journey asks a visitor to invest personal data and setup effort before experiencing JobSnob's core value.

## Hypothesis

If a visitor can paste one job description and receive a useful provisional verdict without signing in or uploading a resume, more visitors will reach the first value moment and some will continue to the full profile-based screening flow.

## Experiment

- The landing-page primary action opens `/try`.
- The visitor pastes one job description and supplies five lightweight inputs.
- A deterministic, browser-only scorer returns a provisional `STRONG`, `DECENT`, `WEAK` or `REJECT` verdict.
- The result explains its evidence and offers an optional sign-in path for full screening.
- The experiment does not call screening services, upload a resume, consume quota, or write to the database.

## Measurement

Events:

- `anonymous_try_viewed`
- `anonymous_try_started`
- `anonymous_verdict_completed` with `verdict` and `attempt_number`
- `anonymous_upgrade_clicked` with `verdict`

For the first five observed testers, the experiment succeeds when:

- at least three reach a provisional verdict without assistance; and
- at least two either complete a second verdict (`attempt_number >= 2`) or click the profile upgrade action.

This is an activation experiment, not a claim that the provisional verdict is equivalent to resume-based screening.
