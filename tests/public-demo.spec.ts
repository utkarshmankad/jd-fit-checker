import { test, expect } from '@playwright/test'

const baseURL = process.env.DEMO_BASE_URL || 'http://localhost:3000'

test.beforeEach(async ({ page }) => {
  // Local regression checks must never send analytics to a production project.
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL).origin) {
      return route.abort()
    }
    return route.continue()
  })
})

test('anonymous demo explains every verdict and expands with a keyboard', async ({ page }) => {
  const mutations: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
      mutations.push(request.url())
    }
  })
  const response = await page.goto(`${baseURL}/demo`)
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(`${baseURL}/demo`)
  await expect(page.getByText('Fictional sample batch', { exact: true })).toBeVisible()
  await expect(page.getByText(/not live vacancies or hiring decisions/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Example candidate and standards' })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(5)
  for (const verdict of ['STRONG', 'DECENT', 'WEAK', 'REJECT']) {
    await expect(page.locator('article').filter({ hasText: `${verdict} —` }).first()).toBeVisible()
  }
  const first = page.locator('details').first()
  await expect(first).not.toHaveAttribute('open', '')
  await first.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(first).toHaveAttribute('open', '')
  await expect(first.getByText(/Pick up basic Go syntax/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(first).not.toHaveAttribute('open', '')
  await expect(page.getByRole('button')).toHaveCount(0)
  expect(mutations).toEqual([])
})

test('landing links to demo, CTA reaches sign-in, dashboard stays protected', async ({ page }) => {
  await page.goto(baseURL)
  await page.getByRole('link', { name: 'See a sample without signing in →' }).click()
  await expect(page).toHaveURL(`${baseURL}/demo`)
  await page.getByRole('link', { name: 'Sign in to screen your own jobs →' }).click()
  await expect(page).toHaveURL(`${baseURL}/auth/login`)
  await page.goto(`${baseURL}/dashboard`)
  await expect(page).toHaveURL(`${baseURL}/auth/login`)
})

test('mobile demo fits the viewport and touch expands rejection reasons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${baseURL}/demo`)
  const rejected = page.locator('article').filter({ hasText: 'REJECT —' })
  await rejected.locator('summary').click()
  await expect(rejected.getByText('Requires .NET.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
