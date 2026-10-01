import { nodePolyfills } from 'vite-plugin-node-polyfills';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNotices } from './notices.mjs';
import { createHash } from 'node:crypto';
import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import JSZip from 'jszip';
const root = fileURLToPath(new URL('./', import.meta.url));
export async function buildAddon(target = path.join(root, 'build', 'fakturocel'), output = path.join(root, 'build', 'Fakturocel-HomeAssistant-3.8.0.zip')) {
  await fs.mkdir(target, {
    recursive: true
  });
  const web = path.join(target, 'web');
  await viteBuild({
    root,
    configFile: false,
    base: './',
    plugins: [nodePolyfills({
      overrides: {
        crypto: path.join(root, 'src/excel-crypto.js')
      }
    })],
    worker: {
      format: 'es',
      plugins: () => [nodePolyfills({
        overrides: {
          crypto: path.join(root, 'src/excel-crypto.js')
        }
      })]
    },
    build: {
      target: 'es2022',
      outDir: web,
      emptyOutDir: true,
      chunkSizeWarningLimit: 2200
    }
  });
  await bundle({
    entryPoints: [path.join(root, 'server', 'server.mjs')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: {
      js: "import {createRequire as createNodeRequire} from 'node:module'; const require=createNodeRequire(import.meta.url);"
    },
    outfile: path.join(target, 'server.mjs')
  });
  for (const name of ['config.yaml', 'DOCS.md', 'CHANGELOG.md', 'TESTING.md', 'SECURITY.md', 'icon.png', 'logo.png']) await fs.copyFile(path.join(root, name), path.join(target, name));
  await fs.copyFile(path.join(root, 'Dockerfile.release'), path.join(target, 'Dockerfile'));
  await fs.copyFile(path.join(root, '.dockerignore.release'), path.join(target, '.dockerignore'));
  await fs.cp(path.join(root, 'translations'), path.join(target, 'translations'), { recursive: true });
  await fs.copyFile(path.join(root, 'DOCS.md'), path.join(target, 'README.md'));
  await writeNotices(web);
  const zip = new JSZip();
  async function add(dir, prefix) {
    for (const e of await fs.readdir(dir, {
      withFileTypes: true
    })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw Error('Unexpected symbolic link');
      if (e.isDirectory()) await add(p, prefix + e.name + '/');else zip.file(prefix + e.name, await fs.readFile(p));
    }
  }
  await add(target, "fakturocel/");
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 9
    }
  });
  await fs.mkdir(path.dirname(output), {
    recursive: true
  });
  await fs.writeFile(output, bytes);
  await fs.writeFile(output + '.sha256', createHash('sha256').update(bytes).digest('hex') + '  ' + path.basename(output) + '\n');
  console.log('Saved ' + path.basename(output) + ' (' + bytes.length + ' bytes)');
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildAddon();
