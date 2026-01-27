import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import { TestFramework } from '../types';

export interface TestFile {
  path: string;
  relativePath: string;
  framework: TestFramework;
  size: number;
  estimatedDuration?: number;
  suite?: string;
}

export interface TestDiscoveryOptions {
  directory: string;
  pattern: string;
  framework: TestFramework;
  exclude?: string[];
  includeEstimates?: boolean;
}

export interface TestDiscoveryResult {
  files: TestFile[];
  totalFiles: number;
  totalSize: number;
  estimatedDuration?: number;
}

/**
 * Discovers test files in a directory based on framework and pattern
 */
export class TestParser {
  private readonly frameworkPatterns: Record<TestFramework, string[]> = {
    playwright: [
      '**/*.spec.ts',
      '**/*.spec.js',
      '**/*.test.ts',
      '**/*.test.js',
      '**/test/**/*.ts',
      '**/test/**/*.js',
    ],
    cypress: [
      '**/cypress/e2e/**/*.cy.ts',
      '**/cypress/e2e/**/*.cy.js',
      '**/cypress/integration/**/*.spec.ts',
      '**/cypress/integration/**/*.spec.js',
    ],
    selenium: [
      '**/*.test.ts',
      '**/*.test.js',
      '**/*.spec.ts',
      '**/*.spec.js',
    ],
  };

  private readonly defaultExcludes = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.d.ts',
  ];

  /**
   * Discover test files based on options
   */
  async discover(options: TestDiscoveryOptions): Promise<TestDiscoveryResult> {
    const {
      directory,
      pattern,
      framework,
      exclude = [],
      includeEstimates = false,
    } = options;

    // Resolve absolute directory path
    const absoluteDir = path.resolve(process.cwd(), directory);

    // Check if directory exists
    await this.validateDirectory(absoluteDir);

    // Build glob pattern
    const searchPattern = this.buildPattern(pattern, framework);
    const ignorePatterns = [...this.defaultExcludes, ...exclude];

    // Find files
    const filePaths = await glob(searchPattern, {
      cwd: absoluteDir,
      ignore: ignorePatterns,
      absolute: false,
      nodir: true,
    });

    if (filePaths.length === 0) {
      throw new Error(
        `No test files found in ${directory} matching pattern: ${pattern}`
      );
    }

    // Parse each file
    const files: TestFile[] = await Promise.all(
      filePaths.map((filePath) =>
        this.parseFile(absoluteDir, filePath, framework, includeEstimates)
      )
    );

    // Sort by path for consistent ordering
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    // Calculate totals
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const estimatedDuration = includeEstimates
      ? files.reduce((sum, file) => sum + (file.estimatedDuration || 0), 0)
      : undefined;

    return {
      files,
      totalFiles: files.length,
      totalSize,
      estimatedDuration,
    };
  }

  /**
   * Parse a single test file
   */
  private async parseFile(
    baseDir: string,
    relativePath: string,
    framework: TestFramework,
    includeEstimates: boolean
  ): Promise<TestFile> {
    const absolutePath = path.join(baseDir, relativePath);
    const stats = await fs.stat(absolutePath);

    const file: TestFile = {
      path: absolutePath,
      relativePath,
      framework,
      size: stats.size,
    };

    // Extract suite name from path (e.g., "auth" from "auth/login.spec.ts")
    file.suite = this.extractSuiteName(relativePath);

    // Estimate duration if requested
    if (includeEstimates) {
      file.estimatedDuration = await this.estimateDuration(
        absolutePath,
        framework
      );
    }

    return file;
  }

  /**
   * Build glob pattern based on custom pattern or framework defaults
   */
  private buildPattern(pattern: string, framework: TestFramework): string {
    // If custom pattern provided, use it
    if (pattern && pattern !== '**/*.spec.ts') {
      return pattern;
    }

    // Otherwise use framework defaults
    const patterns = this.frameworkPatterns[framework];
    
    // For glob, we use the first pattern as primary
    // (in practice, glob supports array but we'll keep it simple)
    return patterns[0];
  }

  /**
   * Validate that directory exists and is readable
   */
  private async validateDirectory(directory: string): Promise<void> {
    try {
      const stats = await fs.stat(directory);
      if (!stats.isDirectory()) {
        throw new Error(`${directory} is not a directory`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Directory not found: ${directory}`);
      }
      throw new Error(`Cannot access directory ${directory}: ${err.message}`);
    }
  }

  /**
   * Extract suite name from file path
   * E.g., "e2e/auth/login.spec.ts" -> "auth"
   */
  private extractSuiteName(filePath: string): string {
    const parts = filePath.split(path.sep);
    
    // Remove filename
    parts.pop();
    
    // If there's a parent directory, use it as suite name
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
    
    return 'default';
  }

  /**
   * Estimate test duration based on file analysis
   * This is a simple heuristic - can be improved with historical data
   */
  private async estimateDuration(
    filePath: string,
    framework: TestFramework
  ): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Count test cases
      const testCount = this.countTests(content, framework);
      
      // Base estimate per test (in milliseconds)
      const basePerTest = this.getBaseEstimate(framework);
      
      // Check for slow indicators
      const slowMultiplier = this.detectSlowTests(content);
      
      return testCount * basePerTest * slowMultiplier;
    } catch {
      // If we can't read the file, return default estimate
      return this.getBaseEstimate(framework);
    }
  }

  /**
   * Count number of test cases in a file
   */
  private countTests(content: string, framework: TestFramework): number {
    let count = 0;

    switch (framework) {
      case 'playwright':
      case 'cypress':
        // Match: test('...', test("...", it('...', it("...
        count = (content.match(/\b(test|it)\s*\(/g) || []).length;
        break;
      case 'selenium':
        // Match: it('...', it("...
        count = (content.match(/\bit\s*\(/g) || []).length;
        break;
    }

    return count || 1; // At least 1 test per file
  }

  /**
   * Get base time estimate per test for framework
   */
  private getBaseEstimate(framework: TestFramework): number {
    // Base estimates in milliseconds
    const estimates: Record<TestFramework, number> = {
      playwright: 5000,  // 5 seconds per test
      cypress: 8000,     // 8 seconds per test (tends to be slower)
      selenium: 10000,   // 10 seconds per test
    };

    return estimates[framework];
  }

  /**
   * Detect indicators of slow tests
   */
  private detectSlowTests(content: string): number {
    let multiplier = 1.0;

    // Check for slow indicators
    if (content.includes('page.waitForTimeout') || 
        content.includes('cy.wait(')) {
      multiplier *= 1.5;
    }

    if (content.includes('page.screenshot') || 
        content.includes('cy.screenshot')) {
      multiplier *= 1.2;
    }

    if (content.includes('video:') || 
        content.includes('recordVideo')) {
      multiplier *= 1.3;
    }

    // Check for API calls
    if (content.includes('fetch(') || 
        content.includes('axios.') ||
        content.includes('request(')) {
      multiplier *= 1.2;
    }

    return multiplier;
  }

  /**
   * Group test files by suite
   */
  groupBySuite(files: TestFile[]): Map<string, TestFile[]> {
    const suites = new Map<string, TestFile[]>();

    for (const file of files) {
      const suite = file.suite || 'default';
      if (!suites.has(suite)) {
        suites.set(suite, []);
      }
      suites.get(suite)!.push(file);
    }

    return suites;
  }

  /**
   * Get test files sorted by estimated duration (longest first)
   */
  sortByDuration(files: TestFile[]): TestFile[] {
    return [...files].sort((a, b) => {
      const durationA = a.estimatedDuration || 0;
      const durationB = b.estimatedDuration || 0;
      return durationB - durationA;
    });
  }

  /**
   * Filter files by suite name
   */
  filterBySuite(files: TestFile[], suites: string[]): TestFile[] {
    return files.filter((file) => 
      suites.includes(file.suite || 'default')
    );
  }

  /**
   * Get summary statistics
   */
  getStats(files: TestFile[]): {
    totalFiles: number;
    totalSize: number;
    avgSize: number;
    suites: string[];
    estimatedTotal?: number;
    avgDuration?: number;
  } {
    const suites = new Set(files.map(f => f.suite || 'default'));
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    
    const hasEstimates = files.some(f => f.estimatedDuration !== undefined);
    const estimatedTotal = hasEstimates
      ? files.reduce((sum, f) => sum + (f.estimatedDuration || 0), 0)
      : undefined;
    
    const avgDuration = estimatedTotal 
      ? estimatedTotal / files.length 
      : undefined;

    return {
      totalFiles: files.length,
      totalSize,
      avgSize: totalSize / files.length,
      suites: Array.from(suites).sort(),
      estimatedTotal,
      avgDuration,
    };
  }
}

/**
 * Convenience function to discover tests
 */
export async function discoverTests(
  options: TestDiscoveryOptions
): Promise<TestDiscoveryResult> {
  const parser = new TestParser();
  return parser.discover(options);
}