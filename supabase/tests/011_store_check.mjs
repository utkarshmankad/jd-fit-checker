// Used by 011_acceptance.sh: drives the real ensureRoleProfiles() against a
// local PostgREST with a service-role client to prove content-hash reuse.
import { createClient } from '@supabase/supabase-js'
import { ensureRoleProfiles } from '../../src/lib/role-profile/store.ts'
import { extractRoleProfile } from '../../src/lib/role-profile/extract.ts'

const db = createClient(process.env.SUPABASE_URL, process.env.SERVICE_KEY, { auth: { persistSession: false } })
let extractions = 0
const extract = (input) => { extractions += 1; return extractRoleProfile(input) }
const jd = 'Senior Backend Engineer\nResponsibilities:\nBuild Go services on AWS.\nOwn services end to end and join the on-call rotation.\nRequirements:\n5+ years of software engineering experience.\nStrong PostgreSQL skills.'
const listing = 'Open positions\nSenior Software Engineer\nStaff Engineer, Platform\nEngineering Manager, Payments\nData Analyst\nQA Automation Engineer\nProduct Designer'
const job = { text: jd, title: 'Senior Backend Engineer', source: { kind: 'url', provider: 'greenhouse', canonical_url: 'https://job-boards.greenhouse.io/fictional/jobs/1' } }

const batch1 = await ensureRoleProfiles(db, [job, job, { text: listing, title: null, source: { kind: 'url', provider: 'careers.example', canonical_url: 'https://careers.example/jobs' } }, { text: 'Access Denied', title: null, source: { kind: 'url', provider: null, canonical_url: null } }], extract)
const after1 = extractions
const stamp = async () => (await db.from('role_profiles').select('updated_at').eq('content_sha256', batch1[0].profile.source.content_sha256).single()).data?.updated_at
const before = await stamp()
const pastedWithChrome = { text: `Sign In\nApply now\n${jd}\nSimilar jobs\nData Analyst`, title: 'Senior Backend Engineer', source: { kind: 'pasted', provider: null, canonical_url: null } }
const otherJob = { ...job, title: 'Backend Engineer II', text: jd.replace('Senior Backend Engineer', 'Backend Engineer II') }
const batch2 = await ensureRoleProfiles(db, [pastedWithChrome, job], extract)
const after2 = extractions
await ensureRoleProfiles(db, [otherJob], extract)
const { data: rows } = await db.from('role_profiles').select('page_kind').order('page_kind')
console.log(`batch1 ${batch1.map((r) => r.status).join(' ')}`)
console.log(`batch2 ${batch2.map((r) => r.status).join(' ')}`)
console.log(`extractions ${after1} ${after2}`)
console.log(`updated_at_unchanged=${before === (await stamp())}`)
console.log(`rows ${rows.length} ${rows.map((r) => r.page_kind).join(',')}`)
