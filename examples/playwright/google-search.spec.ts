import { test, expect } from '@playwright/test';

test.describe('Google Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://www.google.com');
    // Handle cookie consent if present
    const acceptButton = page.locator('button:has-text("Accept all")');
    if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptButton.click();
    }
  });

  test('should load Google homepage', async ({ page }) => {
    await expect(page).toHaveTitle(/Google/);
    await expect(page.locator('textarea[name="q"]')).toBeVisible();
  });

  test('should perform a search', async ({ page }) => {
    const searchBox = page.locator('textarea[name="q"]');
    await searchBox.fill('Playwright testing');
    await searchBox.press('Enter');

    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/search/);
    await expect(page.locator('#search, #rso').first()).toBeVisible();
  });

  test('should display search suggestions', async ({ page }) => {
    const searchBox = page.locator('textarea[name="q"]');
    await searchBox.fill('test automation');

    // Wait for suggestions to appear
    const suggestions = page.locator('[role="listbox"], [role="presentation"] ul');
    await expect(suggestions.first()).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Images', async ({ page }) => {
    await page.click('a:has-text("Images")');
    await expect(page).toHaveURL(/imghp/);
  });
});
