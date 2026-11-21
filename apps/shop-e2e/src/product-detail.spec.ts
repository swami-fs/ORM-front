import { test, expect } from '@playwright/test';

test.describe('Chat panel prerequisites', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should keep user on login screen when unauthenticated', async ({ page }) => {
    await expect(page.getByLabel('Login page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  });
});
