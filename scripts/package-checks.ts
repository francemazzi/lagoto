import { existsSync, readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type BundleCheck = { name: string; ok: boolean; detail?: string };

function walk(directory: string, visit: (path: string, name: string) => void) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    visit(path, name);
    if (lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()) walk(path, visit);
  }
}

/**
 * Checks on a built app bundle that the distributed package carries no test harness or automation endpoint
 * and that the test-only data-directory override is not compiled into the native executable (P00-I05).
 */
export function inspectBundle(app: string, executableName = 'Lagoto'): BundleCheck[] {
  const checks: BundleCheck[] = [];
  const offenders: string[] = [];
  walk(app, (path, name) => { if (/^(XCTest|XCUIAutomation|XCTAutomationSupport)\b|\.xctest$|LagotoUITests|LagotoTests/.test(name)) offenders.push(path.slice(app.length + 1)); });
  checks.push({ name: 'no-test-bundles', ok: offenders.length === 0, ...(offenders.length ? { detail: offenders.slice(0, 5).join(', ') } : {}) });
  const executable = join(app, 'Contents/MacOS', executableName);
  const present = existsSync(executable);
  const text = present ? readFileSync(executable).toString('latin1') : '';
  checks.push({ name: 'native-executable-present', ok: present });
  checks.push({ name: 'no-data-dir-override-in-native-executable', ok: present && !text.includes('LAGOTO_DATA_DIR') && !text.includes('LAGOTO_UI_FIXTURE') && !text.includes('LagotoShowcase') && !text.includes('LagotoWindowSize') });
  checks.push({ name: 'no-window-size-override-in-native-executable', ok: present && !text.includes('LagotoWindowSize') });
  const runtime = join(app, 'Contents/Resources/runtime/node');
  checks.push({ name: 'bundled-node-present', ok: existsSync(runtime) });
  checks.push({ name: 'build-provenance-present', ok: existsSync(join(app, 'Contents/Resources/build-provenance.json')) });
  checks.push({ name: 'license-present', ok: existsSync(join(app, 'Contents/Resources/LICENSE')) });
  return checks;
}
