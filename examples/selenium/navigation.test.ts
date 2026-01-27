import { Builder, By, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

describe('Google Navigation', () => {
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

  it('should have correct page title', async () => {
    const title = await driver.getTitle();
    expect(title).toBe('Google');
  });

  it('should have Google logo', async () => {
    const logo = await driver.findElement(By.css('img[alt*="Google"]'));
    expect(await logo.isDisplayed()).toBe(true);
  });

  it('should have search input', async () => {
    const searchInput = await driver.findElement(By.name('q'));
    expect(await searchInput.isDisplayed()).toBe(true);
  });

  it('should enable search input', async () => {
    const searchInput = await driver.findElement(By.name('q'));
    expect(await searchInput.isEnabled()).toBe(true);
  });

  it('should clear search input', async () => {
    const searchInput = await driver.findElement(By.name('q'));
    
    await searchInput.sendKeys('test');
    await searchInput.clear();
    
    const value = await searchInput.getAttribute('value');
    expect(value).toBe('');
  });
});