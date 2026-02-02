import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome';

describe('Google Search', () => {
  let driver: WebDriver;

  beforeAll(async () => {
    const options = new ChromeOptions();
    options.addArguments('--headless');
    options.addArguments('--disable-gpu');
    options.addArguments('--no-sandbox');

    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();
  });

  afterAll(async () => {
    await driver.quit();
  });

  beforeEach(async () => {
    await driver.get('https://www.google.com');
    // Handle cookie consent if present
    try {
      const acceptButton = await driver.findElement(By.xpath('//button[contains(text(), "Accept all")]'));
      if (await acceptButton.isDisplayed()) {
        await acceptButton.click();
      }
    } catch {
      // No consent dialog, continue
    }
  });

  it('should load Google homepage', async () => {
    const title = await driver.getTitle();
    expect(title).toContain('Google');

    const searchBox = await driver.findElement(By.css('textarea[name="q"]'));
    expect(await searchBox.isDisplayed()).toBe(true);
  });

  it('should perform a search', async () => {
    const searchBox = await driver.findElement(By.css('textarea[name="q"]'));
    await searchBox.sendKeys('Selenium testing');
    await searchBox.submit();

    await driver.wait(until.urlContains('search'), 5000);

    // Search results can be in #search or #rso
    const results = await driver.findElement(By.css('#search, #rso'));
    expect(await results.isDisplayed()).toBe(true);
  });

  it('should display search box', async () => {
    const searchBox = await driver.findElement(By.css('textarea[name="q"]'));
    expect(await searchBox.isDisplayed()).toBe(true);
    expect(await searchBox.isEnabled()).toBe(true);
  });

  it('should have a search button', async () => {
    // Google Search button - can be input or button
    const searchButton = await driver.findElement(By.css('input[value="Google Search"]'));
    expect(await searchButton.isDisplayed()).toBe(true);
  });

  it('should allow typing in search box', async () => {
    const searchBox = await driver.findElement(By.css('textarea[name="q"]'));
    const testText = 'test query';

    await searchBox.sendKeys(testText);
    const value = await searchBox.getAttribute('value');

    expect(value).toBe(testText);
  });
});
