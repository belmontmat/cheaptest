import { generateJunitXml } from './junit';
import { RunSummary, TestResult, TestCase } from '../types';

function makeSummary(overrides?: Partial<RunSummary>): RunSummary {
  return {
    runId: 'run-123',
    backend: 'ecs',
    totalTests: 3,
    passed: 2,
    failed: 1,
    skipped: 0,
    duration: 12345,
    cost: 0.0012,
    startTime: new Date('2025-01-15T10:00:00Z'),
    endTime: new Date('2025-01-15T10:00:12Z'),
    results: [
      {
        shard: 0,
        passed: 2,
        failed: 1,
        skipped: 0,
        duration: 12345,
        tests: [
          { name: 'should login', file: 'e2e/auth/login.spec.ts', status: 'passed', duration: 3000 },
          { name: 'should logout', file: 'e2e/auth/login.spec.ts', status: 'passed', duration: 2000 },
          {
            name: 'should show error',
            file: 'e2e/auth/login.spec.ts',
            status: 'failed',
            duration: 5000,
            error: 'Expected visible but got hidden',
            stack: 'Error: Expected visible but got hidden\n    at Object.<anonymous> (login.spec.ts:42)',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('generateJunitXml', () => {
  it('should produce valid XML declaration and root element', () => {
    const xml = generateJunitXml(makeSummary());

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<testsuites name="cheaptest"');
    expect(xml).toContain('</testsuites>');
  });

  it('should include correct aggregate counts on root element', () => {
    const xml = generateJunitXml(makeSummary());

    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('skipped="0"');
  });

  it('should format duration as seconds with 3 decimals', () => {
    const xml = generateJunitXml(makeSummary({ duration: 12345 }));

    // 12345 ms → 12.345 seconds
    expect(xml).toContain('time="12.345"');
  });

  it('should create one testsuite per shard', () => {
    const results: TestResult[] = [
      {
        shard: 0, passed: 1, failed: 0, skipped: 0, duration: 5000,
        tests: [{ name: 'test-a', file: 'a.spec.ts', status: 'passed', duration: 5000 }],
      },
      {
        shard: 1, passed: 1, failed: 0, skipped: 0, duration: 3000,
        tests: [{ name: 'test-b', file: 'b.spec.ts', status: 'passed', duration: 3000 }],
      },
    ];

    const xml = generateJunitXml(makeSummary({
      totalTests: 2, passed: 2, failed: 0, results,
    }));

    expect(xml).toContain('name="cheaptest.shard-0"');
    expect(xml).toContain('name="cheaptest.shard-1"');
  });

  it('should convert file paths to classname format', () => {
    const xml = generateJunitXml(makeSummary());

    // e2e/auth/login.spec.ts → e2e.auth.login.spec
    expect(xml).toContain('classname="e2e.auth.login.spec"');
  });

  it('should render failure elements with message and stack', () => {
    const xml = generateJunitXml(makeSummary());

    expect(xml).toContain('<failure message="Expected visible but got hidden">');
    expect(xml).toContain('login.spec.ts:42');
    expect(xml).toContain('</failure>');
  });

  it('should render skipped elements', () => {
    const results: TestResult[] = [
      {
        shard: 0, passed: 0, failed: 0, skipped: 1, duration: 0,
        tests: [{ name: 'pending test', file: 'skip.spec.ts', status: 'skipped', duration: 0 }],
      },
    ];

    const xml = generateJunitXml(makeSummary({
      totalTests: 1, passed: 0, failed: 0, skipped: 1, results,
    }));

    expect(xml).toContain('<skipped />');
  });

  it('should escape XML special characters in test names', () => {
    const results: TestResult[] = [
      {
        shard: 0, passed: 1, failed: 0, skipped: 0, duration: 1000,
        tests: [{
          name: 'handles <script> & "quotes" in \'attrs\'',
          file: 'xss.spec.ts',
          status: 'passed',
          duration: 1000,
        }],
      },
    ];

    const xml = generateJunitXml(makeSummary({
      totalTests: 1, passed: 1, failed: 0, results,
    }));

    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;quotes&quot;');
    expect(xml).toContain('&apos;attrs&apos;');
    expect(xml).not.toContain('<script>');
  });

  it('should escape XML special characters in error messages', () => {
    const results: TestResult[] = [
      {
        shard: 0, passed: 0, failed: 1, skipped: 0, duration: 1000,
        tests: [{
          name: 'test',
          file: 'err.spec.ts',
          status: 'failed',
          duration: 1000,
          error: 'Expected <div> to have class "active"',
        }],
      },
    ];

    const xml = generateJunitXml(makeSummary({
      totalTests: 1, passed: 0, failed: 1, results,
    }));

    expect(xml).toContain('&lt;div&gt;');
    expect(xml).toContain('&quot;active&quot;');
  });

  it('should throw when results are missing', () => {
    expect(() => generateJunitXml(makeSummary({ results: undefined }))).toThrow(
      'Cannot generate JUnit XML',
    );
  });

  it('should throw when results array is empty', () => {
    expect(() => generateJunitXml(makeSummary({ results: [] }))).toThrow(
      'Cannot generate JUnit XML',
    );
  });

  it('should include timestamp on testsuite', () => {
    const xml = generateJunitXml(makeSummary());

    expect(xml).toContain('timestamp="2025-01-15T10:00:00.000Z"');
  });

  it('should handle failure without stack trace', () => {
    const results: TestResult[] = [
      {
        shard: 0, passed: 0, failed: 1, skipped: 0, duration: 1000,
        tests: [{
          name: 'no-stack',
          file: 'test.spec.ts',
          status: 'failed',
          duration: 1000,
          error: 'Assertion failed',
        }],
      },
    ];

    const xml = generateJunitXml(makeSummary({
      totalTests: 1, passed: 0, failed: 1, results,
    }));

    expect(xml).toContain('<failure message="Assertion failed">Assertion failed</failure>');
  });
});
