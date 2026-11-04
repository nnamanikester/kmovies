/**
 * Small wrapper around the webOS CLI (ares-*) so app id / version / device
 * name are read from one place instead of being hard-coded in npm scripts.
 *
 * Usage: node scripts/tv.mjs <install|launch|inspect|uninstall>
 * Device: defaults to "tv"; override with TV_DEVICE=<name>.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { id, version } = JSON.parse(readFileSync(join(ROOT, 'webos', 'appinfo.json'), 'utf8'));
const device = process.env.TV_DEVICE || 'tv';
const ipk = join(ROOT, 'build', `${id}_${version}_all.ipk`);

const COMMANDS = {
  install: ['ares-install', ['-d', device, ipk]],
  launch: ['ares-launch', ['-d', device, id]],
  inspect: ['ares-inspect', ['-d', device, '--app', id, '--open']],
  uninstall: ['ares-install', ['-d', device, '--remove', id]],
};

const command = COMMANDS[process.argv[2]];
if (!command) {
  console.error(`Usage: node scripts/tv.mjs <${Object.keys(COMMANDS).join('|')}>`);
  process.exit(1);
}

const [bin, args] = command;
console.log(`> ${bin} ${args.join(' ')}`);
try {
  execFileSync(join(ROOT, 'node_modules', '.bin', bin), args, { stdio: 'inherit' });
} catch {
  process.exit(1);
}
