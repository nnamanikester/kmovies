/** Reading subtitle files, finding them in site data, and the sources beyond the page. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE_DIR } from './config.js';

export const SUBTITLES_DIR = process.env.KMOVIES_SUBTITLES_DIR || path.join(ROOT, 'subtitles');
const SUBTITLE_FILE = /\.(srt|vtt|ass|ssa)$/i;
const SUBTITLE_TYPE = /text\/vtt|subrip|x-ssa|x-ass/i;
const ONLINE_API = process.env.KMOVIES_SUBTITLES_API || 'https://api.opensubtitles.com/api/v1';
const ONLINE_USER_AGENT = 'KMovies v2.0.0';
const MAX_ONLINE_RESULTS = 20;

export function isSubtitleResponse(url, contentType = '') {
  try {
    return SUBTITLE_TYPE.test(contentType) || SUBTITLE_FILE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function parseTimestamp(text) {
  const match = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,:](\d{1,3})/.exec(text);
  if (!match) return null;
  const fraction = Number(match[4]) / 10 ** match[4].length;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
}

const cleanText = (text) => text
  .replace(/\\[Nn]/g, '\n')
  .replace(/\{[^}]*\}/g, '')
  .replace(/<[^>]*>/g, '')
  .trim();

function parseAss(text) {
  const cues = [];
  text.split('\n').forEach((line) => {
    if (!line.startsWith('Dialogue:')) return;
    const fields = line.slice(9).split(',');
    const start = parseTimestamp(fields[1] || '');
    const end = parseTimestamp(fields[2] || '');
    const body = cleanText(fields.slice(9).join(','));
    if (start !== null && end !== null && body) cues.push({ start, end, text: body });
  });
  return cues;
}

/** @returns {{ start: number, end: number, text: string }[]} cues in time order, from SRT, WebVTT or ASS. */
export function parseSubtitles(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = /^\[Script Info\]/m.test(text) ? parseAss(text) : [];
  if (cues.length === 0) {
    text.split(/\n{2,}/).forEach((block) => {
      const lines = block.split('\n');
      const timing = lines.findIndex((line) => line.includes('-->'));
      if (timing === -1) return;
      const [from, to] = lines[timing].split('-->');
      const start = parseTimestamp(from);
      const end = parseTimestamp(to);
      const body = cleanText(lines.slice(timing + 1).join('\n'));
      if (start !== null && end !== null && body) cues.push({ start, end, text: body });
    });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const LANGUAGE_FIELDS = ['srclang', 'srcLang', 'language', 'languageCode', 'lang', 'lan', 'locale', 'code'];
const LABEL_FIELDS = ['label', 'languageName', 'lanName', 'displayName', 'name', 'title'];
const firstField = (object, fields) => {
  const name = fields.find((field) => typeof object[field] === 'string' && object[field]);
  return name ? object[name] : null;
};
const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);

/**
 * Finds subtitle links in a site's JSON, whatever its player calls things: a
 * link to a subtitle file, or any link on an object marked as captions.
 * @returns {{ url: string, language: string|null, label: string|null }[]}
 */
export function findSubtitleLinks(body) {
  if (!/\.(srt|vtt|ass|ssa)\b|captions|subtitles/i.test(body)) return [];
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const strings = Object.values(value).filter(isHttpUrl);
      const markedAsCaptions = /^(captions|subtitles?)$/i.test(value.kind || value.type || '');
      const url = strings.find((v) => isSubtitleResponse(v)) || (markedAsCaptions ? strings[0] : null);
      if (url) found.push({ url, language: firstField(value, LANGUAGE_FIELDS), label: firstField(value, LABEL_FIELDS) });
      Object.values(value).forEach(visit);
    }
  };
  visit(data);
  return found;
}

/**
 * When another full-length video starts on a page, subtitles from before it
 * belong to the old video, as a page can change video without changing address.
 * The new video's own arrive just around when it starts, so those are kept.
 */
export function dropEarlierSubtitles(tracks, now, keepWithinMs) {
  return tracks.filter((track) => now - track.foundAt <= keepWithinMs);
}

/**
 * A site sends a subtitle list for whichever video it's loading now, so a newer
 * list replaces older lists' tracks in the same languages. Otherwise the first
 * "English" ever seen on a page would be offered for every later episode.
 */
export function replaceOlderLists(tracks, batch, languages) {
  const named = (track) => (track.language || track.label || '').toLowerCase();
  return tracks.filter((track) => !track.batch || track.batch === batch || !languages.has(named(track)));
}

/** Subtitle links written into a page: <track> tags, and player settings in its HTML. */
export const FIND_IN_PAGE = `(() => {
  const found = [...document.querySelectorAll('track[src]:not([kind="metadata"]):not([kind="chapters"]):not([kind="descriptions"])')].map((t) => ({ url: t.src, language: t.srclang || null, label: t.label || null }));
  const html = document.documentElement.innerHTML;
  const links = html.match(/https?:(?:\\\\?\\/){2}[^"'\\s<>]+?\\.(?:vtt|srt|ass|ssa)(?:\\?[^"'\\s<>]*)?(?=["'\\s<>\\\\])/gi) || [];
  links.forEach((link) => found.push({ url: link.replace(/\\\\\\//g, '/').replace(/&amp;/g, '&'), language: null, label: null }));
  return found;
})()`;

/* ---------- the subtitles folder on this computer ---------- */

export function listFolder() {
  try {
    return fs.readdirSync(SUBTITLES_DIR).filter((name) => SUBTITLE_FILE.test(name)).sort();
  } catch {
    return [];
  }
}

/** Only names the folder actually lists can be read, so a request can't reach other files. */
export function readFolderFile(name) {
  if (!listFolder().includes(name)) throw new Error('That file is no longer in the subtitles folder');
  return fs.readFileSync(path.join(SUBTITLES_DIR, name), 'utf8');
}

/* ---------- online search (OpenSubtitles) ---------- */

function onlineKey() {
  if (process.env.OPENSUBTITLES_API_KEY) return process.env.OPENSUBTITLES_API_KEY;
  try {
    return fs.readFileSync(path.join(STATE_DIR, 'opensubtitles-key'), 'utf8').trim();
  } catch {
    return null;
  }
}

export const hasOnlineSearch = () => Boolean(onlineKey());

const onlineHeaders = () => ({ 'Api-Key': onlineKey(), 'User-Agent': ONLINE_USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json' });

async function onlineJson(response) {
  if (response.status === 406 || response.status === 429) throw new Error('Online subtitle limit reached for today');
  if (response.status === 401 || response.status === 403) throw new Error('The OpenSubtitles API key was refused');
  if (!response.ok) throw new Error(`OpenSubtitles answered ${response.status}`);
  return response.json();
}

/** @returns {Promise<{ fileId: number, label: string, language: string }[]>} */
export async function searchOnline(query, language) {
  const params = new URLSearchParams({ query, languages: language });
  const response = await fetch(`${ONLINE_API}/subtitles?${params}`, { headers: onlineHeaders(), signal: AbortSignal.timeout(15000) });
  const { data = [] } = await onlineJson(response);
  return data.slice(0, MAX_ONLINE_RESULTS).flatMap(({ attributes: a }) => {
    const file = a.files && a.files[0];
    if (!file) return [];
    return [{ fileId: file.file_id, language: a.language, label: a.release || file.file_name || 'Subtitle' }];
  });
}

export async function downloadOnline(fileId) {
  const response = await fetch(`${ONLINE_API}/download`, {
    method: 'POST',
    headers: onlineHeaders(),
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15000),
  });
  const { link } = await onlineJson(response);
  const file = await fetch(link, { signal: AbortSignal.timeout(30000) });
  if (!file.ok) throw new Error(`Download failed (${file.status})`);
  return file.text();
}
