import fs from 'fs/promises';
import path from 'path';
import { RunSummary, TestResult, TestCase } from '../types';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function renderTestCase(tc: TestCase): string {
  const classname = escapeXml(tc.file.replace(/\//g, '.').replace(/\.[^.]+$/, ''));
  const name = escapeXml(tc.name);
  const time = formatDuration(tc.duration);

  let inner = '';
  if (tc.status === 'failed') {
    const message = tc.error ? ` message="${escapeXml(tc.error)}"` : '';
    const body = tc.stack ? escapeXml(tc.stack) : (tc.error ? escapeXml(tc.error) : '');
    inner = `\n      <failure${message}>${body}</failure>\n    `;
  } else if (tc.status === 'skipped') {
    inner = `\n      <skipped />\n    `;
  }

  return `    <testcase classname="${classname}" name="${name}" time="${time}">${inner}</testcase>`;
}

function renderTestSuite(result: TestResult, summary: RunSummary): string {
  const tests = result.passed + result.failed + result.skipped;
  const timestamp = summary.startTime instanceof Date
    ? summary.startTime.toISOString()
    : new Date(summary.startTime).toISOString();

  const cases = result.tests.map(renderTestCase).join('\n');

  return [
    `  <testsuite name="cheaptest.shard-${result.shard}"`,
    `             tests="${tests}"`,
    `             failures="${result.failed}"`,
    `             skipped="${result.skipped}"`,
    `             time="${formatDuration(result.duration)}"`,
    `             timestamp="${timestamp}">`,
    cases,
    `  </testsuite>`,
  ].join('\n');
}

export function generateJunitXml(summary: RunSummary): string {
  if (!summary.results || summary.results.length === 0) {
    throw new Error(
      'Cannot generate JUnit XML: no detailed test results available in RunSummary.',
    );
  }

  const suites = summary.results.map(r => renderTestSuite(r, summary)).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="cheaptest" tests="${summary.totalTests}" failures="${summary.failed}" skipped="${summary.skipped}" time="${formatDuration(summary.duration)}">`,
    suites,
    '</testsuites>',
    '',
  ].join('\n');
}

export async function writeJunitXml(summary: RunSummary, outputPath: string): Promise<string> {
  const xml = generateJunitXml(summary);
  const resolved = path.resolve(outputPath);

  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, xml, 'utf-8');

  return resolved;
}
