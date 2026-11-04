/**
 * What the browser remembers between runs, besides Chrome's own profile (which
 * holds cookies, logins, site storage and cache): open tabs, history,
 * bookmarks, and session-only cookies, which Chrome would otherwise discard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './config.js';

const LIBRARY_FILE = path.join(STATE_DIR, 'browser.json');
const SESSION_COOKIES_FILE = path.join(STATE_DIR, 'session-cookies.json');
const MAX_HISTORY = 1000;
const SAVE_DELAY_MS = 1000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export const readSessionCookies = () => readJson(SESSION_COOKIES_FILE, []);
export const writeSessionCookies = (cookies) => writeJson(SESSION_COOKIES_FILE, cookies);

export class Library {
  data = { tabs: [], activeIndex: 0, history: [], bookmarks: [], ...readJson(LIBRARY_FILE, {}) };
  saveTimer = null;

  /** @param {() => void} onChange told when history or bookmarks change */
  constructor(onChange = () => {}) {
    this.onChange = onChange;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    writeJson(LIBRARY_FILE, this.data);
  }

  setTabs(urls, activeIndex) {
    this.data.tabs = urls;
    this.data.activeIndex = activeIndex;
    this.save();
  }

  /** Records a page, once per address, most recent first. */
  addVisit(url, title) {
    if (!/^https?:/.test(url)) return;
    const { history } = this.data;
    const index = history.findIndex((entry) => entry.url === url);
    const known = index === -1 ? null : history.splice(index, 1)[0];
    history.unshift({ url, title: title || known?.title || '', visits: (known?.visits || 0) + 1, lastVisit: Date.now() });
    history.length = Math.min(history.length, MAX_HISTORY);
    this.save();
    this.onChange();
  }

  /** The title usually arrives after the address. */
  setTitle(url, title) {
    const entry = this.data.history.find((item) => item.url === url);
    if (!entry || !title || entry.title === title) return;
    entry.title = title;
    this.save();
    this.onChange();
  }

  toggleBookmark(url, title) {
    if (!/^https?:/.test(url)) return;
    const { bookmarks } = this.data;
    const index = bookmarks.findIndex((item) => item.url === url);
    if (index === -1) bookmarks.unshift({ url, title });
    else bookmarks.splice(index, 1);
    this.save();
    this.onChange();
  }

  snapshot() {
    return { type: 'library', history: this.data.history.slice(0, 300), bookmarks: this.data.bookmarks };
  }
}
