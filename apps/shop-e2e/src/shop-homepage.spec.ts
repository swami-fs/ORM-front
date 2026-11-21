import { test, expect } from '@playwright/test';

test.describe('ReviewLens Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the login card and auth key input', async ({ page }) => {
    const loginPage = page.getByLabel('Login page');
    await expect(page.getByLabel('Login page')).toBeVisible();
    await expect(page.getByText('Enter your auth key to continue to ReviewLens AI.')).toBeVisible();
    await expect(page.getByLabel('Auth Key')).toBeVisible();
    await expect(loginPage.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('should render left menu', async ({ page }) => {
    const leftMenu = page.getByLabel('Left menu');
    await expect(page.getByLabel('Left menu')).toBeVisible();
    await expect(leftMenu.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('should show browser title', async ({ page }) => {
    await expect(page).toHaveTitle('Online Reputation Management');
  });
});
