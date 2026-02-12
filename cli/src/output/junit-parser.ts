export interface JunitReport {
  name: string;
  tests: number;
  failures: number;
  skipped: number;
  time: number;
  suites: JunitSuite[];
}

export interface JunitSuite {
  name: string;
  tests: number;
  failures: number;
  skipped: number;
  time: number;
  timestamp: string;
  cases: JunitCase[];
}

export interface JunitCase {
  classname: string;
  name: string;
  time: number;
  status: 'passed' | 'failed' | 'skipped';
  failureMessage?: string;
  failureBody?: string;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function getAttr(element: string, attr: string): string {
  const regex = new RegExp(`${attr}="([^"]*)"`, 's');
  const match = element.match(regex);
  return match ? unescapeXml(match[1]) : '';
}

function getNumAttr(element: string, attr: string): number {
  const val = getAttr(element, attr);
  return val ? parseFloat(val) : 0;
}

/**
 * Extract the content between an opening and closing tag, handling nested content.
 * Returns array of [fullMatch, innerContent] for each occurrence.
 */
function extractElements(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  const selfClose = /\/>\s*$/;

  let searchFrom = 0;
  while (true) {
    const start = xml.indexOf(openTag, searchFrom);
    if (start === -1) break;

    // Check for self-closing tag
    const nextClose = xml.indexOf('>', start);
    if (nextClose === -1) break;

    const tagHeader = xml.substring(start, nextClose + 1);
    if (selfClose.test(tagHeader)) {
      results.push(tagHeader);
      searchFrom = nextClose + 1;
      continue;
    }

    const end = xml.indexOf(closeTag, nextClose);
    if (end === -1) break;

    results.push(xml.substring(start, end + closeTag.length));
    searchFrom = end + closeTag.length;
  }

  return results;
}

function parseTestCase(caseXml: string): JunitCase {
  const classname = getAttr(caseXml, 'classname');
  const name = getAttr(caseXml, 'name');
  const time = getNumAttr(caseXml, 'time');

  // Check for failure
  const failureMatch = caseXml.match(/<failure([^>]*)>([\s\S]*?)<\/failure>/);
  if (failureMatch) {
    const failureAttrs = failureMatch[1];
    const failureBody = unescapeXml(failureMatch[2]);
    const failureMessage = getAttr(failureAttrs, 'message');
    return { classname, name, time, status: 'failed', failureMessage: unescapeXml(failureMessage), failureBody };
  }

  // Self-closing failure (no body)
  const failureSelfClose = caseXml.match(/<failure([^/]*)\s*\/>/);
  if (failureSelfClose) {
    const failureMessage = getAttr(failureSelfClose[1], 'message');
    return { classname, name, time, status: 'failed', failureMessage: unescapeXml(failureMessage) };
  }

  // Check for skipped
  if (/<skipped\s*\/>/.test(caseXml)) {
    return { classname, name, time, status: 'skipped' };
  }

  return { classname, name, time, status: 'passed' };
}

function parseTestSuite(suiteXml: string): JunitSuite {
  const name = getAttr(suiteXml, 'name');
  const tests = getNumAttr(suiteXml, 'tests');
  const failures = getNumAttr(suiteXml, 'failures');
  const skipped = getNumAttr(suiteXml, 'skipped');
  const time = getNumAttr(suiteXml, 'time');
  const timestamp = getAttr(suiteXml, 'timestamp');

  const caseElements = extractElements(suiteXml, 'testcase');
  const cases = caseElements.map(parseTestCase);

  return { name, tests, failures, skipped, time, timestamp, cases };
}

export function parseJunitXml(xml: string): JunitReport {
  // Extract root <testsuites> attributes
  const rootMatch = xml.match(/<testsuites([^>]*)>/);
  if (!rootMatch) {
    throw new Error('Invalid JUnit XML: missing <testsuites> root element');
  }

  const rootAttrs = rootMatch[1];
  const name = getAttr(rootAttrs, 'name');
  const tests = getNumAttr(rootAttrs, 'tests');
  const failures = getNumAttr(rootAttrs, 'failures');
  const skipped = getNumAttr(rootAttrs, 'skipped');
  const time = getNumAttr(rootAttrs, 'time');

  const suiteElements = extractElements(xml, 'testsuite');
  const suites = suiteElements.map(parseTestSuite);

  return { name, tests, failures, skipped, time, suites };
}
