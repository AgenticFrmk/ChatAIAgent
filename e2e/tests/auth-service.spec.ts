/**
 * AuthService e2e tests — directly against localhost:9000.
 *
 * API tests use Playwright's request fixture (no browser).
 * Admin UI tests open a real browser at localhost:9000/auth-admin/.
 *
 * Seed users created by docker-entrypoint.sh:
 *   sre-seed@example.com / changeme   → role: agent_user
 *   admin@example.com / admin123      → role: platform_admin
 */
import { test, expect } from '@playwright/test'

const AUTH_URL   = process.env.E2E_AUTH_URL  ?? 'http://localhost:9000'
const ADMIN_URL  = `${AUTH_URL}/auth-admin`
const SEED_USER  = process.env.SEED_USERNAME ?? 'sre-seed@example.com'
const SEED_PASS  = process.env.SEED_PASSWORD ?? 'changeme'
const ADMIN_USER = process.env.ADMIN_USERNAME ?? 'admin@example.com'
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? 'admin123'

// ── Helper ────────────────────────────────────────────────────────────────────

async function getAdminToken(request: Parameters<Parameters<typeof test>[1]>[0]['request']): Promise<string> {
  const res = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: ADMIN_USER, password: ADMIN_PASS },
  })
  const body = await res.json()
  return body.access_token as string
}

// ── API: Health ───────────────────────────────────────────────────────────────

test('health check returns ok', async ({ request }) => {
  const res = await request.get(`${AUTH_URL}/health`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})

// ── API: Token issuance ───────────────────────────────────────────────────────

test('valid credentials return a signed JWT', async ({ request }) => {
  const res = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: SEED_USER, password: SEED_PASS },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body).toHaveProperty('access_token')
  expect(body.token_type).toBe('bearer')
  expect(body.access_token.split('.').length).toBe(3)
})

test('invalid password returns 401', async ({ request }) => {
  const res = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: SEED_USER, password: 'wrong' },
  })
  expect(res.status()).toBe(401)
})

test('unknown username returns 401', async ({ request }) => {
  const res = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: 'nobody@example.com', password: 'anything' },
  })
  expect(res.status()).toBe(401)
})

// ── API: JWKS ─────────────────────────────────────────────────────────────────

test('JWKS endpoint returns RS256 public key', async ({ request }) => {
  const res = await request.get(`${AUTH_URL}/.well-known/jwks.json`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.keys)).toBe(true)
  const key = body.keys[0]
  expect(key.kty).toBe('RSA')
  expect(key.alg).toBe('RS256')
  expect(key).toHaveProperty('n')
  expect(key).toHaveProperty('e')
})

// ── API: Admin tenants (platform_admin only) ──────────────────────────────────

test('admin tenants list requires platform_admin token', async ({ request }) => {
  // agent_user token → 403
  const tokenRes = await request.post(`${AUTH_URL}/auth/token`, {
    form: { username: SEED_USER, password: SEED_PASS },
  })
  const { access_token } = await tokenRes.json()
  const res = await request.get(`${AUTH_URL}/admin/tenants`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  expect(res.status()).toBe(403)
})

test('admin can list tenants with platform_admin token', async ({ request }) => {
  const token = await getAdminToken(request)
  const res = await request.get(`${AUTH_URL}/admin/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  expect(Array.isArray(await res.json())).toBe(true)
})

test('admin can create and retrieve a tenant', async ({ request }) => {
  const token = await getAdminToken(request)
  const tenantId = `e2e-tenant-${Date.now()}`

  const create = await request.post(`${AUTH_URL}/admin/tenants`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { tenant_id: tenantId, name: tenantId, display_name: 'E2E Test Tenant' },
  })
  expect(create.status()).toBe(201)

  const get = await request.get(`${AUTH_URL}/admin/tenants/${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(get.status()).toBe(200)
  const body = await get.json()
  expect(body.tenant_id).toBe(tenantId)
  expect(body.display_name).toBe('E2E Test Tenant')
})

test('admin can create a user in a tenant', async ({ request }) => {
  const token = await getAdminToken(request)
  const tenantId = `e2e-users-${Date.now()}`

  await request.post(`${AUTH_URL}/admin/tenants`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { tenant_id: tenantId, name: tenantId, display_name: 'E2E Users Tenant' },
  })

  const create = await request.post(`${AUTH_URL}/admin/tenants/${tenantId}/users`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { username: `user-${Date.now()}@example.com`, password: 'testpass123', role: 'end_user' },
  })
  expect(create.status()).toBe(201)
  const user = await create.json()
  expect(user).toHaveProperty('user_id')
  expect(user.tenant_id).toBe(tenantId)
})

test('platform tenant cannot be deleted', async ({ request }) => {
  const token = await getAdminToken(request)
  const res = await request.delete(`${AUTH_URL}/admin/tenants/platform`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(403)
})

// ── Admin UI: browser tests ───────────────────────────────────────────────────

test('admin UI login page loads', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`)
  await expect(page.getByRole('heading', { name: /auth admin/i })).toBeVisible()
  await expect(page.getByLabel(/username/i)).toBeVisible()
  await expect(page.getByLabel(/password/i)).toBeVisible()
})

test('admin UI unauthenticated /tenants redirects to login', async ({ page }) => {
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${ADMIN_URL}/tenants`)
  await expect(page).toHaveURL(/\/login/)
})

test('admin UI login with valid credentials reaches tenants list', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`)
  await page.getByLabel(/username/i).fill(ADMIN_USER)
  await page.getByLabel(/password/i).fill(ADMIN_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/tenants/)
})

test('admin UI login with wrong password shows error', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`)
  await page.getByLabel(/username/i).fill(ADMIN_USER)
  await page.getByLabel(/password/i).fill('wrongpassword')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(/invalid credentials|login failed/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})
