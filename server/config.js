/**
 * Settings shared by the server and the TV app build. The access token and
 * relay secret are generated once and kept in .kmovies/ (git-ignored).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = process.env.KMOVIES_STATE_DIR || path.join(ROOT, '.kmovies');
export const WEB_DIR = path.join(ROOT, 'dist-web');
export const CHROME_PROFILE_DIR = path.join(STATE_DIR, 'chrome-profile');
export const PORT = Number(process.env.KMOVIES_PORT) || 8770;

/** Below these a stream is listed but not cast automatically (ads, previews). */
export const AUTO_CAST_MIN_SECONDS = 120;
export const AUTO_CAST_MIN_BYTES = 30 * 1024 * 1024;
/** Auto-cast only follows something you did, so a site's background previews don't take over the TV. */
export const AUTO_CAST_INPUT_WINDOW_MS = 30000;

/** Loads the token and secret, creating them on first run. */
export function loadSecrets() {
  const file = path.join(STATE_DIR, 'secrets.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const secrets = {
      token: crypto.randomBytes(16).toString('hex'),
      relaySecret: crypto.randomBytes(32).toString('hex'),
    };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    return secrets;
  }
}

const SERVER_HOST_FILE = path.join(STATE_DIR, 'server-host');

/** Remembers the address facing the TV, so the server uses the one the TV was given. */
export function saveServerHost(address) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(SERVER_HOST_FILE, address);
}

function savedServerHost() {
  try {
    return fs.readFileSync(SERVER_HOST_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

/** This computer's address on the home network. Override with KMOVIES_HOST. */
export function lanAddress() {
  if (process.env.KMOVIES_HOST) return process.env.KMOVIES_HOST;
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
  const saved = savedServerHost();
  if (saved && addresses.includes(saved)) return saved;
  return addresses.find((a) => /^(192\.168|10)\./.test(a)) || addresses[0] || '127.0.0.1';
}

/** Follows this computer's current address, which can change while running. */
export function serverOrigin() {
  return `http://${lanAddress()}:${PORT}`;
}
