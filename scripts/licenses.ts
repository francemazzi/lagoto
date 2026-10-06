import { readdirSync, lstatSync, readFileSync, mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

export function collectLicenses(runtime: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  const records: { name: string; version: string; license: string; notices: string[] }[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name))) {
      if (!lstatSync(join(directory, name)).isFile()) continue;
      const target = join(destination, relative(runtime, directory)); mkdirSync(target, { recursive: true });
      cpSync(join(directory, name), join(target, name));
    }
    const packageFile = join(directory, 'package.json');
    if (existsSync(packageFile)) {
      const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
      if (typeof pkg.name === 'string' && pkg.version) {
        const notices = readdirSync(directory).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name) && lstatSync(join(directory, name)).isFile());
        const folder = join(destination, relative(runtime, directory)); mkdirSync(folder, { recursive: true });
        for (const name of notices) cpSync(join(directory, name), join(folder, name));
        records.push({ name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'See package notices', notices: notices.map(name => relative(destination, join(folder, name))) });
      }
    }
    for (const name of readdirSync(directory)) {
      const path = join(directory, name); const stat = lstatSync(path);
      if (!stat.isSymbolicLink() && stat.isDirectory()) walk(path);
    }
  };
  walk(join(runtime, 'node_modules'));
  const nodeLicense = join(dirname(dirname(process.execPath)), 'LICENSE');
  if (!existsSync(nodeLicense)) throw new Error('Node distribution LICENSE missing beside the selected runtime');
  cpSync(nodeLicense, join(destination, 'NODE-LICENSE'));
  records.push({ name: 'node', version: process.versions.node, license: 'Node license and bundled third-party notices', notices: ['NODE-LICENSE'] });
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify(records.sort((a, b) => a.name.localeCompare(b.name)), null, 2));
}
