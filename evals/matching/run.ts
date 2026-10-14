// Requirement-matching evaluation. See src/lib/matching/README.md.
//   npm run eval:matching            # labelled matching cases + Sprint 0 structural agreement
//   npm run eval:matching -- --json /tmp/match.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { extractCandidateProfile } from '@/lib/candidate-profile/extract'
import { extractRoleProfile } from '@/lib/role-profile/extract'
import { matchProfiles } from '@/lib/matching/engine'
import type { MatchStatus, RequirementMatch } from '@/lib/matching/schema'
import { loadCases } from '../recommendation/cases'
import { fingerprint } from '../recommendation/metrics'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const pasted = { kind: 'pasted' as const, provider: null, canonical_url: null }
/** Favourability order: higher means a stronger claim about the candidate. */
const RANK: Record<MatchStatus | 'missing_row', number> = { strong: 5, partial: 4, transferable: 3, unknown: 2, unsupported: 1, explicit_gap: 0, missing_row: -1 }
const ESTABLISHED = new Set<MatchStatus>(['strong', 'partial'])

interface Label { kind: string; concept: string | null; status: MatchStatus; why: string }
interface MatchCase { id: string; title: string; group: string; candidate: { resume_text: string }; job: { title: string; text: string }; expected: Label[] }

function loadMatchCases(): MatchCase[] {
  const dir = path.join(HERE, 'cases')
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as MatchCase)
}

function find(rows: RequirementMatch[], label: Label) {
  return rows.find((r) => r.requirement.kind === label.kind && (!label.concept || r.requirement.concepts.includes(label.concept)))
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a')
function percentile(values: number[], p: number) { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0 }

function main() {
  const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i >= 0 ? process.argv[i + 1] : null })()
  const cases = loadMatchCases()
  let labelled = 0, correct = 0, establishedPredicted = 0, establishedCorrect = 0, unsupportedPromoted = 0, deterministic = 0
  const falsePositives: Array<{ id: string; kind: string; concept: string | null; gold: MatchStatus; got: string }> = []
  const misses: string[] = []
  const matchMs: number[] = [], endToEndMs: number[] = []
  const byGroup: Record<string, { n: number; ok: number }> = {}
  const report: unknown[] = []

  for (const c of cases) {
    const t0 = performance.now()
    const candidate = extractCandidateProfile(c.candidate.resume_text)
    const role = extractRoleProfile({ text: c.job.text, title: c.job.title, source: pasted })
    const matrix = matchProfiles(candidate, role)
    endToEndMs.push(performance.now() - t0)
    for (let i = 0; i < 20; i += 1) { const t = performance.now(); matchProfiles(candidate, role); matchMs.push(performance.now() - t) }
    if (fingerprint(matchProfiles(candidate, role)) === fingerprint(matrix) && JSON.stringify(matchProfiles(candidate, role)) === JSON.stringify(matrix)) deterministic += 1

    const group = (byGroup[c.group] ??= { n: 0, ok: 0 })
    for (const label of c.expected) {
      const row = find(matrix.rows, label)
      const got = row?.status ?? 'missing_row'
      labelled += 1; group.n += 1
      if (got === label.status) { correct += 1; group.ok += 1 } else misses.push(`${c.id} ${label.kind}${label.concept ? `:${label.concept}` : ''} expected ${label.status} got ${got}`)
      if (row && ESTABLISHED.has(row.status)) { establishedPredicted += 1; if (ESTABLISHED.has(label.status)) establishedCorrect += 1 }
      if (label.status === 'unsupported' && row && ESTABLISHED.has(row.status)) unsupportedPromoted += 1
      if (RANK[got] > RANK[label.status]) falsePositives.push({ id: c.id, kind: label.kind, concept: label.concept, gold: label.status, got })
    }
    report.push({ id: c.id, fit_score: matrix.summary.fit_score, rows: matrix.rows.map((r) => ({ requirement: r.requirement.normalized, mandatory: r.requirement.mandatory, status: r.status, basis: r.basis })) })
  }

  // Sprint 0 fixtures: structural rows vs the fixtures' expected dimensions (no requirement-level labels there).
  const s0 = loadCases()
  const agree = { identity: [0, 0], hands_on: [0, 0], leadership: [0, 0] }
  const shadow = { agree: 0, n: 0 }
  for (const c of s0) {
    const m = matchProfiles(extractCandidateProfile(c.candidate.resume_text), extractRoleProfile({ text: c.job.jd_text, title: c.job.title, source: pasted }))
    const row = (kind: string) => m.rows.find((r) => r.requirement.kind === kind)
    const id = row('identity')
    if (id && id.status !== 'unknown') { agree.identity[1] += 1; if ((id.status === 'strong' || id.status === 'partial') === c.expected.role_identity_aligned) agree.identity[0] += 1 }
    const h = row('hands_on')
    if (h && h.status !== 'unknown' && c.expected.hands_on_fit !== 'n/a') { agree.hands_on[1] += 1; if ((h.status === 'strong' || h.status === 'partial') === (c.expected.hands_on_fit === 'fit' || c.expected.hands_on_fit === 'partial')) agree.hands_on[0] += 1 }
    const p = row('people_management')
    if (p && p.status !== 'unknown' && c.expected.leadership_scope_fit !== 'n/a') { agree.leadership[1] += 1; if ((p.status === 'strong' || p.status === 'partial') === (c.expected.leadership_scope_fit === 'fit' || c.expected.leadership_scope_fit === 'partial')) agree.leadership[0] += 1 }
    if (c.expected.verdict !== 'REJECT') {
      const band = m.summary.fit_score >= 85 ? 'STRONG' : m.summary.fit_score >= 70 ? 'DECENT' : 'WEAK'
      shadow.n += 1; if (band === c.expected.verdict) shadow.agree += 1
    }
  }

  const fpByKind = falsePositives.reduce<Record<string, number>>((acc, fp) => { acc[fp.kind] = (acc[fp.kind] ?? 0) + 1; return acc }, {})
  console.log(`Requirement matching eval: ${cases.length} labelled cases, ${labelled} labelled requirement rows (node ${process.version})`)
  console.log(`  requirement accuracy      ${pct(correct, labelled)} (${correct}/${labelled})   by group: ${Object.entries(byGroup).map(([g, v]) => `${g} ${v.ok}/${v.n}`).join(', ')}`)
  console.log(`  established precision     ${pct(establishedCorrect, establishedPredicted)} (${establishedCorrect}/${establishedPredicted} rows marked strong/partial were truly strong/partial)`)
  console.log(`  unsupported promoted      ${unsupportedPromoted} (claims-only rows reported as established; must be 0)`)
  console.log(`  false positives           ${falsePositives.length}${falsePositives.length ? `  by kind: ${JSON.stringify(fpByKind)}` : ''}`)
  for (const fp of falsePositives) console.log(`    - ${fp.id} ${fp.kind}${fp.concept ? `:${fp.concept}` : ''}: gold ${fp.gold}, got ${fp.got}`)
  if (misses.length) console.log(`  disagreements             ${misses.length}\n${misses.map((m) => `    - ${m}`).join('\n')}`)
  console.log(`  deterministic             ${deterministic}/${cases.length} cases produce identical matrices on repeat`)
  console.log(`  latency (match only)      p50 ${percentile(matchMs, 50).toFixed(3)}ms  p95 ${percentile(matchMs, 95).toFixed(3)}ms  max ${percentile(matchMs, 100).toFixed(3)}ms`)
  console.log(`  latency (extract + match) p50 ${percentile(endToEndMs, 50).toFixed(3)}ms  max ${percentile(endToEndMs, 100).toFixed(3)}ms`)
  console.log(`\nSprint 0 fixtures (structural rows vs expected dimensions; informational)`)
  console.log(`  identity alignment        ${pct(agree.identity[0], agree.identity[1])} of ${agree.identity[1]} judged`)
  console.log(`  hands-on fit              ${pct(agree.hands_on[0], agree.hands_on[1])} of ${agree.hands_on[1]} judged`)
  console.log(`  people-management fit     ${pct(agree.leadership[0], agree.leadership[1])} of ${agree.leadership[1]} judged`)
  console.log(`  shadow verdict from fit   ${pct(shadow.agree, shadow.n)} of ${shadow.n} non-REJECT cases (unvalidated bands 85/70; production verdict unchanged)`)
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ labelled, correct, establishedPredicted, establishedCorrect, unsupportedPromoted, falsePositives, misses, deterministic, cases: report, sprint0: { agree, shadow } }, null, 2)}\n`)
  if (unsupportedPromoted > 0 || deterministic !== cases.length) process.exitCode = 1
}

main()
