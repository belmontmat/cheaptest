import { test, expect } from '@playwright/test';

test.describe('Google Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://www.google.com');
    // Handle cookie consent if present
    const acceptButton = page.locator('button:has-text("Accept all")');
    if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptButton.click();
    }
  });

  test('should have correct page title', async ({ page }) => {
    await expect(page).toHaveTitle('Google');
  });

  test('should have search input', async ({ page }) => {
    const searchInput = page.locator('textarea[name="q"]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEditable();
  });

  test('should have Google logo', async ({ page }) => {
    // Logo can be img or have various alt text
    const logo = page.locator('img[alt*="Google"], img[alt*="google"], [aria-label*="Google"]').first();
    await expect(logo).toBeVisible();
  });

  test('should have a search button', async ({ page }) => {
    // Google Search button is hidden until the search box is focused
    const searchInput = page.locator('textarea[name="q"]');
    await searchInput.click();
    const searchButton = page.locator('input[value="Google Search"], button:has-text("Google Search")').first();
    await expect(searchButton).toBeVisible({ timeout: 5000 });
  });

  test('should allow typing in search box', async ({ page }) => {
    const searchInput = page.locator('textarea[name="q"]');
    const testText = 'test query';

    await searchInput.fill(testText);
    await expect(searchInput).toHaveValue(testText);
  });
});
