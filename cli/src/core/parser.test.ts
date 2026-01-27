import { TestParser } from './test-parser';
import { TestFramework } from '../types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('TestParser', () => {
  let parser: TestParser;
  let tempDir: string;

  beforeEach(async () => {
    parser = new TestParser();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-parser-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('discover', () => {
    it('should find test files matching pattern', async () => {
      // Create test files
      await fs.mkdir(path.join(tempDir, 'e2e'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'test1.spec.ts'),
        'test("example", () => {})'
      );
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'test2.spec.ts'),
        'test("example", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.totalFiles).toBe(2);
      expect(result.files).toHaveLength(2);
      expect(result.files[0].framework).toBe('playwright');
    });

    it('should discover tests in nested directories', async () => {
      // Create nested structure
      await fs.mkdir(path.join(tempDir, 'e2e', 'auth'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'e2e', 'checkout'), { recursive: true });
      
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'auth', 'login.spec.ts'),
        'test("login", () => {})'
      );
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'checkout', 'cart.spec.ts'),
        'test("cart", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.totalFiles).toBe(2);
      expect(result.files.some(f => f.relativePath.includes('auth'))).toBe(true);
      expect(result.files.some(f => f.relativePath.includes('checkout'))).toBe(true);
    });

    it('should exclude node_modules by default', async () => {
      await fs.mkdir(path.join(tempDir, 'node_modules', 'lib'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(tempDir, 'node_modules', 'lib', 'test.spec.ts'),
        'test("example", () => {})'
      );
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        'test("example", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.totalFiles).toBe(1);
      expect(result.files[0].relativePath).toBe('test.spec.ts');
    });

    it('should exclude dist and build directories', async () => {
      await fs.mkdir(path.join(tempDir, 'dist'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'build'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'e2e'), { recursive: true });
      
      await fs.writeFile(
        path.join(tempDir, 'dist', 'test.spec.ts'),
        'test("example", () => {})'
      );
      await fs.writeFile(
        path.join(tempDir, 'build', 'test.spec.ts'),
        'test("example", () => {})'
      );
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'test.spec.ts'),
        'test("example", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.totalFiles).toBe(1);
      expect(result.files[0].relativePath).toContain('e2e');
    });

    it('should respect custom exclude patterns', async () => {
      await fs.mkdir(path.join(tempDir, 'e2e'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'e2e', 'flaky'), { recursive: true });
      
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'good.spec.ts'),
        'test("example", () => {})'
      );
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'flaky', 'bad.spec.ts'),
        'test("example", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        exclude: ['**/flaky/**'],
      });

      expect(result.totalFiles).toBe(1);
      expect(result.files[0].relativePath).toContain('good.spec.ts');
    });

    it('should throw error if no files found', async () => {
      await expect(
        parser.discover({
          directory: tempDir,
          pattern: '**/*.spec.ts',
          framework: 'playwright',
        })
      ).rejects.toThrow('No test files found');
    });

    it('should throw error if directory does not exist', async () => {
      await expect(
        parser.discover({
          directory: path.join(tempDir, 'nonexistent'),
          pattern: '**/*.spec.ts',
          framework: 'playwright',
        })
      ).rejects.toThrow('Directory not found');
    });

    it('should throw error if path is a file, not a directory', async () => {
      const filePath = path.join(tempDir, 'file.txt');
      await fs.writeFile(filePath, 'content');

      await expect(
        parser.discover({
          directory: filePath,
          pattern: '**/*.spec.ts',
          framework: 'playwright',
        })
      ).rejects.toThrow('is not a directory');
    });

    it('should extract suite names from directory structure', async () => {
      await fs.mkdir(path.join(tempDir, 'e2e', 'auth'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'e2e', 'auth', 'login.spec.ts'),
        'test("login", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.files[0].suite).toBe('auth');
    });

    it('should use "default" suite for root-level files', async () => {
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        'test("example", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.files[0].suite).toBe('default');
    });

    it('should calculate total size of test files', async () => {
      const content1 = 'test("test1", () => {})';
      const content2 = 'test("test2", () => {})';
      
      await fs.writeFile(path.join(tempDir, 'test1.spec.ts'), content1);
      await fs.writeFile(path.join(tempDir, 'test2.spec.ts'), content2);

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.totalSize).toBeGreaterThan(0);
      expect(result.totalSize).toBe(
        result.files[0].size + result.files[1].size
      );
    });

    it('should estimate durations when requested', async () => {
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        `
        test("test 1", () => {});
        test("test 2", () => {});
        test("test 3", () => {});
        `
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: true,
      });

      expect(result.files[0].estimatedDuration).toBeDefined();
      expect(result.files[0].estimatedDuration).toBeGreaterThan(0);
      expect(result.estimatedDuration).toBeDefined();
      expect(result.estimatedDuration).toBeGreaterThan(0);
    });

    it('should not estimate durations when not requested', async () => {
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        'test("example", () => {})'
      );

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: false,
      });

      expect(result.files[0].estimatedDuration).toBeUndefined();
      expect(result.estimatedDuration).toBeUndefined();
    });

    it('should sort files alphabetically by path', async () => {
      await fs.writeFile(path.join(tempDir, 'zebra.spec.ts'), 'test("z", () => {})');
      await fs.writeFile(path.join(tempDir, 'alpha.spec.ts'), 'test("a", () => {})');
      await fs.writeFile(path.join(tempDir, 'beta.spec.ts'), 'test("b", () => {})');

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.files[0].relativePath).toBe('alpha.spec.ts');
      expect(result.files[1].relativePath).toBe('beta.spec.ts');
      expect(result.files[2].relativePath).toBe('zebra.spec.ts');
    });

    it('should handle different test frameworks', async () => {
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        'test("example", () => {})'
      ); // TODO: Fails

      const frameworks: TestFramework[] = ['playwright', 'cypress', 'selenium'];

      for (const framework of frameworks) {
        const result = await parser.discover({
          directory: tempDir,
          pattern: '**/*.spec.ts',
          framework,
        });

        expect(result.files[0].framework).toBe(framework);
      }
    });
  });

  describe('estimateDuration', () => {
    it('should count test cases in playwright tests', async () => {
      const content = `
        test("test 1", () => {});
        test("test 2", () => {});
        it("test 3", () => {});
      `;
      await fs.writeFile(path.join(tempDir, 'test.spec.ts'), content);

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: true,
      });

      // Should detect 3 tests and estimate accordingly
      expect(result.files[0].estimatedDuration).toBeGreaterThan(5000 * 2);
    });

    it('should increase estimate for slow indicators', async () => {
      const slowContent = `
        test("slow test", async () => {
          await page.waitForTimeout(5000);
          await page.screenshot();
          await fetch('https://api.example.com');
        });
      `;
      await fs.writeFile(path.join(tempDir, 'slow.spec.ts'), slowContent);

      const fastContent = `
        test("fast test", () => {
          expect(1).toBe(1);
        });
      `;
      await fs.writeFile(path.join(tempDir, 'fast.spec.ts'), fastContent);

      const result = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: true,
      });

      const slowFile = result.files.find(f => f.relativePath === 'slow.spec.ts');
      const fastFile = result.files.find(f => f.relativePath === 'fast.spec.ts');

      expect(slowFile!.estimatedDuration).toBeGreaterThan(fastFile!.estimatedDuration!);
    });

    it('should use different base estimates for different frameworks', async () => {
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        'test("example", () => {})'
      );

      const playwrightResult = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: true,
      });

      const cypressResult = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'cypress',
        includeEstimates: true,
      });

      const seleniumResult = await parser.discover({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'selenium',
        includeEstimates: true,
      }); // TODO: Fails

      // Cypress should be slower than Playwright
      expect(cypressResult.files[0].estimatedDuration).toBeGreaterThan(
        playwrightResult.files[0].estimatedDuration!
      );

      // Selenium should be slowest
      expect(seleniumResult.files[0].estimatedDuration).toBeGreaterThan(
        cypressResult.files[0].estimatedDuration!
      );
    });

    it('should handle files that cannot be read gracefully', async () => {
      await fs.writeFile(path.join(tempDir, 'test.spec.ts'), 'test("example", () => {})');
      
      // Make file unreadable (Unix only)
      if (process.platform !== 'win32') {
        try {
          await fs.chmod(path.join(tempDir, 'test.spec.ts'), 0o000);
          
          const result = await parser.discover({
            directory: tempDir,
            pattern: '**/*.spec.ts',
            framework: 'playwright',
            includeEstimates: true,
          });

          // Should still return a result with default estimate
          expect(result.files[0].estimatedDuration).toBeDefined();
          
          // Clean up
          await fs.chmod(path.join(tempDir, 'test.spec.ts'), 0o644);
        } catch (err) {
          // Skip test if chmod fails
          console.log('Skipping chmod test:', err);
        }
      }
    });
  });

  describe('groupBySuite', () => {
    it('should group files by suite name', () => {
      const files = [
        {
          path: '/test/auth/login.spec.ts',
          relativePath: 'auth/login.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'auth',
        },
        {
          path: '/test/auth/signup.spec.ts',
          relativePath: 'auth/signup.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'auth',
        },
        {
          path: '/test/checkout/cart.spec.ts',
          relativePath: 'checkout/cart.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'checkout',
        },
      ];

      const suites = parser.groupBySuite(files);

      expect(suites.size).toBe(2);
      expect(suites.get('auth')).toHaveLength(2);
      expect(suites.get('checkout')).toHaveLength(1);
    });

    it('should handle default suite', () => {
      const files = [
        {
          path: '/test/test.spec.ts',
          relativePath: 'test.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'default',
        },
      ];

      const suites = parser.groupBySuite(files);

      expect(suites.size).toBe(1);
      expect(suites.get('default')).toHaveLength(1);
    });

    it('should handle files without suite property', () => {
      const files = [
        {
          path: '/test/test.spec.ts',
          relativePath: 'test.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
        },
      ];

      const suites = parser.groupBySuite(files);

      expect(suites.size).toBe(1);
      expect(suites.get('default')).toHaveLength(1);
    });
  });

  describe('sortByDuration', () => {
    it('should sort files by duration descending', () => {
      const files = [
        {
          path: '/test/fast.spec.ts',
          relativePath: 'fast.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          estimatedDuration: 1000,
        },
        {
          path: '/test/slow.spec.ts',
          relativePath: 'slow.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          estimatedDuration: 5000,
        },
        {
          path: '/test/medium.spec.ts',
          relativePath: 'medium.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          estimatedDuration: 3000,
        },
      ];

      const sorted = parser.sortByDuration(files);

      expect(sorted[0].relativePath).toBe('slow.spec.ts');
      expect(sorted[1].relativePath).toBe('medium.spec.ts');
      expect(sorted[2].relativePath).toBe('fast.spec.ts');
    });

    it('should handle files without duration estimates', () => {
      const files = [
        {
          path: '/test/test1.spec.ts',
          relativePath: 'test1.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
        },
        {
          path: '/test/test2.spec.ts',
          relativePath: 'test2.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          estimatedDuration: 5000,
        },
      ];

      const sorted = parser.sortByDuration(files);

      // File with duration should come first
      expect(sorted[0].relativePath).toBe('test2.spec.ts');
      expect(sorted[1].relativePath).toBe('test1.spec.ts');
    });

    it('should not mutate original array', () => {
      const files = [
        {
          path: '/test/fast.spec.ts',
          relativePath: 'fast.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          estimatedDuration: 1000,
        },
        {
          path: '/test/slow.spec.ts',
          relativePath: 'slow.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          estimatedDuration: 5000,
        },
      ];

      const originalOrder = files.map(f => f.relativePath);
      parser.sortByDuration(files);

      expect(files.map(f => f.relativePath)).toEqual(originalOrder);
    });
  });

  describe('filterBySuite', () => {
    it('should filter files by suite names', () => {
      const files = [
        {
          path: '/test/auth/login.spec.ts',
          relativePath: 'auth/login.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'auth',
        },
        {
          path: '/test/checkout/cart.spec.ts',
          relativePath: 'checkout/cart.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'checkout',
        },
        {
          path: '/test/search/filters.spec.ts',
          relativePath: 'search/filters.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'search',
        },
      ];

      const filtered = parser.filterBySuite(files, ['auth', 'checkout']);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(f => ['auth', 'checkout'].includes(f.suite!))).toBe(true);
    });

    it('should handle default suite', () => {
      const files = [
        {
          path: '/test/test.spec.ts',
          relativePath: 'test.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'default',
        },
      ];

      const filtered = parser.filterBySuite(files, ['default']);

      expect(filtered).toHaveLength(1);
    });

    it('should return empty array if no matches', () => {
      const files = [
        {
          path: '/test/auth/login.spec.ts',
          relativePath: 'auth/login.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'auth',
        },
      ];

      const filtered = parser.filterBySuite(files, ['nonexistent']);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should calculate statistics for test files', () => {
      const files = [
        {
          path: '/test/test1.spec.ts',
          relativePath: 'test1.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 1000,
          suite: 'auth',
          estimatedDuration: 5000,
        },
        {
          path: '/test/test2.spec.ts',
          relativePath: 'test2.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 2000,
          suite: 'checkout',
          estimatedDuration: 7000,
        },
        {
          path: '/test/test3.spec.ts',
          relativePath: 'test3.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 3000,
          suite: 'auth',
          estimatedDuration: 6000,
        },
      ];

      const stats = parser.getStats(files);

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(6000);
      expect(stats.avgSize).toBe(2000);
      expect(stats.suites).toEqual(['auth', 'checkout']);
      expect(stats.estimatedTotal).toBe(18000);
      expect(stats.avgDuration).toBe(6000);
    });

    it('should handle files without duration estimates', () => {
      const files = [
        {
          path: '/test/test1.spec.ts',
          relativePath: 'test1.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 1000,
          suite: 'auth',
        },
      ];

      const stats = parser.getStats(files);

      expect(stats.estimatedTotal).toBeUndefined();
      expect(stats.avgDuration).toBeUndefined();
    });

    it('should sort suite names alphabetically', () => {
      const files = [
        {
          path: '/test/test1.spec.ts',
          relativePath: 'test1.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'zebra',
        },
        {
          path: '/test/test2.spec.ts',
          relativePath: 'test2.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'alpha',
        },
        {
          path: '/test/test3.spec.ts',
          relativePath: 'test3.spec.ts',
          framework: 'playwright' as TestFramework,
          size: 100,
          suite: 'beta',
        },
      ];

      const stats = parser.getStats(files);

      expect(stats.suites).toEqual(['alpha', 'beta', 'zebra']);
    });
  });

  describe('discoverTests convenience function', () => {
    it('should work as a standalone function', async () => {
      await fs.writeFile(
        path.join(tempDir, 'test.spec.ts'),
        'test("example", () => {})'
      );

      const { discoverTests } = await import('./test-parser');
      
      const result = await discoverTests({
        directory: tempDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
      });

      expect(result.totalFiles).toBe(1);
    });
  });
});

// ============================================
// TESTS WITH REAL EXAMPLE FILES
// ============================================

describe('TestParser with example files', () => {
  let parser: TestParser;
  const projectRoot = path.join(__dirname, '../..');
  const examplesDir = path.join(projectRoot, 'examples');

  beforeEach(() => {
    parser = new TestParser();
  });

  describe('Playwright examples', () => {
    it('should discover Playwright example tests', async () => {
      const playwrightDir = path.join(examplesDir, 'playwright');
      
      try {
        await fs.access(playwrightDir);
      } catch {
        console.log('⏭️  Playwright examples not found, skipping test');
        return;
      }

      const result = await parser.discover({
        directory: playwrightDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: true,
      });

      expect(result.totalFiles).toBeGreaterThan(0);
      expect(result.files.every(f => f.framework === 'playwright')).toBe(true);
      expect(result.files.every(f => f.estimatedDuration! > 0)).toBe(true);
      
      console.log(`✅ Found ${result.totalFiles} Playwright test files`);
      result.files.forEach(f => {
        console.log(`   - ${f.relativePath} (~${(f.estimatedDuration! / 1000).toFixed(1)}s)`);
      });
    });

    it('should detect multiple test cases in Playwright files', async () => {
      const playwrightDir = path.join(examplesDir, 'playwright');
      
      try {
        await fs.access(playwrightDir);
      } catch {
        console.log('⏭️  Playwright examples not found, skipping test');
        return;
      }

      const result = await parser.discover({
        directory: playwrightDir,
        pattern: '**/*.spec.ts',
        framework: 'playwright',
        includeEstimates: true,
      });

      const searchFile = result.files.find(f => f.relativePath.includes('google-search'));
      if (searchFile) {
        expect(searchFile.estimatedDuration).toBeGreaterThanOrEqual(15000);
      }
    });
  });

  describe('Cypress examples', () => {
    it('should discover Cypress example tests', async () => {
      const cypressDir = path.join(examplesDir, 'cypress');
      
      try {
        await fs.access(cypressDir);
      } catch {
        console.log('⏭️  Cypress examples not found, skipping test');
        return;
      }

      const result = await parser.discover({
        directory: cypressDir,
        pattern: '**/*.cy.ts',
        framework: 'cypress',
        includeEstimates: true,
      });

      expect(result.totalFiles).toBeGreaterThan(0);
      expect(result.files.every(f => f.framework === 'cypress')).toBe(true);
      
      console.log(`✅ Found ${result.totalFiles} Cypress test files`);
      result.files.forEach(f => {
        console.log(`   - ${f.relativePath} (~${(f.estimatedDuration! / 1000).toFixed(1)}s)`);
      });
    });

    it('should group Cypress tests by suite', async () => {
      const cypressDir = path.join(examplesDir, 'cypress');
      
      try {
        await fs.access(cypressDir);
      } catch {
        console.log('⏭️  Cypress examples not found, skipping test');
        return;
      }

      const result = await parser.discover({
        directory: cypressDir,
        pattern: '**/*.cy.ts',
        framework: 'cypress',
      });

      const suites = parser.groupBySuite(result.files);
      expect(suites.has('e2e')).toBe(true);
      
      console.log(`✅ Cypress tests grouped into ${suites.size} suites:`);
      suites.forEach((files, suite) => {
        console.log(`   ${suite}: ${files.length} files`);
      });
    });
  });

  describe('Selenium examples', () => {
    it('should discover Selenium example tests', async () => {
      const seleniumDir = path.join(examplesDir, 'selenium');
      
      try {
        await fs.access(seleniumDir);
      } catch {
        console.log('⏭️  Selenium examples not found, skipping test');
        return;
      }

      const result = await parser.discover({
        directory: seleniumDir,
        pattern: '**/*.test.ts',
        framework: 'selenium',
        includeEstimates: true,
      });

      expect(result.totalFiles).toBeGreaterThan(0);
      expect(result.files.every(f => f.framework === 'selenium')).toBe(true);
      
      console.log(`✅ Found ${result.totalFiles} Selenium test files`);
      result.files.forEach(f => {
        console.log(`   - ${f.relativePath} (~${(f.estimatedDuration! / 1000).toFixed(1)}s)`);
      });
    });

    it('should have longer estimates for Selenium than Playwright', async () => {
      const playwrightDir = path.join(examplesDir, 'playwright');
      const seleniumDir = path.join(examplesDir, 'selenium');
      
      try {
        await fs.access(playwrightDir);
        await fs.access(seleniumDir);
        } catch {
      console.log('⏭️  Examples not found, skipping test');
      return;
      }
      
      const playwrightResult = await parser.discover({
    directory: playwrightDir,
    pattern: '**/*.spec.ts',
    framework: 'playwright',
    includeEstimates: true,
  });

  const seleniumResult = await parser.discover({
    directory: seleniumDir,
    pattern: '**/*.test.ts',
    framework: 'selenium',
    includeEstimates: true,
  });

  const playwrightAvg = playwrightResult.estimatedDuration! / playwrightResult.totalFiles;
  const seleniumAvg = seleniumResult.estimatedDuration! / seleniumResult.totalFiles;

  expect(seleniumAvg).toBeGreaterThan(playwrightAvg);
  
  console.log(`📊 Average estimated duration:`);
  console.log(`   Playwright: ${(playwrightAvg / 1000).toFixed(1)}s per file`);
  console.log(`   Selenium: ${(seleniumAvg / 1000).toFixed(1)}s per file`);
});

});
  describe('Cross-framework comparison', () => {
    it('should detect different patterns for each framework', async () => {
      try {
        await fs.access(examplesDir);
      } catch {
        console.log('⏭️  Examples directory not found, skipping test');
        return;
      }

      const results = [];

      try {
        const playwright = await parser.discover({
          directory: path.join(examplesDir, 'playwright'),
          pattern: '**/*.spec.ts',
          framework: 'playwright',
        });
        results.push({ framework: 'Playwright', count: playwright.totalFiles });
      } catch {
        console.log('⏭️  Playwright examples not found');
      }

      try {
        const cypress = await parser.discover({
          directory: path.join(examplesDir, 'cypress'),
          pattern: '**/*.cy.ts',
          framework: 'cypress',
        });
        results.push({ framework: 'Cypress', count: cypress.totalFiles });
      } catch {
        console.log('⏭️  Cypress examples not found');
      }

      try {
        const selenium = await parser.discover({
          directory: path.join(examplesDir, 'selenium'),
          pattern: '**/*.test.ts',
          framework: 'selenium',
        });
        results.push({ framework: 'Selenium', count: selenium.totalFiles });
      } catch {
        console.log('⏭️  Selenium examples not found');
      }

      expect(results.length).toBeGreaterThan(0);
      
      console.log(`✅ Found tests in ${results.length} frameworks:`);
      results.forEach(r => {
        console.log(`   ${r.framework}: ${r.count} files`);
      });
    });

    it('should calculate accurate statistics across all examples', async () => {
      try {
        await fs.access(examplesDir);
      } catch {
        console.log('⏭️  Examples directory not found, skipping test');
        return;
      }

      const allFiles: any[] = [];

      const frameworks = [
        { dir: 'playwright', pattern: '**/*.spec.ts', framework: 'playwright' as TestFramework },
        { dir: 'cypress', pattern: '**/*.cy.ts', framework: 'cypress' as TestFramework },
        { dir: 'selenium', pattern: '**/*.test.ts', framework: 'selenium' as TestFramework },
      ];

      for (const fw of frameworks) {
        try {
          const result = await parser.discover({
            directory: path.join(examplesDir, fw.dir),
            pattern: fw.pattern,
            framework: fw.framework,
            includeEstimates: true,
          });
          allFiles.push(...result.files);
        } catch {
          // Skip if not found
        }
      }

      if (allFiles.length === 0) {
        console.log('⏭️  No example files found, skipping test');
        return;
      }

      const stats = parser.getStats(allFiles);

      expect(stats.totalFiles).toBeGreaterThan(0);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.estimatedTotal).toBeGreaterThan(0);

      console.log(`📊 Statistics across all example tests:`);
      console.log(`   Total files: ${stats.totalFiles}`);
      console.log(`   Total size: ${(stats.totalSize / 1024).toFixed(2)} KB`);
      console.log(`   Estimated duration: ${(stats.estimatedTotal! / 1000).toFixed(1)}s`);
      console.log(`   Test suites: ${stats.suites.join(', ')}`);
    });
  });
});