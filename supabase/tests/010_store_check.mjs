// Used by 010_acceptance.sh: drives the real ensureCandidateProfile() against a
// local PostgREST with a service-role client to prove once-per-version behaviour.
import { createClient } from '@supabase/supabase-js'
import { ensureCandidateProfile } from '../../src/lib/candidate-profile/store.ts'

const db = createClient(process.env.SUPABASE_URL, process.env.SERVICE_KEY, { auth: { persistSession: false } })
const userId = process.env.USER_ID
const resume = 'Senior Software Engineer at Brookvale (fictional), 2019 - 2024\n- Built TypeScript services on AWS.'

let extractions = 0
const { extractCandidateProfile } = await import('../../src/lib/candidate-profile/extract.ts')
const extract = (text) => { extractions += 1; return extractCandidateProfile(text) }

const updatedAt = async () => (await db.from('candidate_profiles').select('updated_at').eq('user_id', userId).single()).data?.updated_at
const statuses = []
statuses.push((await ensureCandidateProfile(db, userId, resume, extract)).status)
const afterBuild = await updatedAt()
statuses.push((await ensureCandidateProfile(db, userId, resume, extract)).status)
statuses.push((await ensureCandidateProfile(db, userId, `  ${resume}\n\n`, extract)).status)
const afterReuse = await updatedAt()
statuses.push((await ensureCandidateProfile(db, userId, `${resume}\n- Led a team of 4 engineers.`, extract)).status)
console.log(`statuses ${statuses.join(' ')}`)
console.log(`extractions ${extractions}`)
console.log(`updated_at_unchanged=${afterBuild === afterReuse}`)
