import { test, expect } from '@playwright/test';

test.describe('ReviewLens Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the login card and auth key input', async ({ page }) => {
    await expect(page.getByLabel('Login page')).toBeVisible();
    await expect(page.getByText('Enter your auth key to continue to ReviewLens AI.')).toBeVisible();
    await expect(page.getByLabel('Auth Key')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('should render left menu', async ({ page }) => {
    await expect(page.getByLabel('Left menu')).toBeVisible();
    await expect(page.getByLabel('Login')).toBeVisible();
  });

  test('should show ORM branding', async ({ page }) => {
    await expect(page.getByText('Online Reputation Management').first()).toBeVisible();
  });
});
