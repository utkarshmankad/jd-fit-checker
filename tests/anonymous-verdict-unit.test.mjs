import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateAnonymousVerdict } from '../src/lib/anonymous-verdict.ts'

const base = {
  currentRole: 'Engineering Manager',
  yearsExperience: 12,
  targetLevel: 'Engineering Manager',
  skills: 'Java, AWS, Kafka, leadership',
  dealbreaker: '.NET',
  jobDescription: 'Engineering Manager role leading a platform team. Build Java services on AWS with Kafka. Leadership and mentoring are core responsibilities. Requires 10+ years of experience.',
}

test('returns STRONG when skills, level and experience align', () => {
  assert.equal(calculateAnonymousVerdict(base).verdict, 'STRONG')
})

test('returns DECENT for partial skill alignment', () => {
  assert.equal(calculateAnonymousVerdict({ ...base, skills: 'Java, AWS, Go, Kubernetes, Terraform' }).verdict, 'DECENT')
})

test('returns WEAK when evidence and level do not align', () => {
  assert.equal(calculateAnonymousVerdict({ ...base, targetLevel: 'Director', skills: 'Go, iOS, Spark' }).verdict, 'WEAK')
})

test('returns REJECT when a stated deal-breaker appears', () => {
  assert.equal(calculateAnonymousVerdict({ ...base, jobDescription: `${base.jobDescription} The backend is entirely .NET.` }).verdict, 'REJECT')
})
