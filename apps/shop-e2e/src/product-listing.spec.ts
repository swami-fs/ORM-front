import { test, expect } from '@playwright/test';

test.describe('Login interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should require auth key on login', async ({ page }) => {
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Please enter auth key.')).toBeVisible();
  });

  test('should allow typing auth key', async ({ page }) => {
    const authInput = page.getByLabel('Auth Key');
    await authInput.fill('demo-key');
    await expect(authInput).toHaveValue('demo-key');
  });
});
