# JD Fit Checker

Screen job descriptions against your profile and preferences using AI. Paste JD text or drop LinkedIn job URLs — get ATS scores, role-level scores, composite verdicts, and gap analysis in seconds.

## Features

- **Bulk URL screening** — paste up to 20 LinkedIn job URLs, screened in parallel
- **JD text screening** — paste raw job description text (up to 10 at once)
- **LinkedIn bulk import** — console script to collect all recommended jobs with one copy-paste
- **Profile-based matching** — auto-reject rules and preferences used as resume context when no resume is uploaded
- **Resume upload** — upload PDF or TXT to autofill profile preferences (never stored)
- **Scoring** — ATS score, role level score, composite score, STRONG / DECENT / WEAK / REJECT verdict
- **History** — searchable, filterable, sortable log of all screenings; duplicates hidden by default
- **CSV export** — download any batch as a CSV
- **Shareable reports** — public report link (30-day expiry) for sharing results without login
- **Paid tier** — unlimited screens via Razorpay (₹499 one-time); free tier allows 5 screens/month

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Auth | Supabase Auth (email+password, Google OAuth, invite flow) |
| Database | Supabase Postgres with RLS |
| AI screening | FastAPI backend (separate service) via `NEXT_PUBLIC_SCREENING_API_URL` |
| Resume parsing | `pdf-parse` v1 + user's own AI API key (Anthropic or OpenAI) |
| Payments | Razorpay (order + webhook) |
| Deployment | Vercel (frontend) + any host for FastAPI |

## Project Structure

```
src/
├── app/
│   ├── (app)/
│   │   ├── dashboard/
│   │   │   ├── page.tsx          # Main screen page (URL + JD text input)
│   │   │   └── history/
│   │   │       └── page.tsx      # Screening history with search/filter/sort
│   │   └── profile/
│   │       └── page.tsx          # Profile, preferences, API key, resume upload
│   ├── auth/
│   │   ├── login/page.tsx        # Email/password + Google sign-in
│   │   ├── register/             # Post-signup registration (name + password)
│   │   ├── callback/route.ts     # OAuth code exchange
│   │   ├── confirm/route.ts      # Email confirmation / invite token exchange
│   │   └── logout/route.ts
│   ├── api/
│   │   ├── screen/route.ts       # POST: calls FastAPI, saves results to DB
│   │   ├── screen/history/route.ts # GET: paginated history (lightweight columns only)
│   │   ├── profile/route.ts      # GET/PUT: profile CRUD
│   │   ├── parse-resume/route.ts # POST: PDF/TXT upload → AI-parsed preferences
│   │   ├── export/route.ts       # GET: CSV export for a batch
│   │   ├── share/route.ts        # POST: create shareable report slug
│   │   ├── report/[slug]/route.ts
│   │   ├── payment/
│   │   │   ├── create-order/route.ts
│   │   │   └── verify/route.ts
│   │   └── webhook/razorpay/route.ts
│   ├── report/[slug]/page.tsx    # Public shareable report page (no auth)
│   └── page.tsx                  # Root (redirects based on auth state)
├── components/
│   ├── auth-hash-redirect.tsx    # Handles Supabase implicit flow hash tokens
│   ├── layout/DashboardShell.tsx # Sidebar nav + mobile drawer
│   └── payment/PaymentModal.tsx  # Razorpay checkout modal
├── lib/
│   ├── supabase/{client,server,service,middleware}.ts
│   └── utils/crypto.ts           # AES-GCM encryption for stored API keys
├── proxy.ts                      # Next.js middleware (auth guards, route redirects)
└── types/index.ts
```

## Getting Started

### 1. Clone and install

```bash
git clone <repo>
cd jd-fit-checker
npm install
```

### 2. Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Enable Google OAuth under Authentication → Providers (optional)
4. Set Site URL to your app URL; add `/auth/callback` to redirect allow-list
5. Optionally enable `pg_cron` and schedule the monthly screen counter reset (see comment at bottom of `schema.sql`)

Add the recommended index for history query performance:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screening_results_user_created
  ON screening_results (user_id, created_at DESC);
```

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY=         # Service role key (server-only)
NEXT_PUBLIC_SCREENING_API_URL=     # FastAPI base URL (e.g. https://api.yourapp.com)
NEXT_PUBLIC_APP_URL=               # App base URL (used for shareable report links)
ENCRYPTION_SECRET=                 # 64-char hex string for AES-GCM key encryption
RAZORPAY_KEY_ID=                   # Razorpay key ID
RAZORPAY_KEY_SECRET=               # Razorpay key secret
NEXT_PUBLIC_RAZORPAY_KEY_ID=       # Same key ID (exposed to client for checkout)
RAZORPAY_WEBHOOK_SECRET=           # Razorpay webhook signing secret
```

Generate `ENCRYPTION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. FastAPI backend

The AI screening logic lives in a separate FastAPI service. It must expose:

```
POST /screen
Body: {
  resume_text: string,
  jd_text?: string,
  job_url?: string,
  hard_reject_filters: object,
  api_key: string,
  api_provider: "openai" | "anthropic"
}
```

Point `NEXT_PUBLIC_SCREENING_API_URL` at wherever you deploy it.

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Key Flows

### Authentication

- **Email sign-up** → email confirmation link → `/auth/confirm` → `/auth/register` (set name + password) → `/dashboard`
- **Google OAuth** → `/auth/callback` → `/dashboard` (registration auto-completed)
- **Invite link** → Supabase sends email with `#access_token=` hash → `AuthHashRedirect` component detects hash client-side → `/auth/register`
- **Middleware** (`proxy.ts`) guards all `/dashboard`, `/profile`, and `/api/*` routes; redirects unauthenticated users to `/auth/login`

### Screening

1. User pastes URLs or JD text on the dashboard
2. Frontend calls `POST /api/screen` with `urls[]` or `jd_entries[]` and a `batch_id`
3. API route decrypts the user's AI API key, synthesizes resume context from saved preferences, calls FastAPI for each JD
4. Results are saved to `screening_results` and returned to the client
5. LinkedIn collection/recommended URLs are normalised to `/jobs/view/{id}/` before sending to FastAPI

### LinkedIn bulk import

1. Go to [LinkedIn Recommended Jobs](https://www.linkedin.com/jobs/collections/recommended/) while logged in
2. Open DevTools console (`F12` / `Cmd ⌥ J`)
3. Copy and run the script from the "Bulk import from LinkedIn Recommended" panel on the dashboard
4. Script auto-scrolls, collects up to 20 job IDs, copies URLs to clipboard
5. Paste into the URL input → Screen JDs

### Profile and resume

- **API key** — stored AES-GCM encrypted in `profiles.api_key_encrypted`; never returned to client in plaintext
- **Resume upload** — PDF or TXT (max 5 MB); parsed server-side via `pdf-parse` + AI call; result autofills preference fields; file is never persisted
- **Preferences** — saved as `preferences` and `hard_reject_filters` JSONB in `profiles`; used as resume context for screening when no resume text is stored
- **Clear prefs** — single button resets all 8 preference fields

### History

- Shows all screening results, deduplicated by `(company, job_title)` exact match (newest kept)
- Search by company or role name
- Filter by verdict (STRONG / DECENT / WEAK / REJECT)
- Sort by newest or oldest
- Export any batch as CSV
- Toggle to show hidden duplicates

### Sharing

- Click Share on any batch → `POST /api/share` creates a `shared_reports` row with a random 8-char slug
- Public URL `/report/{slug}` is accessible without authentication
- Links expire after 30 days

### Payments

- Free tier: 5 screens/month
- Paid tier: unlimited (₹499 one-time via Razorpay)
- Payment verified both client-side (`POST /api/payment/verify`) and via Razorpay webhook (`POST /api/webhook/razorpay`)
- Webhook also handles subscription cancellation (reverts to free tier)

## Database Schema

| Table | Purpose |
|---|---|
| `profiles` | One row per user; stores name, encrypted API key, preferences, tier |
| `screening_results` | One row per JD screened; grouped by `batch_id` |
| `shared_reports` | Stores snapshots for public report URLs |

RLS enabled on all tables — users can only read/write their own rows. `shared_reports` allows public select for the report viewer.

## Deployment

### Vercel

```bash
vercel deploy
```

Set all env vars in the Vercel project dashboard. The `NEXT_PUBLIC_*` vars must be set before build time.

### Razorpay webhook

Add your Vercel URL + `/api/webhook/razorpay` as a webhook endpoint in the Razorpay dashboard. Subscribe to `payment.captured` and `subscription.cancelled` events.
