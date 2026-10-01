import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
export async function writeNotices(web) {
  const require = createRequire(import.meta.url),
    seen = new Set(),
    notices = [];
  async function license(name, from = require) {
    if (seen.has(name)) return;
    seen.add(name);
    let pkgFile;
    try {
      pkgFile = from.resolve(name + '/package.json');
    } catch {
      let d = path.dirname(from.resolve(name));
      while (d !== path.dirname(d)) {
        try {
          const p = path.join(d, 'package.json'),
            v = JSON.parse(await fs.readFile(p, 'utf8'));
          if (v.name === name) {
            pkgFile = p;
            break;
          }
        } catch {}
        d = path.dirname(d);
      }
    }
    if (!pkgFile) throw Error('Missing package license metadata: ' + name);
    const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8')),
      dir = path.dirname(pkgFile),
      files = (await fs.readdir(dir)).filter(n => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n));
    let content = '';
    for (const f of files) if ((await fs.stat(path.join(dir, f))).isFile()) content += '\n' + (await fs.readFile(path.join(dir, f), 'utf8'));
    notices.push(`## ${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || pkg.licenses)}\n${content}`);
    for (const dep of Object.keys(pkg.dependencies || {})) await license(dep, createRequire(pkgFile));
  }
  const pkg = JSON.parse(await fs.readFile(new URL('./package.json', import.meta.url), 'utf8'));
  for (const name of Object.keys(pkg.dependencies)) await license(name);
  await license('vite-plugin-node-polyfills');
  await fs.writeFile(path.join(web, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
}
