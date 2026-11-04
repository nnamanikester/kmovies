/**
 * npm start: the one command. Builds what changed, finds the TV, installs the
 * app if needed, opens it with this computer's current address, and serves.
 * Keeps watching, so a TV turned on later or a change of network just works.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { PORT, ROOT, STATE_DIR, lanAddress, loadSecrets, saveServerHost } from '../server/config.js';
import { findTv, localNetworks } from './find-tv.mjs';

const { id, version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'webos', 'appinfo.json'), 'utf8'));
const APP_ID = id;
const DEVICE = process.env.TV_DEVICE || 'tv';
const IPK = path.join(ROOT, 'build', `${APP_ID}_${version}_all.ipk`);
const INSTALLED_FILE = path.join(STATE_DIR, `installed-${DEVICE}`);
const WATCH_INTERVAL_MS = 15000;
const execFileAsync = promisify(execFile);
const bin = (tool) => path.join(ROOT, 'node_modules', '.bin', tool);
const { token } = loadSecrets();

function buildAll() {
  console.log('Building…');
  execFileSync('npm', ['run', '-s', 'build:web'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('npm', ['run', '-s', 'package'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Fingerprint of the built app, to skip installing what the TV already has. */
function builtAppHash() {
  const hash = crypto.createHash('sha256');
  const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else hash.update(entry.name).update(fs.readFileSync(file));
  });
  visit(path.join(ROOT, 'dist'));
  return hash.digest('hex');
}

async function installIfNeeded() {
  const hash = builtAppHash();
  const installed = fs.existsSync(INSTALLED_FILE) ? fs.readFileSync(INSTALLED_FILE, 'utf8') : null;
  const { stdout } = await execFileAsync(bin('ares-install'), ['-l', '-d', DEVICE], { timeout: 30000 });
  if (installed === hash && stdout.includes(APP_ID)) return;
  console.log('Installing KMovies on the TV…');
  await execFileAsync(bin('ares-install'), ['-d', DEVICE, IPK], { timeout: 120000 });
  fs.writeFileSync(INSTALLED_FILE, hash);
}

function openOnTv(address) {
  const params = JSON.stringify({ server: `http://${address}:${PORT}`, token });
  return execFileAsync(bin('ares-launch'), ['-d', DEVICE, APP_ID, '-p', params], { timeout: 30000 });
}

const webAppLink = () => `http://${lanAddress()}:${PORT}/?t=${token}`;

let connectedAddress = null;
let lastProblem = null;
let serverStarted = false;
let browserOpened = false;

/** Connects the TV, if it isn't already set up for the address this computer has now. */
async function connectTv() {
  const addresses = localNetworks().map((network) => network.address);
  if (connectedAddress && addresses.includes(connectedAddress)) return;
  try {
    const { host, model, computerAddress } = await findTv(DEVICE);
    saveServerHost(computerAddress);
    if (serverStarted) await installIfNeeded();
    connectedAddress = computerAddress;
    if (serverStarted) {
      await openOnTv(computerAddress);
      console.log(`\nTV: ${model} at ${host}, opened KMovies. This computer is ${computerAddress}.`);
      console.log(`Web app: ${webAppLink()}\n`);
    }
    lastProblem = null;
  } catch (err) {
    connectedAddress = null;
    if (err.message !== lastProblem) console.error(`\nCan't reach the TV yet. Still trying.\n${err.message}\n`);
    lastProblem = err.message;
  }
}

async function main() {
  buildAll();
  console.log('Looking for your TV…');
  await connectTv(); // Before the server starts, so its link uses the address facing the TV.
  const connectedEarly = connectedAddress;
  connectedAddress = null;

  await import('../server/index.js').then((server) => server.ready);
  serverStarted = true;

  if (connectedEarly) await connectTv();

  if (!process.env.KMOVIES_NO_BROWSER && !browserOpened && process.platform === 'darwin') {
    browserOpened = true;
    spawn('open', [webAppLink()], { stdio: 'ignore' }).on('error', () => {});
  }

  const watch = () => connectTv().finally(() => setTimeout(watch, WATCH_INTERVAL_MS));
  setTimeout(watch, WATCH_INTERVAL_MS);
}

main().catch((err) => {
  console.error(`\nCould not start: ${err.message}`);
  process.exit(1);
});
