import { test, expect } from '@playwright/test';

test.describe('Navigation Flow', () => {
  test('should keep user on login screen by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Login page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('should keep login page after browser back/forward on root', async ({ page }) => {
    await page.goto('/');
    await page.goto('/?source=e2e');
    await expect(page.getByLabel('Login page')).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Login page')).toBeVisible();
    await page.goForward();
    await expect(page.getByLabel('Login page')).toBeVisible();
  });
});
