import { test, expect } from '@playwright/test';

test.describe('Google Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://www.google.com');
  });

  test('should have correct page title', async ({ page }) => {
    await expect(page).toHaveTitle('Google');
  });

  test('should have search input', async ({ page }) => {
    const searchInput = page.locator('input[name="q"]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEditable();
  });

  test('should have Google logo', async ({ page }) => {
    const logo = page.locator('img[alt*="Google"]');
    await expect(logo).toBeVisible();
  });

  test('should have "I\'m Feeling Lucky" button', async ({ page }) => {
    const luckyButton = page.locator('input[name="btnI"]');
    await expect(luckyButton).toBeVisible();
  });

  test('should navigate to About page', async ({ page }) => {
    await page.click('a:has-text("About")');
    await expect(page).toHaveURL(/about\.google/);
  });
});