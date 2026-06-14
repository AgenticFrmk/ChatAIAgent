import { test, expect } from '@playwright/test'

test('login page loads', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByLabel(/username/i)).toBeVisible()
  await expect(page.getByLabel(/password/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('unauthenticated /chat redirects to /login', async ({ page }) => {
  // Clear any stored session so we arrive unauthenticated
  await page.context().clearCookies()
  await page.evaluate(() => sessionStorage.clear())

  await page.goto('/chat')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('analytics page loads', async ({ page }) => {
  await page.goto('/analytics')
  // Header always renders regardless of auth / data state
  await expect(page.getByText('Analytics')).toBeVisible()
})
