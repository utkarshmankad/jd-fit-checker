import { lookup } from 'node:dns/promises'
import { createHash } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { isSafeJobUrl, normalizeJobUrl } from '@/lib/utils/url'

export type ExtractedJob = { canonicalUrl: string; provider: string; externalJobId?: string; jobTitle?: string; company?: string; jdText: string; extraction: 'structured' | 'ats' | 'generic' }
const MAX_BYTES = 2_000_000; const TIMEOUT_MS = 4_500

function isPrivate(address: string): boolean {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|fe8|fe9|fea|feb)/i.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
}

async function publicAddress(url: string): Promise<string> {
  if (!isSafeJobUrl(url)) throw new Error('Unsupported or unsafe URL')
  const host = new URL(url).hostname
  const records = await lookup(host, { all: true })
  if (!records.length || records.some((record) => isPrivate(record.address))) throw new Error('Unsupported or unsafe URL')
  return records[0].address
}

async function boundedFetch(url: string, accept = 'text/html,application/json'): Promise<{ url: string; text: string; contentType: string }> {
  let current = url
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(current); const address = await publicAddress(current)
    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const transport = parsed.protocol === 'https:' ? https : http
      const req = transport.request({
        protocol: parsed.protocol, hostname: address, port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`, method: 'GET',
        headers: { Host: parsed.host, Accept: accept, 'User-Agent': 'Mozilla/5.0 (compatible; JobSnob/1.0; +https://jobsnob.fyi)' },
        // Connect directly to the address validated above while retaining the
        // original host for TLS and virtual hosting. No second DNS lookup occurs.
        servername: parsed.hostname,
      }, (res) => {
        const chunks: Buffer[] = []; let size = 0
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) req.destroy(new Error('Page is too large')); else chunks.push(chunk) })
        res.on('end', () => resolve({ status: res.statusCode ?? 500, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
      })
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
      req.on('error', reject); req.end()
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location; if (!location) throw new Error('Invalid redirect')
      current = new URL(location, current).toString(); continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
    return { url: current, text: response.text, contentType: String(response.headers['content-type'] ?? '') }
  }
  throw new Error('Too many redirects')
}

function decode(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/li>|<\/div>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function walkJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) { for (const item of value) { const found = walkJobPosting(item); if (found) return found } }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>; const type = obj['@type']
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return obj
    for (const child of Object.values(obj)) { const found = walkJobPosting(child); if (found) return found }
  }
  return null
}

function jsonLd(html: string): { jdText: string; jobTitle?: string; company?: string } | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const posting = walkJobPosting(JSON.parse(match[1])); const description = posting?.description
      if (typeof description === 'string' && decode(description).split(/\s+/).length >= 80) {
        const hiring = posting?.hiringOrganization as Record<string, unknown> | undefined
        return { jdText: decode(description), jobTitle: typeof posting?.title === 'string' ? posting.title : undefined, company: typeof hiring?.name === 'string' ? hiring.name : undefined }
      }
    } catch { /* malformed page JSON */ }
  }
  return null
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'))
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'))
  return decode(a?.[1] ?? b?.[1] ?? '') || undefined
}

function generic(html: string): { jdText: string; jobTitle?: string; company?: string } | null {
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
  const candidates = [...cleaned.matchAll(/<(?:main|article|section|div)[^>]*(?:id|class)=["'][^"']*(?:job[-_ ]?(?:description|details|content)|posting[-_ ]?(?:description|content)|description)[^"']*["'][^>]*>([\s\S]*?)<\/(?:main|article|section|div)>/gi)].map((x) => decode(x[1])).filter((x) => x.split(/\s+/).length >= 80)
  const jdText = candidates.sort((a, b) => b.length - a.length)[0]
  if (!jdText) return null
  return { jdText, jobTitle: meta(html, 'og:title'), company: meta(html, 'og:site_name') }
}

function identify(url: URL): { provider: string; externalJobId?: string; apiUrl?: string } {
  const host = url.hostname.toLowerCase(); const parts = url.pathname.split('/').filter(Boolean)
  const wd = host.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (wd && parts.includes('job')) { const i = parts.indexOf('job'); const path = parts.slice(i + 1).join('/'); return { provider: 'workday', externalJobId: parts.at(-1)?.match(/_([^_/?]+)$/)?.[1], apiUrl: `${url.protocol}//${host}/wday/cxs/${wd[1]}/${parts[i - 1]}/job/${path}` } }
  if (host === 'job-boards.greenhouse.io' && parts.at(-2) === 'jobs') return { provider: 'greenhouse', externalJobId: parts.at(-1), apiUrl: `https://boards-api.greenhouse.io/v1/boards/${parts.at(-3)}/jobs/${parts.at(-1)}` }
  if (host === 'jobs.lever.co' && parts.length >= 2) return { provider: 'lever', externalJobId: parts[1], apiUrl: `https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}` }
  return { provider: host.replace(/^www\./, '') }
}

async function ats(url: URL, identified: ReturnType<typeof identify>): Promise<ExtractedJob | null> {
  if (!identified.apiUrl) return null
  const response = await boundedFetch(identified.apiUrl, 'application/json'); const data = JSON.parse(response.text) as Record<string, unknown>
  let raw: string | undefined; let title: string | undefined; let company: string | undefined
  if (identified.provider === 'workday') { const posting = data.jobPostingInfo as Record<string, unknown>; raw = posting?.jobDescription as string; title = posting?.title as string }
  if (identified.provider === 'greenhouse') { raw = data.content as string; title = data.title as string; company = (data.company as Record<string, unknown> | undefined)?.name as string }
  if (identified.provider === 'lever') { raw = (data.descriptionPlain as string) || (data.description as string); title = data.text as string; company = (data.categories as Record<string, unknown> | undefined)?.team as string }
  const jdText = decode(raw ?? ''); if (jdText.split(/\s+/).length < 80) return null
  return { canonicalUrl: normalizeJobUrl(url.toString()), provider: identified.provider, externalJobId: identified.externalJobId, jobTitle: title, company, jdText, extraction: 'ats' }
}

export async function fetchJobLightweight(input: string): Promise<ExtractedJob> {
  const canonicalUrl = normalizeJobUrl(input); const url = new URL(canonicalUrl); const identified = identify(url)
  const adapter = await ats(url, identified).catch(() => null); if (adapter) return adapter
  const response = await boundedFetch(canonicalUrl); const structured = jsonLd(response.text); const extracted = structured ?? generic(response.text)
  if (!extracted) throw new Error('Lightweight extraction could not find a complete job description')
  return { canonicalUrl, provider: identified.provider, externalJobId: identified.externalJobId, ...extracted, extraction: structured ? 'structured' : 'generic' }
}

export function jobContentHash(text: string): string { return createHash('sha256').update(text).digest('hex') }
