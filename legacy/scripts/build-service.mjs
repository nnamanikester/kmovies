/**
 * Prepares services/proxy/vendor/ for packaging:
 *  - esbuild: the linux-arm binary (same version as the local esbuild) for the TV CPU
 *  - polyfills.js: core-js features missing from the TV engine + small DOM polyfills
 * Both are generated, git-ignored, and only rebuilt when missing (pass --force to rebuild).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import builder from 'core-js-builder';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_DIR = join(ROOT, 'services', 'proxy');
const VENDOR_DIR = join(SERVICE_DIR, 'vendor');
const force = process.argv.includes('--force');

/** Must match TRANSPILE_TARGET in services/proxy/lib/config.js. */
const BROWSER_TARGET = 'chrome 68';
const ESBUILD_PLATFORM = 'linux-arm';

mkdirSync(VENDOR_DIR, { recursive: true });

async function fetchEsbuild() {
  const out = join(VENDOR_DIR, 'esbuild');
  if (existsSync(out) && !force) return console.log('✔ vendor/esbuild (cached)');

  const { version } = require('esbuild/package.json');
  const url = `https://registry.npmjs.org/@esbuild/${ESBUILD_PLATFORM}/-/${ESBUILD_PLATFORM}-${version}.tgz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);

  const workDir = join(tmpdir(), `kmovies-esbuild-${Date.now()}`);
  mkdirSync(workDir);
  const tarball = join(workDir, 'esbuild.tgz');
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', tarball, '-C', workDir]);
  writeFileSync(out, readFileSync(join(workDir, 'package', 'bin', 'esbuild')));
  chmodSync(out, 0o755);
  rmSync(workDir, { recursive: true, force: true });
  console.log(`✔ vendor/esbuild (${ESBUILD_PLATFORM} ${version})`);
}

async function buildPolyfills() {
  const out = join(VENDOR_DIR, 'polyfills.js');
  if (existsSync(out) && !force) return console.log('✔ vendor/polyfills.js (cached)');

  const coreJs = await builder({ modules: ['es', 'web'], targets: BROWSER_TARGET, format: 'bundle', minify: true });
  const dom = readFileSync(join(SERVICE_DIR, 'static', 'dom-polyfills.js'), 'utf8');
  writeFileSync(out, `${coreJs}\n${dom}`);
  console.log(`✔ vendor/polyfills.js (${BROWSER_TARGET}, ${Math.round((coreJs.length + dom.length) / 1024)} KB)`);
}

await fetchEsbuild();
await buildPolyfills();
