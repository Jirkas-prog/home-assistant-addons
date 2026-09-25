import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState } from '../src/model.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFile(path.join(root, name), 'utf8');

async function sourceFiles(directory = root) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (['node_modules', 'build'].includes(entry.name) || relative === 'public/pdfjs') continue;
      result.push(...await sourceFiles(full));
    } else if (/\.(?:css|html|js|json|md|mjs|yaml)$/.test(entry.name)) result.push({ full, relative });
  }
  return result;
}

test('repository metadata, package version and Docker build definition agree', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const [config, dockerfile, changelog, docs] = await Promise.all([
    read('config.yaml'), read('Dockerfile'), read('CHANGELOG.md'), read('DOCS.md')
  ]);
  assert.match(config, /^name: Fakturocel$/m);
  assert.match(config, /^slug: fakturocel$/m);
  assert.match(config, new RegExp(`^version: ["']?${pkg.version.replaceAll('.', '\\.')}`,'m'));
  assert.match(config, /^description: [\x20-\x7e]+$/m);
  assert.match(config, /^\s+- amd64$/m);
  assert.match(config, /^\s+- aarch64$/m);
  assert.match(config, /^\s+backup_folder: \/share\/fakturocel\/backups$/m);
  assert.match(dockerfile, /^FROM node:24-alpine@sha256:/m);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, new RegExp(`ARG BUILD_VERSION=${pkg.version.replaceAll('.', '\\.')}`));
  assert.match(changelog, new RegExp(`^## ${pkg.version.replaceAll('.', '\\.')}\s*$`, 'm'));
  assert.match(docs, /English is the default language/);
});

test('fresh state is empty and English is the persistent default', () => {
  const state = emptyState();
  assert.equal(state.settings.language, 'en');
  assert.equal(state.supplier.name, '');
  for (const collection of ['companies', 'activities', 'texts', 'worklogs', 'documents', 'fields', 'rules', 'media', 'checks', 'payments', 'views']) {
    assert.deepEqual(state[collection], []);
  }
  assert.equal(state.templates.length, 2);
  assert(state.templates.every(template => /^Clean invoice$|^Classic invoice$/.test(template.name)));
});

test('Czech text is confined to Czech localization files', async () => {
  const allowed = new Set(['src/locales/cs.json', 'translations/cs.yaml']);
  const czechCharacters = /[\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e\u00c1\u010c\u010e\u00c9\u011a\u00cd\u0147\u00d3\u0158\u0160\u0164\u00da\u016e\u00dd\u017d]/;
  const violations = [];
  for (const file of await sourceFiles()) {
    if (!allowed.has(file.relative) && czechCharacters.test(await fs.readFile(file.full, 'utf8'))) violations.push(file.relative);
  }
  assert.deepEqual(violations, []);
});

test('localization changes presentation text without changing action or field identifiers', async () => {
  const [i18n, localeText] = await Promise.all([read('src/i18n.js'), read('src/locales/cs.json')]);
  const locale = JSON.parse(localeText);
  assert.notEqual(locale.language, 'English');
  assert.notEqual(locale.translations.Overview, 'Overview');
  assert.match(i18n, /\['placeholder','title','aria-label'\]/);
  assert.doesNotMatch(i18n, /setAttribute\(['"](?:data-action|name|id|value)['"]/);
});
