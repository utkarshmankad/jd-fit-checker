// Deterministic Role Intelligence Profile extraction.
//
// Source-agnostic: Workday, Greenhouse, Lever, custom career pages and pasted
// descriptions all arrive as text and go through the same pipeline:
//   1. strip navigation / UI chrome and cut unrelated "similar jobs" tails,
//   2. classify the page (job page vs listing / search / closed / inaccessible),
//   3. extract sections, requirements and expectations from the whole text.
// Pure function: no network, model or clock, so the same content always yields
// the same profile and AI outages cannot affect it.
import { createHash } from 'node:crypto'
import {
  chunkResume, clamp, DOMAINS, negatedBefore, normaliseResume, ref, SKILLS, splitUnits, titleFamily, titleLevel, type Unit,
} from '@/lib/candidate-profile/extract'
import { extractSalaryRange } from '@/lib/jobs/salary'
import {
  ROLE_PROFILE_EXTRACTOR_VERSION, ROLE_PROFILE_SCHEMA_VERSION,
  type Compensation, type EvidenceRef, type PageAssessment, type PageKind, type ProfessionalIdentity,
  type Requirement, type RequirementCategory, type RoleIntelligenceProfile, type RoleSource, type Scope, type SeniorityLevel, type Traced,
} from './schema'

export interface RoleInput {
  text: string
  title?: string | null
  source: RoleSource
}

const MAX_ITEMS = 30
const MAX_EVIDENCE = 3

// ── Text preparation ────────────────────────────────────────────────────────

const NAV_LINE = /^(?:home|careers?|jobs?|all jobs|search(?: jobs)?|sign in|log ?in|sign up|register|apply(?: now| here| for this (?:job|position|role))?|share(?: this (?:job|role|position))?|save(?: this)?(?: job)?|saved jobs|back(?: to (?:jobs|search|results|all jobs|job search))?|menu|close|skip to (?:main )?content|privacy(?: policy| notice)?|terms(?: of (?:use|service))?|cookie (?:policy|settings|preferences)|accept(?: all)?(?: cookies)?|reject all|manage (?:cookies|preferences)|follow us|linkedin|twitter|facebook|instagram|youtube|glassdoor|view all jobs|see all (?:jobs|openings)|load more|show more|next|previous|english|language|job alerts?|create (?:a )?job alert|refer a friend|print|email this job|©.*|copyright.*|all rights reserved.*|powered by .*)[.!]?$/
const TAIL_MARKER = /^(?:similar|related|recommended|other|more) (?:jobs|roles|openings|positions|opportunities)\b|^jobs you (?:may|might) (?:also )?(?:like|be interested in)|^people (?:also )?viewed|^you may also like|^explore (?:more|other) (?:jobs|roles)/

function isBoilerplate(line: string): boolean {
  const l = line.toLowerCase().trim()
  if (!l) return false
  if (l.length <= 60 && NAV_LINE.test(l)) return true
  return /\bcookies?\b/.test(l) && /\b(?:we use|accept|consent|this (?:site|website) uses)\b/.test(l)
}

export interface PreparedRoleText {
  text: string
  rawCharacters: number
  removedLines: number
  contentSha256: string
  title: string | null
}

/** Normalises the source, removes chrome and unrelated tails, and prepends the title as evidence. */
export function prepareRoleText(input: RoleInput): PreparedRoleText {
  const lines = normaliseResume(input.text).split('\n')
  const kept: string[] = []
  let removed = 0
  let cut = false
  for (const line of lines) {
    if (cut || TAIL_MARKER.test(line.toLowerCase().trim())) { cut = true; removed += 1; continue }
    if (isBoilerplate(line)) { removed += 1; continue }
    kept.push(line)
  }
  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const title = input.title?.replace(/\s+/g, ' ').trim() || null
  if (title && !text.slice(0, 300).toLowerCase().includes(title.toLowerCase())) text = `${title}\n${text}`
  const contentSha256 = createHash('sha256').update(`${title?.toLowerCase() ?? ''}\n${text}`).digest('hex')
  return { text, rawCharacters: input.text.length, removedLines: removed, contentSha256, title }
}

// ── Sections ────────────────────────────────────────────────────────────────

type Section = 'intro' | 'responsibilities' | 'mandatory' | 'preferred' | 'other'
const HEADINGS: Array<[Exclude<Section, 'intro'>, RegExp]> = [
  ['preferred', /^(?:preferred(?: qualifications| skills| experience)?|nice[- ]to[- ]haves?|bonus(?: points)?|desired(?: skills| qualifications)?|pluses|it(?:'|’)?s a plus|good to have|extra credit|additional qualifications)\b/],
  ['mandatory', /^(?:requirements|minimum qualifications|basic qualifications|required qualifications|qualifications|must[- ]haves?|what you(?:'|’)?ll need|what you need|what we(?:'|’)?re looking for|what you bring|you have|you(?:'|’)?ll have|who you are|skills(?: and| &) experience|experience|about you)\b/],
  ['responsibilities', /^(?:responsibilities|key responsibilities|what you(?:'|’)?ll do|what you will do|your role|the role|in this role|role overview|day[- ]to[- ]day|your impact|what you(?:'|’)?ll be doing|duties|the opportunity|you will)\b/],
  ['other', /^(?:benefits|perks|what we offer|why join|about (?:us|the company|the team|[a-z]+)|our (?:company|mission|values)|equal (?:employment )?opportunity|eeo|diversity|compensation(?: and benefits)?|salary|pay(?: range| transparency)?|how to apply|application process|locations?|time type|job requisition id|posted on)\b/],
]

function headingOf(line: string): Exclude<Section, 'intro'> | null {
  const l = line.toLowerCase().trim().replace(/[:：]$/, '')
  if (!l || l.length > 70 || /[.!?]$/.test(l)) return null
  for (const [section, pattern] of HEADINGS) if (pattern.test(l)) return section
  return null
}

const PREFERRED_CUE = /\b(?:preferred|nice[- ]to[- ]have|(?:is )?a plus|bonus|ideally|desirable|good to have|advantageous|not required)\b/
const MANDATORY_CUE = /\b(?:must|required|minimum|at least)\b/
const REQUIREMENT_CUE = /\b(?:\d{1,2}\s*\+?\s*(?:-|–|to)?\s*\d{0,2}\s*\+?\s*years?|experience (?:with|in|building|leading|managing)|proficien\w*|degree|bachelor|master|knowledge of|familiarity with|strong (?:background|experience|understanding|skills)|you have|must have|required|expertise in|track record)\b/
const RESPONSIBILITY_START = /^(?:you will |you(?:'|’)ll |as (?:a|an|the) [a-z ]+, you will )?(?:build|design|lead|own|manage|drive|develop|write|mentor|partner|collaborate|ship|define|architect|deliver|implement|hire|grow|work|create|maintain|improve|scale|set|run|support|operate|review|coach|establish|champion|contribute)\b/

// ── Signals ─────────────────────────────────────────────────────────────────

const HANDS_ON = /\b(?:write|writing|writes|build|building|implement|implementing|code|coding|develop|developing|ship|shipping|debug|debugging|hands-on|hands on)\b/
const IC_STATEMENT = /\b(?:individual contributor|no (?:direct )?reports|not a (?:people )?management role|no people management|without direct reports)\b/
const PEOPLE_PARTS: RegExp[] = [
  /\b(?:manage|managing|lead and grow|grow and develop|develop and grow)\b[^.;]{0,40}\b(?:team|engineers|people|managers|reports)\b/,
  /\bdirect reports?\b/, /\bperformance (?:reviews?|management)\b/, /\bpeople management\b/, /\bcareer (?:growth|development) of\b/,
  /\b(?:hire|hiring|recruit)\b[^.;]{0,30}\b(?:engineers|team|talent)\b/,
]
const PEOPLE = /\b(?:manage|managing|lead and grow|grow and develop|develop and grow)\b[^.;]{0,40}\b(?:team|engineers|people|managers|reports)\b|\bdirect reports?\b|\bperformance (?:reviews?|management)\b|\bpeople management\b|\bcareer (?:growth|development) of\b|\b(?:hire|hiring|recruit)\b[^.;]{0,30}\b(?:engineers|team|talent)\b/
const LEAD = /\btech(?:nical)? lead\b|\btechnical (?:direction|leadership)\b|\blead (?:the )?(?:design|architecture|technical)\b|\bdesign reviews?\b|\bmentor(?:ing|s)?\b|\blead a (?:small )?team of \d+\b/
const EXECUTIVE = /\bexecutive (?:team|leadership)\b|\b(?:lead|run|own) the (?:engineering|technology) (?:organi[sz]ation|function|department)\b|\breport(?:ing|s)? (?:directly )?to the (?:ceo|founders?)\b/
const MANAGES_MANAGERS = /\b(?:manage|lead|hire|grow|develop|coach)\b[^.;]{0,30}\b(?:engineering )?managers\b/

const SCOPES: Record<keyof RoleIntelligenceProfile['expectations'], RegExp> = {
  hands_on: HANDS_ON,
  architecture: /\barchitect(?:ure|ing|s)?\b|\bsystem design\b|\bdesign (?:scalable|distributed|highly available|resilient)\b|\btechnical (?:strategy|direction|vision)\b|\bdesign reviews?\b/,
  people_management: PEOPLE,
  stakeholder_product: /\bproduct (?:managers?|team|partners|management)\b|\bstakeholders?\b|\bcross-functional\b|\bpartner with\b|\broadmap\b|\bexecutives?\b|\bcustomers?\b/,
  delivery_ownership: /\bown(?:ership|s)?\b|\bdeliver(?:y)?\b|\bend[- ]to[- ]end\b|\bon-call\b|\bdrive (?:execution|delivery|projects)\b|\bship\b|\blaunch\b|\baccountab\w*\b/,
}

const BENEFIT_CONTEXT = /\b(?:benefits?|insurance|pto|paid time off|401\(?k\)?|parental leave|wellness|medical|dental|vision|equal opportunity|employer)\b/
const PLACES = /\b(?:bengaluru|bangalore|hyderabad|pune|mumbai|delhi|new delhi|gurgaon|gurugram|noida|chennai|london|new york|san francisco|seattle|austin|berlin|toronto|singapore|dublin|amsterdam|india|united states|usa|united kingdom|uk|canada|germany)\b/
const SALARY_CUE = /\b(?:salary|compensation|pay range|base pay|pay|ctc|package|per (?:year|annum|month|hour)|lpa|lakhs?|crores?|ote)\b|\/(?:yr|year|hr|hour)\b|[$£€₹]\s?\d|\b(?:usd|inr|gbp|eur|cad|aud)\s?\d/

const yearsToLevel = (years: number): SeniorityLevel => (years >= 12 ? 6 : years >= 8 ? 5 : years >= 5 ? 4 : years >= 2 ? 3 : 2)

function titleIdentity(title: string): ProfessionalIdentity | null {
  const t = title.toLowerCase()
  if (/\b(?:vp|vice president|cto|chief|head of)\b/.test(t)) return 'executive'
  if (/\b(?:product|project|program|account|sales|marketing) manager\b/.test(t)) return null
  if (/\b(?:manager|director)\b/.test(t)) return 'people_manager'
  if (/\b(?:tech lead|technical lead|lead engineer|team lead|lead developer)\b/.test(t)) return 'technical_lead'
  return /\b(?:engineer|developer|programmer|architect|scientist|analyst)\b/.test(t) ? 'ic' : null
}

// ── Page assessment ─────────────────────────────────────────────────────────

const TITLE_LIKE = /\b(?:engineer|developer|manager|lead|director|architect|analyst|scientist|designer|specialist|consultant|intern)\b/

export function assessPage(prepared: PreparedRoleText, units: Unit[], sectionOf: (unit: Unit) => Section, headingUnits: Set<Unit>, sourceKind: RoleSource['kind']): PageAssessment {
  const text = prepared.text
  const content = units.filter((unit) => !headingUnits.has(unit))
  const roleUnits = content.filter((unit) => {
    const section = sectionOf(unit)
    return section === 'responsibilities' || section === 'mandatory' || section === 'preferred' || REQUIREMENT_CUE.test(unit.lower) || RESPONSIBILITY_START.test(unit.lower)
  })
  const headingCount = new Set([...headingUnits].map(sectionOf).filter((s) => s !== 'other')).size
  const evidence = (list: Unit[]) => list.slice(0, MAX_EVIDENCE).map((unit) => ref(text, unit))
  const hit = (pattern: RegExp) => content.filter((unit) => pattern.test(unit.lower))
  const result = (value: PageKind, confidence: number, rule: string, reasons: string[], list: Unit[]): PageAssessment =>
    ({ value, basis: 'inferred', confidence: clamp(confidence), rule, reasons, evidence: evidence(list.length ? list : content.slice(0, 1)) })

  const blocked = hit(/\b(?:access denied|403 forbidden|404|page not found|not found|enable javascript|captcha|are you a robot|verify you are human|sign in to (?:view|continue|apply)|you need to (?:log|sign) in|unauthori[sz]ed|something went wrong)\b/)
  if (text.length < 1500 && blocked.length && roleUnits.length < 3) return result('inaccessible', 0.9, 'error_or_gate_text', ['page shows an error, login gate or bot check instead of a job'], blocked)
  const closed = hit(/\b(?:no longer (?:available|accepting applications|open)|position has been filled|job (?:posting )?(?:has )?(?:expired|closed)|this (?:job|role|position) (?:is )?(?:closed|no longer)|not accepting applications)\b/)
  if (closed.length && roleUnits.length < 6) return result('closed_posting', 0.85, 'closed_notice', ['posting states it is closed or filled'], closed)
  if (text.length < (sourceKind === 'pasted' ? 60 : 120)) return result('inaccessible', 0.7, 'no_meaningful_text', ['almost no readable text after removing navigation'], content)
  const search = hit(/\b(?:search results|jobs? found|showing \d+\s*(?:-|–|to)\s*\d+ of \d+|\d+ (?:open )?(?:jobs|positions|roles|openings|results)(?: found| available| match)?|filter by|sort by|refine (?:your )?search|clear (?:all )?filters)\b/)
  const titleLines = content.filter((unit) => unit.text.split(/\s+/).length <= 8 && TITLE_LIKE.test(unit.lower) && !/[.:]$/.test(unit.text))
  if (search.length && headingCount === 0 && roleUnits.length < 4) return result('search_page', 0.85, 'search_controls', ['page contains search or filter controls and no single job description'], search)
  if (titleLines.length >= 5 && roleUnits.length < Math.max(4, titleLines.length / 2)) return result('listing_page', 0.8, 'many_job_titles', [`${titleLines.length} separate job titles and few requirement or responsibility lines`], titleLines)
  if (text.length >= 200 && (headingCount >= 1 || roleUnits.length >= 2)) return result('job_page', headingCount >= 2 ? 0.9 : 0.75, headingCount >= 1 ? 'role_sections_present' : 'role_lines_present', [headingCount >= 1 ? 'job description sections found' : 'responsibility or requirement lines found without headings'], roleUnits)
  // A user-pasted description is a deliberate job description unless it is clearly an error,
  // a listing or a search page (checked above); accept it with lower confidence.
  if (sourceKind === 'pasted' && roleUnits.length >= 1) return result('job_page', 0.6, 'pasted_description', ['pasted by the user; short but contains role lines'], roleUnits)
  return result('insufficient_content', 0.6, 'too_little_role_content', ['not enough responsibilities or requirements to describe a role'], content)
}

// ── Extraction ──────────────────────────────────────────────────────────────

export function extractRoleProfile(input: RoleInput): RoleIntelligenceProfile {
  const prepared = prepareRoleText(input)
  const text = prepared.text
  const units = splitUnits(text)
  const lines = text.split('\n')
  const lineSection: Section[] = []
  let current: Section = 'intro'
  const headingLines = new Set<number>()
  lines.forEach((line, index) => {
    const heading = headingOf(line)
    if (heading) { current = heading; headingLines.add(index) }
    lineSection[index] = current
  })
  const sectionOf = (unit: Unit): Section => lineSection[unit.line] ?? 'intro'
  const headingUnits = new Set(units.filter((unit) => headingLines.has(unit.line)))
  const page = assessPage(prepared, units, sectionOf, headingUnits, input.source.kind)
  const evidenceOf = (list: Unit[]): EvidenceRef[] => list.slice(0, MAX_EVIDENCE).map((unit) => ref(text, unit))
  const titleUnit = prepared.title ? units.find((unit) => unit.lower.includes(prepared.title!.toLowerCase())) ?? null : null

  const base: RoleIntelligenceProfile = {
    schema_version: ROLE_PROFILE_SCHEMA_VERSION,
    extractor: { method: 'deterministic', version: ROLE_PROFILE_EXTRACTOR_VERSION, ai_assisted: false },
    source: { ...input.source, content_sha256: prepared.contentSha256, raw_characters: prepared.rawCharacters, meaningful_characters: text.length, removed_lines: prepared.removedLines, chunks: chunkResume(text).length },
    page,
    title: prepared.title,
    role_family: null, identity: null, identity_signals: { hands_on: 0, technical_lead: 0, people_manager: 0, executive: 0, ic_statements: 0 },
    seniority: { minimum: null, target: null },
    mandatory_requirements: [], preferred_requirements: [], responsibilities: [],
    balance: null,
    expectations: { hands_on: null, architecture: null, people_management: null, stakeholder_product: null, delivery_ownership: null },
    team: { direct_reports: null, manages_managers: null },
    domains: [], experience: { minimum_years: null, maximum_years: null, by_area: [] },
    constraints: { education: [], location: [], work_mode: null, work_authorisation: [] },
    compensation: null, contradictions: [], unknowns: [],
  }
  // Non-job pages yield no requirements: their text is navigation, other jobs or an error.
  if (page.value !== 'job_page') { base.unknowns = listUnknowns(base); return base }

  // Classify each content unit.
  const content = units.filter((unit) => !headingUnits.has(unit) && unit !== titleUnit)
  const responsibilities: Unit[] = [], mandatory: Unit[] = [], preferred: Unit[] = []
  const unsectioned = new Set<Unit>()
  for (const unit of content) {
    const section = sectionOf(unit)
    if (section === 'other') continue
    if (section === 'responsibilities') { responsibilities.push(unit); continue }
    if (section === 'mandatory' || section === 'preferred') {
      const isPreferred = section === 'preferred' ? !MANDATORY_CUE.test(unit.lower) || PREFERRED_CUE.test(unit.lower) : PREFERRED_CUE.test(unit.lower)
      ;(isPreferred ? preferred : mandatory).push(unit)
      continue
    }
    if (REQUIREMENT_CUE.test(unit.lower)) { (PREFERRED_CUE.test(unit.lower) ? preferred : mandatory).push(unit); unsectioned.add(unit) }
    else if (RESPONSIBILITY_START.test(unit.lower)) { responsibilities.push(unit); unsectioned.add(unit) }
  }
  const roleUnits = [...responsibilities, ...mandatory, ...preferred]
  const affirmed = (unit: Unit, pattern: RegExp) => { const m = pattern.exec(unit.lower); return !!m && !negatedBefore(unit.lower, m.index) }

  // Requirements.
  const yearsOf = (unit: Unit) => {
    const m = /\b(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*years?(?:\s+of)?\s*([a-z/&,\- ]{0,60})/.exec(unit.lower)
    if (!m) return null
    const area = m[3].split(/\b(?:experience|in a|with|at|including|and)\b|[,;]/)[0].trim().replace(/^(?:of|in)\s+/, '')
    return { minimum: Number(m[1]), maximum: m[2] ? Number(m[2]) : null, area: area || null }
  }
  const skillsIn = (unit: Unit) => Object.entries(SKILLS).filter(([, aliases]) => aliases.some((alias) => new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9#]|$)`).test(unit.lower))).map(([name]) => name)
  const requirement = (unit: Unit, kind: 'mandatory' | 'preferred'): Requirement => {
    const years = yearsOf(unit)
    const skills = skillsIn(unit)
    const category: RequirementCategory = years ? 'experience' : /\b(?:degree|bachelor|master|ph\.?d|diploma)\b/.test(unit.lower) ? 'education'
      : skills.length ? 'skill' : PEOPLE.test(unit.lower) || LEAD.test(unit.lower) ? 'leadership'
        : Object.values(DOMAINS).some((pattern) => pattern.test(unit.lower)) ? 'domain' : 'other'
    return {
      value: unit.text.slice(0, 200), basis: 'explicit', category, skills, years,
      confidence: unsectioned.has(unit) ? 0.6 : 0.85,
      rule: unsectioned.has(unit) ? `unsectioned_${kind}_cue` : `${kind}_section`,
      evidence: [ref(text, unit)],
    }
  }
  base.mandatory_requirements = mandatory.slice(0, MAX_ITEMS).map((unit) => requirement(unit, 'mandatory'))
  base.preferred_requirements = preferred.slice(0, MAX_ITEMS).map((unit) => requirement(unit, 'preferred'))
  base.responsibilities = responsibilities.slice(0, MAX_ITEMS).map((unit) => ({
    value: unit.text.slice(0, 200), basis: 'explicit', confidence: unsectioned.has(unit) ? 0.6 : 0.85,
    rule: unsectioned.has(unit) ? 'unsectioned_responsibility_cue' : 'responsibilities_section', evidence: [ref(text, unit)],
  }))

  // Identity: responsibilities and requirements decide; the title is only a prior.
  const handsOnUnits = roleUnits.filter((unit) => affirmed(unit, HANDS_ON))
  const peopleUnits = roleUnits.filter((unit) => affirmed(unit, PEOPLE) && !IC_STATEMENT.test(unit.lower))
  const leadUnits = roleUnits.filter((unit) => affirmed(unit, LEAD))
  const execUnits = roleUnits.filter((unit) => affirmed(unit, EXECUTIVE))
  const icUnits = content.filter((unit) => IC_STATEMENT.test(unit.lower))
  const managersUnits = roleUnits.filter((unit) => affirmed(unit, MANAGES_MANAGERS))
  base.identity_signals = { hands_on: handsOnUnits.length, technical_lead: leadUnits.length, people_manager: peopleUnits.length, executive: execUnits.length, ic_statements: icUnits.length }
  const percentMatch = /(\d{1,3})\s*%[^.;]{0,45}\b(?:hands-on|hands on|coding|writing code|code|technical work|ic work)\b|\b(?:hands-on|coding|writing code)\b[^.;]{0,20}?(\d{1,3})\s*%/.exec(lower(content))
  const handsOnPercent = percentMatch ? Number(percentMatch[1] ?? percentMatch[2]) : null
  const percentUnit = percentMatch ? content.find((unit) => /\d{1,3}\s*%/.test(unit.text) && /hands|cod|technical|ic work/.test(unit.lower)) ?? null : null
  const titleSays = prepared.title ? titleIdentity(prepared.title) : null
  // Strength = distinct people-management markers (reports, reviews, hiring, ...), so one dense sentence counts fully.
  const people = icUnits.length ? 0 : peopleUnits.reduce((sum, unit) => sum + PEOPLE_PARTS.filter((part) => part.test(unit.lower)).length, 0)
  const strongHandsOn = (handsOnPercent !== null && handsOnPercent >= 40) || handsOnUnits.length >= 3
  let identity: ProfessionalIdentity | null = null
  let identityRule = ''
  let identityUnits: Unit[] = []
  if (titleSays === 'executive' && (people >= 1 || execUnits.length)) { identity = 'executive'; identityRule = 'executive_title_with_org_scope'; identityUnits = [...execUnits, ...peopleUnits] }
  else if (people >= 2 || managersUnits.length) { identity = strongHandsOn ? 'hybrid' : 'people_manager'; identityRule = strongHandsOn ? 'people_management_with_hands_on' : 'people_management_responsibilities'; identityUnits = [...managersUnits, ...peopleUnits, ...(strongHandsOn ? handsOnUnits : [])] }
  else if (titleSays === 'ic' && prepared.title && titleLevel(prepared.title) >= 5 && (leadUnits.length || handsOnUnits.length)) {
    // Staff / principal engineers lead technically by definition; they remain individual contributors.
    identity = 'ic'; identityRule = 'senior_ic_with_technical_leadership'; identityUnits = [...leadUnits, ...handsOnUnits]
  }
  else if (leadUnits.length >= 2 || (titleSays === 'technical_lead' && leadUnits.length >= 1)) { identity = 'technical_lead'; identityRule = 'technical_leadership_responsibilities'; identityUnits = leadUnits }
  else if (handsOnUnits.length || icUnits.length) { identity = 'ic'; identityRule = icUnits.length ? 'explicit_individual_contributor' : 'hands_on_responsibilities'; identityUnits = [...icUnits, ...handsOnUnits] }
  else if (titleSays && titleUnit) { identity = titleSays; identityRule = 'title_only'; identityUnits = [titleUnit] }
  if (identity) {
    const agrees = titleSays === identity || (identity === 'hybrid' && (titleSays === 'people_manager' || titleSays === 'technical_lead'))
    base.identity = {
      value: identity, basis: 'inferred', rule: identityRule,
      confidence: clamp(identityRule === 'title_only' ? 0.45 : identity === 'hybrid' ? 0.6 : agrees ? 0.85 : 0.65, 0.9),
      evidence: evidenceOf(identityUnits),
    }
  }

  // Role family from the title (or first line), seniority from title, scope and years.
  if (titleUnit && prepared.title) base.role_family = { value: titleFamily(prepared.title), basis: 'inferred', confidence: 0.75, rule: 'title_family', evidence: [ref(text, titleUnit)] }

  const yearItems = mandatory.map((unit) => ({ unit, years: yearsOf(unit) })).filter((item) => item.years)
  const overall = yearItems.filter(({ years }) => !years!.area || (/\b(?:professional|industry|software|engineering|relevant|work|backend|frontend|full[- ]stack|development|programming|technical|data)\b/.test(years!.area) && !/\b(?:management|managing|leadership|leading|people)\b/.test(years!.area)))
  if (overall.length) {
    const top = overall.reduce((a, b) => (b.years!.minimum > a.years!.minimum ? b : a))
    base.experience.minimum_years = { value: top.years!.minimum, basis: 'explicit', confidence: 0.85, rule: 'mandatory_years', evidence: [ref(text, top.unit)] }
    if (top.years!.maximum) base.experience.maximum_years = { value: top.years!.maximum, basis: 'explicit', confidence: 0.85, rule: 'mandatory_years_range', evidence: [ref(text, top.unit)] }
  }
  base.experience.by_area = [...mandatory, ...preferred].map((unit) => ({ unit, years: yearsOf(unit) }))
    .filter((item) => item.years?.area)
    .slice(0, MAX_ITEMS)
    .map(({ unit, years }) => ({ value: { years: years!.minimum, area: years!.area! }, basis: 'explicit' as const, confidence: 0.8, rule: 'years_with_area', evidence: [ref(text, unit)] }))
  if (base.experience.minimum_years) {
    base.seniority.minimum = { value: yearsToLevel(base.experience.minimum_years.value), basis: 'inferred', confidence: 0.65, rule: 'years_to_level', evidence: base.experience.minimum_years.evidence }
  }
  if (titleUnit && prepared.title) {
    let level = titleLevel(prepared.title)
    const evidence = [ref(text, titleUnit)]
    if (managersUnits.length && level < 5) { level = 5; evidence.push(...evidenceOf(managersUnits)) }
    base.seniority.target = { value: level, basis: managersUnits.length ? 'inferred' : 'explicit', confidence: managersUnits.length ? 0.7 : 0.8, rule: managersUnits.length ? 'title_raised_by_scope' : 'title', evidence: evidence.slice(0, MAX_EVIDENCE) }
  } else if (base.seniority.minimum) {
    base.seniority.target = { ...base.seniority.minimum, confidence: 0.5, rule: 'years_only' }
  }

  // Expectations and balance.
  const scope = (key: keyof RoleIntelligenceProfile['expectations']): Scope | null => {
    if (key === 'people_management' && icUnits.length) return { value: 'low', basis: 'explicit', confidence: 0.85, rule: 'explicit_no_people_management', negated: true, evidence: evidenceOf(icUnits) }
    const hits = roleUnits.filter((unit) => affirmed(unit, SCOPES[key]))
    if (!hits.length) return null
    return { value: hits.length >= 3 ? 'high' : hits.length === 2 ? 'medium' : 'low', basis: 'inferred', confidence: clamp(0.5 + 0.1 * hits.length, 0.85), rule: 'responsibility_frequency', negated: false, evidence: evidenceOf(hits) }
  }
  base.expectations = { hands_on: scope('hands_on'), architecture: scope('architecture'), people_management: scope('people_management'), stakeholder_product: scope('stakeholder_product'), delivery_ownership: scope('delivery_ownership') }
  const leadership = people + leadUnits.length + execUnits.length
  if (handsOnPercent !== null && percentUnit) {
    base.balance = { value: handsOnPercent >= 60 ? 'hands_on' : handsOnPercent >= 30 ? 'balanced' : 'leadership', hands_on_percent: handsOnPercent, basis: 'explicit', confidence: 0.9, rule: 'stated_percentage', evidence: [ref(text, percentUnit)] }
  } else if (handsOnUnits.length || leadership) {
    const value = handsOnUnits.length >= leadership * 2 ? 'hands_on' : leadership >= handsOnUnits.length * 2 ? 'leadership' : 'balanced'
    base.balance = { value, hands_on_percent: null, basis: 'inferred', confidence: 0.55, rule: 'signal_ratio', evidence: evidenceOf([...handsOnUnits, ...peopleUnits, ...leadUnits]) }
  }

  // Team.
  const reportUnit = peopleUnits.find((unit) => /\b(\d{1,3})\+?\s*(?:direct reports|engineers|people|reports)\b|\bteam of (\d{1,3})\b/.test(unit.lower))
  if (reportUnit && !icUnits.length) {
    const m = /\b(\d{1,3})\+?\s*(?:direct reports|engineers|people|reports)\b|\bteam of (\d{1,3})\b/.exec(reportUnit.lower)!
    base.team.direct_reports = { value: Number(m[1] ?? m[2]), basis: 'explicit', confidence: 0.8, rule: 'stated_team_size', evidence: [ref(text, reportUnit)] }
  }
  if (managersUnits.length) base.team.manages_managers = { value: true, basis: 'explicit', confidence: 0.85, rule: 'stated_managers_of_managers', evidence: evidenceOf(managersUnits) }

  // Domains (benefit / EEO sentences excluded: "health insurance" is not a healthcare domain).
  const domainUnits = content.filter((unit) => !BENEFIT_CONTEXT.test(unit.lower))
  for (const [name, pattern] of Object.entries(DOMAINS)) {
    const hits = domainUnits.filter((unit) => pattern.test(unit.lower))
    if (hits.length) base.domains.push({ value: name, basis: 'inferred', confidence: clamp(0.45 + 0.1 * hits.length, 0.8), rule: 'domain_vocabulary', evidence: evidenceOf(hits) })
  }
  base.domains.sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value))

  // Constraints.
  const traced = (unit: Unit, rule: string, confidence = 0.85): Traced<string> => ({ value: unit.text.slice(0, 160), basis: 'explicit', confidence, rule, evidence: [ref(text, unit)] })
  base.constraints.education = content.filter((unit) => /\b(?:bachelor(?:'|’)?s?|master(?:'|’)?s?|ph\.?d|b\.?tech|m\.?tech|b\.?e\.?|degree in|degree|diploma)\b/.test(unit.lower) && !BENEFIT_CONTEXT.test(unit.lower)).slice(0, 5).map((unit) => traced(unit, 'education_statement'))
  base.constraints.location = units.filter((unit) => !headingUnits.has(unit) && unit.text.length <= 160 && (PLACES.test(unit.lower) || /\b(?:located in|based in|must (?:be|live|reside) (?:in|within)|relocat\w*|this role is based|office in)\b/.test(unit.lower))).slice(0, 5).map((unit) => traced(unit, 'location_statement', 0.75))
  base.constraints.work_authorisation = content.filter((unit) => /\b(?:visa sponsorship|sponsorship|authori[sz]ed to work|work authori[sz]ation|right to work|security clearance|citizenship|green card)\b/.test(unit.lower)).slice(0, 5).map((unit) => traced(unit, 'work_authorisation_statement'))
  const remote = units.filter((unit) => /\bremote\b/.test(unit.lower) && !/\bremote(?:-first)? culture\b/.test(unit.lower))
  const hybrid = units.filter((unit) => /\bhybrid\b/.test(unit.lower))
  const onsite = units.filter((unit) => /\b(?:on-?site|in[- ]office|office-based|in the office \d)\b/.test(unit.lower) && !/\bno (?:on-?site|office)\b/.test(unit.lower))
  if (hybrid.length) base.constraints.work_mode = { value: 'hybrid', basis: 'explicit', confidence: 0.85, rule: 'work_mode_statement', evidence: evidenceOf(hybrid) }
  else if (remote.length && onsite.length) base.contradictions.push({ kind: 'work_mode_conflict', description: 'The description says both remote and on-site.', evidence: evidenceOf([...remote.slice(0, 1), ...onsite.slice(0, 1)]) })
  else if (remote.length) base.constraints.work_mode = { value: 'remote', basis: 'explicit', confidence: 0.85, rule: 'work_mode_statement', evidence: evidenceOf(remote) }
  else if (onsite.length) base.constraints.work_mode = { value: 'onsite', basis: 'explicit', confidence: 0.85, rule: 'work_mode_statement', evidence: evidenceOf(onsite) }

  // Compensation: only from a sentence that states pay, never from bare numbers.
  for (const unit of units) {
    if (!SALARY_CUE.test(unit.lower)) continue
    const range = extractSalaryRange(unit.text)
    if (!range) continue
    const after = unit.text.slice(unit.text.indexOf(range.raw) + range.raw.length, unit.text.indexOf(range.raw) + range.raw.length + 16).toLowerCase()
    if (/^\s*(?:\+\s*)?(?:years?|yrs?|engineers|people|reports|%|teams?|direct)/.test(after)) continue
    const value: Compensation = { raw: range.raw, currency: range.currency, minimum: range.minimum, maximum: range.maximum, period: range.period ?? 'year' }
    base.compensation = { value, basis: 'explicit', confidence: range.currency ? 0.9 : 0.7, rule: 'stated_pay_range', evidence: [ref(text, unit)] }
    break
  }

  // Contradictions and ambiguity.
  const icLike = (value: ProfessionalIdentity) => value === 'ic' || value === 'technical_lead'
  if (titleSays && base.identity && base.identity.rule !== 'title_only' && titleSays !== base.identity.value &&
    !(base.identity.value === 'hybrid' && (titleSays === 'people_manager' || titleSays === 'technical_lead')) &&
    !(icLike(titleSays) && icLike(base.identity.value))) {
    base.contradictions.push({ kind: 'title_vs_responsibilities', description: `The title suggests ${titleSays.replace('_', ' ')}, but the responsibilities describe ${base.identity.value.replace('_', ' ')}.`, evidence: [...(titleUnit ? [ref(text, titleUnit)] : []), ...base.identity.evidence].slice(0, MAX_EVIDENCE) })
  }
  if (icUnits.length && peopleUnits.length) base.contradictions.push({ kind: 'reports_conflict', description: 'The description says there are no reports but also lists people-management duties.', evidence: evidenceOf([icUnits[0], peopleUnits[0]]) })
  if (titleSays === 'people_manager' && handsOnPercent !== null && handsOnPercent >= 70 && percentUnit) base.contradictions.push({ kind: 'hands_on_vs_title', description: `A manager title with ${handsOnPercent}% hands-on work.`, evidence: [ref(text, percentUnit)] })
  if (base.seniority.target && base.seniority.minimum && Math.abs(base.seniority.target.value - base.seniority.minimum.value) >= 2) {
    base.contradictions.push({ kind: 'title_vs_experience', description: `The title implies level ${base.seniority.target.value}, but the required years imply level ${base.seniority.minimum.value}.`, evidence: [...base.seniority.target.evidence.slice(0, 1), ...base.seniority.minimum.evidence.slice(0, 1)] })
  }
  if (!mandatory.length && !preferred.length) base.contradictions.push({ kind: 'ambiguity', description: 'No requirements could be identified; only responsibilities or general text.', evidence: evidenceOf(responsibilities.length ? responsibilities : content) })

  base.unknowns = listUnknowns(base)
  return base
}

function lower(units: Unit[]): string {
  return units.map((unit) => unit.lower).join('\n')
}

function listUnknowns(p: RoleIntelligenceProfile): string[] {
  const unknown: string[] = []
  if (!p.role_family) unknown.push('role_family')
  if (!p.identity) unknown.push('identity')
  if (!p.seniority.minimum) unknown.push('seniority.minimum')
  if (!p.seniority.target) unknown.push('seniority.target')
  if (!p.mandatory_requirements.length) unknown.push('mandatory_requirements')
  if (!p.preferred_requirements.length) unknown.push('preferred_requirements')
  if (!p.responsibilities.length) unknown.push('responsibilities')
  if (!p.balance) unknown.push('balance')
  for (const [key, value] of Object.entries(p.expectations)) if (!value) unknown.push(`expectations.${key}`)
  if (!p.domains.length) unknown.push('domains')
  if (!p.experience.minimum_years) unknown.push('experience.minimum_years')
  if (!p.constraints.education.length) unknown.push('constraints.education')
  if (!p.constraints.location.length) unknown.push('constraints.location')
  if (!p.constraints.work_mode) unknown.push('constraints.work_mode')
  if (!p.constraints.work_authorisation.length) unknown.push('constraints.work_authorisation')
  if (!p.compensation) unknown.push('compensation')
  return unknown
}

/** Every traced value in a role profile, for auditing confidence/evidence invariants. */
export function roleTracedItems(p: RoleIntelligenceProfile): Array<{ path: string; item: Traced<unknown> }> {
  const out: Array<{ path: string; item: Traced<unknown> }> = []
  const add = (path: string, item: Traced<unknown> | null) => { if (item) out.push({ path, item }) }
  add('page', p.page); add('role_family', p.role_family); add('identity', p.identity)
  add('seniority.minimum', p.seniority.minimum); add('seniority.target', p.seniority.target)
  p.mandatory_requirements.forEach((item, i) => add(`mandatory_requirements[${i}]`, item))
  p.preferred_requirements.forEach((item, i) => add(`preferred_requirements[${i}]`, item))
  p.responsibilities.forEach((item, i) => add(`responsibilities[${i}]`, item))
  add('balance', p.balance)
  for (const [key, value] of Object.entries(p.expectations)) add(`expectations.${key}`, value)
  add('team.direct_reports', p.team.direct_reports); add('team.manages_managers', p.team.manages_managers)
  p.domains.forEach((item, i) => add(`domains[${i}]`, item))
  add('experience.minimum_years', p.experience.minimum_years); add('experience.maximum_years', p.experience.maximum_years)
  p.experience.by_area.forEach((item, i) => add(`experience.by_area[${i}]`, item))
  p.constraints.education.forEach((item, i) => add(`constraints.education[${i}]`, item))
  p.constraints.location.forEach((item, i) => add(`constraints.location[${i}]`, item))
  add('constraints.work_mode', p.constraints.work_mode)
  p.constraints.work_authorisation.forEach((item, i) => add(`constraints.work_authorisation[${i}]`, item))
  add('compensation', p.compensation)
  return out
}

/** Provider label from a URL, for provenance only. */
export function providerFromUrl(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    const host = new URL(input).hostname.toLowerCase().replace(/^www\./, '')
    if (/\.myworkdayjobs\.com$/.test(host)) return 'workday'
    if (/greenhouse\.io$/.test(host)) return 'greenhouse'
    if (/lever\.co$/.test(host)) return 'lever'
    return host
  } catch {
    return null
  }
}
