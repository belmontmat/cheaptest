import { test, expect } from '@playwright/test';

test.describe('Google Search', () => {
  test('should load Google homepage', async ({ page }) => {
    await page.goto('https://www.google.com');
    
    await expect(page).toHaveTitle(/Google/);
    await expect(page.locator('input[name="q"]')).toBeVisible();
  });

  test('should perform a search', async ({ page }) => {
    await page.goto('https://www.google.com');
    
    const searchBox = page.locator('input[name="q"]');
    await searchBox.fill('Playwright testing');
    await searchBox.press('Enter');
    
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveURL(/search/);
    await expect(page.locator('#search')).toBeVisible();
  });

  test('should display search suggestions', async ({ page }) => {
    await page.goto('https://www.google.com');
    
    const searchBox = page.locator('input[name="q"]');
    await searchBox.fill('test automation');
    
    // Wait for suggestions to appear
    await page.waitForSelector('ul[role="listbox"]', { timeout: 5000 });
    
    const suggestions = page.locator('ul[role="listbox"] li');
    await expect(suggestions.first()).toBeVisible();
  });

  test('should navigate to Images', async ({ page }) => {
    await page.goto('https://www.google.com');
    
    // Accept cookies if prompt appears
    const acceptButton = page.locator('button:has-text("Accept all")');
    if (await acceptButton.isVisible()) {
      await acceptButton.click();
    }
    
    await page.click('a:has-text("Images")');
    
    await expect(page).toHaveURL(/google.*\/imghp/);
  });
});