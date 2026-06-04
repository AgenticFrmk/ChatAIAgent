/**
 * Alerts e2e tests — SLMPlatform API + registry-portal Alerts page.
 *
 * API tests use Playwright's request fixture (no browser).
 * UI tests open the portal at localhost:8001/portal/alerts.
 *
 * SLMPlatform is at E2E_SLM_URL (default http://localhost:8002).
 * Auth token is obtained from AuthService using the seed credentials.
 */
import { test, expect } from '@playwright/test'

const SLM_URL      = process.env.E2E_SLM_URL      ?? 'http://localhost:8002'
const AUTH_URL     = process.env.E2E_AUTH_URL      ?? 'http://localhost:9000'
const REGISTRY_URL = process.env.E2E_REGISTRY_URL  ?? 'http://localhost:8001'
const SEED_USER    = process.env.SEED_USERNAME     ?? 'sre-seed@example.com'
const SEED_PASS    = process.env.SEED_PASSWORD     ?? 'changeme'
const PORTAL_URL   = `${REGISTRY_URL}/portal`

const TEST_AGENT_ID = 'e2e-test-agent'
const TEST_DOMAIN   = 'networking'

async function getToken(request: Parameters<Parameters<typeof test>[1]>[0]['request']): Promise<string> {
  const res = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: SEED_USER, password: SEED_PASS },
  })
  const body = await res.json()
  return body.access_token as string
}

// ── SLMPlatform API: health ───────────────────────────────────────────────────

test('slm-platform health check returns 200', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/health`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})

// ── SLMPlatform API: alert config CRUD ───────────────────────────────────────

test('POST /alerts/config creates threshold config', async ({ request }) => {
  const res = await request.post(`${SLM_URL}/alerts/config`, {
    data: {
      agent_id: TEST_AGENT_ID,
      domain: TEST_DOMAIN,
      min_faithfulness: 0.75,
      min_context_precision: 0.7,
      min_answer_relevancy: 0.65,
      window_size: 5,
      is_active: true,
    },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.agent_id).toBe(TEST_AGENT_ID)
  expect(body.domain).toBe(TEST_DOMAIN)
  expect(body.min_faithfulness).toBe(0.75)
  expect(body.window_size).toBe(5)
  expect(body.is_active).toBe(true)
  expect(body.config_id).toBeTruthy()
})

test('POST /alerts/config upserts on duplicate agent+domain', async ({ request }) => {
  // Second POST for the same agent+domain should update, not 409
  const res = await request.post(`${SLM_URL}/alerts/config`, {
    data: {
      agent_id: TEST_AGENT_ID,
      domain: TEST_DOMAIN,
      min_faithfulness: 0.8,
      min_context_precision: 0.8,
      min_answer_relevancy: 0.8,
      window_size: 10,
      is_active: true,
    },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.min_faithfulness).toBe(0.8)
  expect(body.window_size).toBe(10)
})

test('GET /alerts/config/{agent_id} returns configs for agent', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts/config/${TEST_AGENT_ID}`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
  const config = body.find((c: { domain: string }) => c.domain === TEST_DOMAIN)
  expect(config).toBeDefined()
  expect(config.agent_id).toBe(TEST_AGENT_ID)
})

test('GET /alerts/configs returns all configs', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts/configs`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
  // The config we seeded above must appear
  const found = body.find(
    (c: { agent_id: string; domain: string }) =>
      c.agent_id === TEST_AGENT_ID && c.domain === TEST_DOMAIN
  )
  expect(found).toBeDefined()
})

test('GET /alerts/configs with domain filter narrows results', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts/configs?domain=${TEST_DOMAIN}`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
  // All returned configs must match the filter domain
  for (const c of body) {
    expect(c.domain).toBe(TEST_DOMAIN)
  }
})

// ── SLMPlatform API: alert list ───────────────────────────────────────────────

test('GET /alerts returns alert page shape', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(typeof body.total).toBe('number')
  expect(Array.isArray(body.alerts)).toBe(true)
})

test('GET /alerts with status=OPEN returns only open alerts', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts?status=OPEN`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  for (const alert of body.alerts) {
    expect(alert.status).toBe('OPEN')
  }
})

test('GET /alerts with status=RESOLVED returns only resolved alerts', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts?status=RESOLVED`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  for (const alert of body.alerts) {
    expect(alert.status).toBe('RESOLVED')
  }
})

test('GET /alerts with agent_id filter narrows results', async ({ request }) => {
  const res = await request.get(`${SLM_URL}/alerts?agent_id=${TEST_AGENT_ID}`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  for (const alert of body.alerts) {
    expect(alert.agent_id).toBe(TEST_AGENT_ID)
  }
})

// ── Portal UI: Alerts page ────────────────────────────────────────────────────

test('portal alerts page is reachable after login', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByLabel(/username/i).fill(SEED_USER)
  await page.getByLabel(/password/i).fill(SEED_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/home/)

  await page.goto(`${PORTAL_URL}/alerts`)
  await expect(page.getByRole('heading', { name: /agent alerts/i })).toBeVisible({ timeout: 10_000 })
})

test('portal Alerts nav link appears in navigation', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByLabel(/username/i).fill(SEED_USER)
  await page.getByLabel(/password/i).fill(SEED_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/home/)

  await expect(page.getByRole('link', { name: 'Alerts' })).toBeVisible()
})

test('portal alerts page shows empty state or alert rows', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByLabel(/username/i).fill(SEED_USER)
  await page.getByLabel(/password/i).fill(SEED_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()

  await page.goto(`${PORTAL_URL}/alerts`)
  await expect(page.getByRole('heading', { name: /agent alerts/i })).toBeVisible({ timeout: 10_000 })

  // Either the empty state or a table row should be visible — never a blank page
  const emptyState = page.getByText(/no alerts/i)
  const firstRow   = page.locator('table tbody tr').first()
  await expect(emptyState.or(firstRow)).toBeVisible({ timeout: 10_000 })
})

test('portal alerts page status filter buttons are visible', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByLabel(/username/i).fill(SEED_USER)
  await page.getByLabel(/password/i).fill(SEED_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()

  await page.goto(`${PORTAL_URL}/alerts`)
  await expect(page.getByRole('heading', { name: /agent alerts/i })).toBeVisible({ timeout: 10_000 })

  await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'OPEN' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'RESOLVED' })).toBeVisible()
})

test('portal alerts page unauthenticated access redirects to login', async ({ page }) => {
  await page.context().clearCookies()
  await page.evaluate(() => sessionStorage.clear())

  await page.goto(`${PORTAL_URL}/alerts`)
  await expect(page).toHaveURL(/\/login/)
})
