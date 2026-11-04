/**
 * Where you stopped in every video, kept in a small file on this computer. A
 * video has no single lasting name: stream links can change, and a page can
 * change episode without changing address. So each is saved under every name
 * known for it, and a match must also be the same length.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './config.js';

const PROGRESS_FILE = path.join(STATE_DIR, 'watch-progress.json');
const MAX_ENTRIES = 2000;
const WRITE_DELAY_MS = 500;
/** Shorter videos are previews and clips: not worth returning to. */
const MIN_DURATION_SECONDS = 120;
/** Nothing's lost by starting over from this early. */
const MIN_POSITION_SECONDS = 10;
/** Past this point it counts as watched, so next time it starts from the beginning. */
const WATCHED_FRACTION = 0.95;
const WATCHED_REMAINING_SECONDS = 30;
const SAME_LENGTH_TOLERANCE_SECONDS = 10;

export const isWatched = (position, duration) => position / duration >= WATCHED_FRACTION || duration - position <= WATCHED_REMAINING_SECONDS;

function withoutEmptyParts(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  [...parsed.searchParams.entries()].forEach(([name, value]) => {
    if (!value) parsed.searchParams.delete(name);
  });
  parsed.searchParams.sort();
  return parsed.href;
}

/**
 * Every name for a video, most trustworthy first.
 * @param {{ sourceUrl: string, pageUrl?: string, title?: string, episode?: { season?: number, episode?: number }|null }} video
 */
export function videoKeys({ sourceUrl, pageUrl, title, episode }) {
  const source = new URL(sourceUrl);
  const keys = [`stream:${source.host}${source.pathname}`];
  const part = episode?.episode ? `#S${episode.season ?? ''}E${episode.episode}` : '';
  if (/^https?:/.test(pageUrl || '')) keys.push(`page:${withoutEmptyParts(pageUrl)}${part}`);
  // A page's title is shared by all its episodes, so alone it would name none of them.
  if (part && title) keys.push(`title:${new URL(pageUrl || sourceUrl).host}|${title}${part}`);
  return keys;
}

const isSharedName = (key) => key.startsWith('page:') && !key.includes('#S');

export class WatchProgress {
  entries = {};
  writeTimer = null;

  constructor(file = PROGRESS_FILE) {
    this.file = file;
    try {
      this.entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.entries = {};
    }
  }

  /** @returns {{ position: number, duration: number, updatedAt: number }|null} the best saved point. */
  find(keys, duration) {
    // The video's own stream is certain. Other names are for when that link has changed.
    const own = this.entries[keys[0]];
    if (own && (!duration || Math.abs(own.duration - duration) <= SAME_LENGTH_TOLERANCE_SECONDS)) return own;
    const matches = keys
      .map((key) => this.entries[key])
      .filter(Boolean)
      // The same page can hold another video: an unknown length is only trusted for its exact stream.
      .filter((entry) => {
        const isStream = entry === this.entries[keys[0]];
        if (duration) return Math.abs(entry.duration - duration) <= SAME_LENGTH_TOLERANCE_SECONDS;
        return isStream;
      });
    if (matches.length === 0) return null;
    return matches.reduce((latest, entry) => (entry.updatedAt > latest.updatedAt ? entry : latest));
  }

  save(keys, position, duration, title) {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration < MIN_DURATION_SECONDS) return;
    if (isWatched(position, duration)) {
      this.clear(keys);
      return;
    }
    if (position < MIN_POSITION_SECONDS) return;
    const linked = this.keysLinkedTo(keys);
    const id = linked.length ? this.entries[linked[0]].id : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry = { id, position, duration, title, updatedAt: Date.now() };
    [...keys, ...linked].forEach((key) => {
      this.entries[key] = entry;
    });
    this.trim();
    this.writeSoon();
  }

  /**
   * Every name saved for the same video as these. Not all names are known at
   * once, as the episode comes moments after a video starts, and a name left
   * behind would bring back an old point.
   */
  keysLinkedTo(keys) {
    // A page address alone can cover several videos, so it never ties any together.
    const ids = new Set(keys.filter((key) => !isSharedName(key)).map((key) => this.entries[key]?.id).filter(Boolean));
    return Object.keys(this.entries).filter((key) => ids.has(this.entries[key].id));
  }

  clear(keys) {
    const linked = this.keysLinkedTo(keys);
    linked.forEach((key) => delete this.entries[key]);
    if (linked.length) this.writeSoon();
  }

  trim() {
    const keys = Object.keys(this.entries);
    if (keys.length <= MAX_ENTRIES) return;
    keys.sort((a, b) => this.entries[a].updatedAt - this.entries[b].updatedAt)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((key) => delete this.entries[key]);
  }

  writeSoon() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => this.writeNow(), WRITE_DELAY_MS);
  }

  writeNow() {
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.entries), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}
