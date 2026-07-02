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
