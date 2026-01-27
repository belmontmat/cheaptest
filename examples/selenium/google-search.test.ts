import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

describe('Google Search', () => {
  let driver: WebDriver;

  beforeAll(async () => {
    const options = new chrome.Options();
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
  });

  it('should load Google homepage', async () => {
    const title = await driver.getTitle();
    expect(title).toContain('Google');
    
    const searchBox = await driver.findElement(By.name('q'));
    expect(await searchBox.isDisplayed()).toBe(true);
  });

  it('should perform a search', async () => {
    const searchBox = await driver.findElement(By.name('q'));
    await searchBox.sendKeys('Selenium testing');
    await searchBox.submit();
    
    await driver.wait(until.urlContains('search'), 5000);
    
    const results = await driver.findElement(By.id('search'));
    expect(await results.isDisplayed()).toBe(true);
  });

  it('should display search box', async () => {
    const searchBox = await driver.findElement(By.name('q'));
    expect(await searchBox.isDisplayed()).toBe(true);
    expect(await searchBox.isEnabled()).toBe(true);
  });

  it('should have "I\'m Feeling Lucky" button', async () => {
    const luckyButton = await driver.findElement(By.name('btnI'));
    expect(await luckyButton.isDisplayed()).toBe(true);
  });

  it('should allow typing in search box', async () => {
    const searchBox = await driver.findElement(By.name('q'));
    const testText = 'test query';
    
    await searchBox.sendKeys(testText);
    const value = await searchBox.getAttribute('value');
    
    expect(value).toBe(testText);
  });
});