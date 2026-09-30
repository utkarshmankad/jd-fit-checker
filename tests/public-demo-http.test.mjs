import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const baseURL = process.env.DEMO_BASE_URL || 'http://localhost:3000'

test('anonymous demo is public and SSR contains fictional context and all verdicts', async () => {
  const response = await fetch(`${baseURL}/demo`, { redirect: 'manual' })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /Fictional sample batch/)
  assert.match(html, /not live vacancies or hiring decisions/)
  assert.match(html, /Example candidate and standards/)
  assert.equal((html.match(/<article\b/g) || []).length, 5)
  assert.equal((html.match(/<details\b/g) || []).length, 5)
  for (const verdict of ['STRONG', 'DECENT', 'WEAK', 'REJECT']) assert.match(html, new RegExp(verdict))
  assert.match(html, /href="\/auth\/login"/)
  assert.doesNotMatch(html, /<form\b|<button\b/)
})

test('landing offers demo while protected dashboard still requires sign-in', async () => {
  const landing = await fetch(baseURL)
  assert.equal(landing.status, 200)
  assert.match(await landing.text(), /href="\/demo"/)
  const dashboard = await fetch(`${baseURL}/dashboard`, { redirect: 'manual' })
  assert.equal(dashboard.status, 307)
  assert.equal(new URL(dashboard.headers.get('location'), baseURL).pathname, '/auth/login')
  const login = await fetch(`${baseURL}/auth/login`)
  assert.equal(login.status, 200)
})

test('demo event helpers remain separate from real scan activation events', () => {
  const events = []
  const output = ts.transpileModule(readFileSync('src/lib/analytics.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    require: (path) => {
      assert.equal(path, '@/lib/posthog')
      return { posthog: { capture: (event, properties) => events.push({ event, properties }) } }
    },
  })
  exports.track.demoViewed()
  exports.track.demoSignInClicked()
  assert.deepEqual(events.map(({ event }) => event), ['demo_viewed', 'demo_sign_in_clicked'])
  assert.ok(events.every(({ properties }) => properties === undefined))
})
