# Public demo sprint — 1 October 2026

Roadmap: https://github.com/utkarshmankad/jd-fit-checker/issues/50

Sprint and acceptance checklist: https://github.com/utkarshmankad/jd-fit-checker/issues/51

Branch: `feat/public-demo`, based on `dev` at `01d6e5a`.

## Evidence and scope

The owner reports zero real user scans. The landing page sent visitors directly to sign-in, and the existing sample batch was behind dashboard authentication. This increment offers an anonymous, read-only `/demo` using the existing example data. Employer names are replaced by generic example labels, and candidate assumptions and fictional status are explicit. Native HTML details expose reasoning by keyboard or touch. Demo activity has separate `demo_viewed` and `demo_sign_in_clicked` events; it must not count as a real scan.

No schema, auth, quota, screening backend, scoring or personal resume changes. The demo offers no write controls.

Existing work is preserved: #39–42 implementations were merged through #43, #45, #46 and #47, then promoted in #49. Their remaining real-data verification is tracked in roadmap #50, not recreated here.

## Reproduce validation

1. `npm ci`
2. `npm run typecheck && npm run lint && npm run build` with the same build-only placeholder variables as `.github/workflows/ci.yml`.
3. Start the built app with `npm run start -- --hostname 127.0.0.1` and placeholder Supabase values. Keep production analytics keys unset for local checks.
4. `npm run test:demo:http` verifies public SSR, fictional context, all verdicts, native details, landing link, sign-in availability, protected dashboard redirect and separate analytics helpers.
5. `npx playwright install chromium`, then `npm run test:demo` verifies anonymous navigation, keyboard disclosure, absence of API mutations, mobile fit and sign-in/protected dashboard behavior. Use `DEMO_BASE_URL` for an alternate local port.

Browser tests block external requests so local checks cannot send analytics to a production project. They use a fresh anonymous browser context.

## Release boundary and next action

Track current validation and PR links in #51. Required `verify` CI must pass before merging into dev. Next, verify the actual Vercel dev preview with real environment values, including sign-in and analytics setup, before opening dev-to-main promotion. A public demo does not by itself resolve zero activation: compare demo visits/sign-in intent with real screening start/completion after release.

Do not publish the launch draft below until a meaningful production deployment is verified and the destination's current rules and existing announcements have been checked.

## Ready announcement draft — unpublished

GitHub release title: **Public sample verdicts before sign-in**

Release notes (only after production verification):

> JobSnob now offers a public, read-only sample at https://jobsnob.fyi/demo. You can explore fictional job verdicts and expand the reasons before creating an account. The examples disclose their candidate assumptions and do not use your profile or screening quota. Real screening and demo analytics remain separate. This release does not change scoring, the screening backend or database policies.

Proposed Hacker News destination: Show HN, subject to checking https://news.ycombinator.com/showhn.html and earlier JobSnob posts immediately before posting.

Title: **Show HN: JobSnob – filter job descriptions against your own dealbreakers**

Link: https://jobsnob.fyi/demo

Comment draft:

> I built JobSnob to help job seekers decide which descriptions deserve their application time. You save your resume and dealbreakers, then submit job URLs or pasted descriptions for STRONG, DECENT, WEAK or REJECT verdicts with reasons.
>
> The public sample is https://jobsnob.fyi/demo. It shows fictional examples for an example engineering manager, without requiring an account. It is a demonstration, not a live screening of your background or a list of current vacancies. To screen your own jobs, sign in and configure your profile at https://jobsnob.fyi.
>
> Source: https://github.com/utkarshmankad/jd-fit-checker. I would like feedback on whether the reasons help you decide to apply or skip, and which signals you would want explained more clearly.

Publication status: **not published; no verified announcement URL**. Candidate availability is not production availability.
