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
    // Tracking/filter parameters do not identify a different posting. Keeping
    // them would fragment the shared cache (the same Workday requisition was
    // commonly submitted with and without locationCountry).
    const trackingKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'sourceType', 'locationCountry']
    trackingKeys.forEach((key) => parsed.searchParams.delete(key))
    parsed.hash = ''
    return parsed.toString()
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

// Parses a hostname as an IPv4 literal in ANY of the forms browsers/fetch
// clients accept (decimal, hex, octal, and 1-4 dotted parts per the classic
// inet_aton rules) — "2130706433", "0x7f000001", "017700000001", and
// "0x7f.0.0.1" all mean 127.0.0.1, but none of those match a plain
// "^127\." string check. Returns the 32-bit value, or null if hostname
// isn't a numeric IPv4 literal in any recognized form.
function parseIPv4Literal(hostname: string): number | null {
  const parts = hostname.split('.')
  if (parts.length > 4 || parts.length === 0) return null
  const nums: number[] = []
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*|0)$/i.test(part)) return null
    const n = /^0x/i.test(part) ? parseInt(part, 16) : /^0[0-7]+$/.test(part) ? parseInt(part, 8) : parseInt(part, 10)
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null
    nums.push(n)
  }
  let ip: number
  if (nums.length === 4) {
    if (nums.some((n) => n > 255)) return null
    ip = ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0
  } else if (nums.length === 3) {
    if (nums[0] > 255 || nums[1] > 255 || nums[2] > 0xffff) return null
    ip = ((nums[0] << 24) | (nums[1] << 16) | nums[2]) >>> 0
  } else if (nums.length === 2) {
    if (nums[0] > 255 || nums[1] > 0xffffff) return null
    ip = ((nums[0] << 24) | nums[1]) >>> 0
  } else {
    ip = nums[0] >>> 0
  }
  return ip
}

function isPrivateIPv4(ip: number): boolean {
  const a = (ip >>> 24) & 0xff
  const b = (ip >>> 16) & 0xff
  if (a === 127) return true // loopback
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local, incl. 169.254.169.254 cloud metadata
  if (ip === 0) return true // 0.0.0.0
  return false
}

export function isSafeJobUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  // Node's URL keeps the [brackets] in .hostname for IPv6 literals — without
  // stripping them, none of the IPv6 patterns below (::1, fc00:, fe80:) ever
  // match, since they all anchor on ^ with no bracket in the pattern.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(hostname))) return false

  // IPv4 literal in a non-dotted-decimal encoding (decimal/hex/octal) —
  // the regexes above only match the canonical "127.0.0.1" form.
  const ipv4 = parseIPv4Literal(hostname)
  if (ipv4 !== null && isPrivateIPv4(ipv4)) return false

  // IPv6-mapped IPv4, e.g. "::ffff:127.0.0.1" or its normalized hex-group
  // form "::ffff:7f00:1" (the URL parser rewrites the dotted form to this) —
  // extract the embedded IPv4 and re-check it.
  const mappedDotted = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  const mappedHex = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  let embedded: number | null = null
  if (mappedDotted) {
    embedded = parseIPv4Literal(mappedDotted[1])
  } else if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      embedded = (((hi >>> 0) << 16) | (lo >>> 0)) >>> 0
    }
  }
  if (embedded !== null && isPrivateIPv4(embedded)) return false

  return true
}
