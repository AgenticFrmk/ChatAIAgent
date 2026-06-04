/**
 * Registry Service e2e tests — directly against localhost:8001.
 *
 * API tests use Playwright's request fixture (no browser).
 * Portal UI tests open a real browser at localhost:8001/portal/.
 *
 * Seed data (tools, playbooks, domains) is loaded by connectivity-seeder
 * at stack startup — these tests assume the seeder has completed.
 */
import { test, expect } from '@playwright/test'

const REGISTRY_URL = process.env.E2E_REGISTRY_URL ?? 'http://localhost:8001'
const AUTH_URL     = process.env.E2E_AUTH_URL      ?? 'http://localhost:9000'
const SEED_USER    = process.env.SEED_USERNAME     ?? 'sre-seed@example.com'
const SEED_PASS    = process.env.SEED_PASSWORD     ?? 'changeme'
const PORTAL_URL   = `${REGISTRY_URL}/portal`

async function getToken(request: Parameters<Parameters<typeof test>[1]>[0]['request']): Promise<string> {
  const res = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: SEED_USER, password: SEED_PASS },
  })
  const body = await res.json()
  return body.access_token as string
}

// ── API: Health ───────────────────────────────────────────────────────────────

test('registry health check returns 200', async ({ request }) => {
  const res = await request.get(`${REGISTRY_URL}/health`)
  expect(res.status()).toBe(200)
})

// ── API: Seeded data ──────────────────────────────────────────────────────────

test('tools endpoint returns seeded tool contracts', async ({ request }) => {
  const token = await getToken(request)
  const res = await request.get(`${REGISTRY_URL}/tools`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
})

test('playbooks endpoint returns seeded playbook', async ({ request }) => {
  const token = await getToken(request)
  const res = await request.get(`${REGISTRY_URL}/playbooks`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
})

test('distillation trajectories endpoint is reachable', async ({ request }) => {
  const token = await getToken(request)
  const res = await request.get(`${REGISTRY_URL}/distillation/trajectories`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
})

test('routing policy endpoint returns response for known domain', async ({ request }) => {
  const res = await request.get(`${REGISTRY_URL}/routing-policy/networking`)
  // 200 (policy exists) or 404 (not yet graduated) — both are valid
  expect([200, 404]).toContain(res.status())
})

// ── Portal UI ─────────────────────────────────────────────────────────────────

test('portal login page loads at /portal/login', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('portal unauthenticated home redirects to login', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/home`)
  await expect(page).toHaveURL(/\/login/)
})

test('portal login with valid credentials reaches home', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByLabel(/username/i).fill(SEED_USER)
  await page.getByLabel(/password/i).fill(SEED_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/home/)
})

test('portal tools page shows seeded tools after login', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByLabel(/username/i).fill(SEED_USER)
  await page.getByLabel(/password/i).fill(SEED_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.goto(`${PORTAL_URL}/tools`)
  // At least one tool row rendered — connectivity-seeder loads VPN tools
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })
})
