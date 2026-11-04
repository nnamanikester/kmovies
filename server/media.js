/** Pure helpers for recognising video streams and reading HLS playlists. */

export const MEDIA_TYPE = Object.freeze({ HLS: 'hls', DASH: 'dash', FILE: 'file' });

const HLS_TYPE = /mpegurl/i;
const DASH_TYPE = /dash\+xml/i;
const VIDEO_TYPE = /^video\//i;
/** Pieces of a stream, never a whole video. */
const SEGMENT_TYPE = /mp2t|iso\.segment/i;
const SEGMENT_PATH = /\.(ts|m4s|m4v|cmfv|cmfa|aac)$/i;
const FILE_PATH = /\.(mp4|webm|mkv|mov)$/i;

/** @returns {string|null} a MEDIA_TYPE, or null if this response isn't a playable video. */
export function classifyResponse(url, contentType = '') {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (HLS_TYPE.test(contentType) || /\.m3u8$/i.test(pathname)) return MEDIA_TYPE.HLS;
  if (DASH_TYPE.test(contentType) || /\.mpd$/i.test(pathname)) return MEDIA_TYPE.DASH;
  if (SEGMENT_TYPE.test(contentType) || SEGMENT_PATH.test(pathname)) return null;
  if (VIDEO_TYPE.test(contentType) || FILE_PATH.test(pathname)) return MEDIA_TYPE.FILE;
  return null;
}

/** Recognises a playlist by its contents, for sites that hide it behind an unrevealing name. */
export function sniffManifest(text) {
  const start = text.trimStart().slice(0, 2000);
  if (start.startsWith('#EXTM3U')) return MEDIA_TYPE.HLS;
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<MPD\b/.test(start)) return MEDIA_TYPE.DASH;
  return null;
}

/** Total file size from a response's Content-Range or Content-Length, or null. */
export function totalBytes(headers) {
  const range = /\/(\d+)$/.exec(headers['content-range'] || '');
  const size = Number(range ? range[1] : headers['content-length']);
  return size > 0 ? size : null;
}

/**
 * Reads what we need to know from a playlist.
 * @returns {{ isMaster: boolean, streams: string[], variants: string[], duration: number|null, isLive: boolean, hasDrm: boolean }}
 */
export function parseHls(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const streams = [];
  const variants = [];
  let duration = 0;
  let hasDrm = false;

  lines.forEach((line, index) => {
    if (line.startsWith('#EXTINF:')) duration += parseFloat(line.slice(8)) || 0;
    if (line.startsWith('#EXT-X-STREAM-INF') && lines[index + 1]) {
      const stream = new URL(lines[index + 1], baseUrl).href;
      streams.push(stream);
      variants.push(stream);
    }
    // Separate audio and subtitle playlists belong to this video; they aren't videos themselves.
    const related = /^#EXT-X-MEDIA:.*URI="([^"]+)"/.exec(line);
    if (related) variants.push(new URL(related[1], baseUrl).href);
    if (/^#EXT-X-(SESSION-)?KEY:/.test(line)) {
      const isPlainAes = /METHOD=(AES-128|NONE)/.test(line) && !/KEYFORMAT=/.test(line.replace(/KEYFORMAT="identity"/i, ''));
      if (!isPlainAes) hasDrm = true;
    }
  });

  const isMaster = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'));
  const isLive = !isMaster && !lines.includes('#EXT-X-ENDLIST');
  return { isMaster, streams, variants, duration: isMaster || isLive ? null : duration, isLive, hasDrm };
}

/** Sends every URL in a playlist through `toRelayUrl`, so the TV fetches each piece via the relay. */
export function rewriteHls(text, baseUrl, toRelayUrl) {
  const absolute = (uri) => toRelayUrl(new URL(uri, baseUrl).href);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${absolute(uri)}"`);
      return absolute(trimmed);
    })
    .join('\n');
}

/**
 * Reads what we need to know from a DASH manifest.
 * @returns {{ duration: number|null, isLive: boolean, hasDrm: boolean }}
 */
export function parseDash(text) {
  const iso = /mediaPresentationDuration="PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?"/.exec(text);
  return {
    duration: iso ? Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0) : null,
    isLive: /<MPD[^>]*\stype="dynamic"/.test(text),
    hasDrm: /<ContentProtection/i.test(text),
  };
}

/**
 * Points a DASH manifest's segments at the relay. Segment names come from
 * templates, so the relay vouches for a directory rather than for each URL.
 */
export function rewriteDash(text, baseUrl, toRelayDirectory) {
  const directoryOf = (url) => new URL('.', url).href;
  const rewritten = text
    .replace(/<Location>[^<]*<\/Location>\s*/g, '')
    .replace(/<BaseURL([^>]*)>\s*(https?:\/\/[^<\s]+)\s*<\/BaseURL>/g, (_, attrs, url) => `<BaseURL${attrs}>${toRelayDirectory(url)}</BaseURL>`);
  return rewritten.replace(/<MPD\b[^>]*>/, (tag) => `${tag}<BaseURL>${toRelayDirectory(directoryOf(baseUrl))}</BaseURL>`);
}

/** Turns what was typed in the address bar into a URL, or a search if it doesn't look like one. */
export function normalizeAddress(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).href;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+/.test(text)) return null;
  if (!/\s/.test(text) && /[.:]/.test(text)) return new URL(`https://${text}`).href;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
