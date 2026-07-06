// LinkedIn collection/recommended/search-results URLs include ?currentJobId=XXX
// but redirect to an auth wall when fetched server-side (protocol-relative
// redirect → httpx error). Map them to the direct public job view URL which is
// scrapeable without auth. Also used client-side to dedupe pasted URLs before
// screening — different LinkedIn URL forms (recommended vs search-results page)
// pointing at the same job normalize to the same canonical string here.
export function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname.includes('linkedin.com') &&
      parsed.searchParams.has('currentJobId')
    ) {
      const jobId = parsed.searchParams.get('currentJobId')!
      return `https://www.linkedin.com/jobs/view/${jobId}/`
    }
  } catch {
    // not a valid URL, pass through as-is
  }
  return url
}

// Cheap defense-in-depth before forwarding a user-supplied URL to the
// screening service to be fetched server-side. Hostname-string based, not a
// DNS-resolution check — a domain that *resolves* to a private/link-local IP
// (DNS rebinding) will still pass this and must be caught by the fetching
// service itself at connect time. This just rejects the obvious cases and
// non-http(s) schemes before they ever leave this app.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, includes the 169.254.169.254 cloud metadata endpoint
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
]

export function isSafeJobUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname.toLowerCase()
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(hostname))) return false
  return true
}
