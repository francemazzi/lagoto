import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { NativeTest } from './gate-evaluator.js';

type Node = { nodeType?: string; nodeIdentifier?: string; name?: string; result?: string; children?: Node[] };

/** Flatten the `xcresulttool get test-results tests` tree into test cases. */
export function flattenTestNodes(root: { testNodes?: Node[] }): NativeTest[] {
  const tests: NativeTest[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 'Test Case') tests.push({ identifier: node.nodeIdentifier ?? node.name ?? '', result: node.result ?? 'Unknown' });
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of root.testNodes ?? []) visit(node);
  return tests;
}

export function readXcresultTests(path: string): NativeTest[] | null {
  if (!existsSync(path)) return null;
  const result = spawnSync('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', path, '--format', 'json'], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout) return null;
  try { return flattenTestNodes(JSON.parse(result.stdout)); } catch { return null; }
}

export function readXcresultSummary(path: string): { total: number; passed: number; failed: number; skipped: number } | null {
  if (!existsSync(path)) return null;
  const result = spawnSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', path, '--format', 'json'], { encoding: 'utf8', timeout: 60000 });
  try {
    const value = JSON.parse(result.stdout);
    return { total: value.totalTestCount, passed: value.passedTests, failed: value.failedTests, skipped: value.skippedTests };
  } catch { return null; }
}
