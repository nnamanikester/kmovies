/**
 * The TV's <video> can't send the Referer and cookies a video CDN expects, so
 * it fetches through here and the relay adds them. URLs are signed: only
 * streams the server handed to the TV can be fetched, so this isn't an open
 * proxy on the home network.
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream';
import { MEDIA_TYPE, classifyResponse, rewriteDash, rewriteHls, sniffManifest } from './media.js';

/** Never replayed: they describe the original connection or that one request. */
const DROPPED_REQUEST_HEADERS = /^(:|host$|connection$|content-length$|accept-encoding$|range$|if-|transfer-encoding$|upgrade$|te$|trailer$|keep-alive$|proxy-)/i;
/** Only ever sent to the host they were captured for. */
const CREDENTIAL_HEADERS = /^(cookie|authorization)$/i;
const PASSED_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges',
};
const MAX_SOURCES = 20;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_SNIFF_BYTES = 256 * 1024;
const BINARY_TYPE = /^(video|audio|image|font)\//i;

/** @param {{ secret: string, origin: () => string }} options */
export function createRelay({ secret, origin }) {
  /** sourceId -> { headers, host }, oldest first. */
  const sources = new Map();

  const sign = (sourceId, url) => crypto.createHmac('sha256', secret).update(`${sourceId}|${url}`).digest('base64url');

  function createSource(url, capturedHeaders) {
    const headers = {};
    Object.entries(capturedHeaders).forEach(([name, value]) => {
      if (!DROPPED_REQUEST_HEADERS.test(name)) headers[name.toLowerCase()] = value;
    });
    return { headers, host: new URL(url).host };
  }

  function register(url, capturedHeaders) {
    const sourceId = crypto.randomBytes(8).toString('hex');
    sources.set(sourceId, createSource(url, capturedHeaders));
    if (sources.size > MAX_SOURCES) sources.delete(sources.keys().next().value);
    return sourceId;
  }

  function urlFor(sourceId, url) {
    const encoded = Buffer.from(url).toString('base64url');
    return `${origin()}/relay/${sourceId}?u=${encoded}&s=${sign(sourceId, url)}`;
  }

  /** A relay address for everything under `directory`, keeping its query string for each file. */
  function urlForDirectory(sourceId, directory, query = '') {
    const scope = `dir:${directory}${query}`;
    const encoded = Buffer.from(`${directory}${query}`).toString('base64url');
    return `${origin()}/relay-dir/${sourceId}/${sign(sourceId, scope)}/${encoded}/`;
  }

  function fetchUpstream(source, url, extraHeaders = {}, init = {}) {
    const headers = { ...source.headers, ...extraHeaders, 'accept-encoding': 'identity' };
    if (new URL(url).host !== source.host) {
      Object.keys(headers).forEach((name) => {
        if (CREDENTIAL_HEADERS.test(name)) delete headers[name];
      });
    }
    return fetch(url, { headers, redirect: 'follow', ...init });
  }

  /** Fetches a playlist during detection, using the headers the browser used. */
  async function readText(url, capturedHeaders) {
    const response = await fetchUpstream(createSource(url, capturedHeaders), url, {}, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { text: await response.text(), finalUrl: response.url };
  }

  function signatureMatches(sourceId, scope, given) {
    const signature = Buffer.from(given || '');
    const expected = Buffer.from(sign(sourceId, scope));
    return signature.length === expected.length && crypto.timingSafeEqual(signature, expected);
  }

  /** @returns {{ sourceId: string, url: string }|null} what a signed relay address allows, if valid. */
  function authorize(requestUrl) {
    const [, kind, sourceId, signature, encoded, ...rest] = requestUrl.pathname.split('/');
    if (kind === 'relay') {
      const url = Buffer.from(requestUrl.searchParams.get('u') || '', 'base64url').toString();
      return signatureMatches(sourceId, url, requestUrl.searchParams.get('s')) ? { sourceId, url } : null;
    }
    const scope = Buffer.from(encoded || '', 'base64url').toString();
    if (!signatureMatches(sourceId, `dir:${scope}`, signature)) return null;
    const base = new URL(scope);
    const directory = base.origin + base.pathname;
    const target = new URL(rest.join('/'), directory);
    // Segments can't climb out of the directory that was signed (including via encoded dots).
    if (!target.href.startsWith(directory)) return null;
    target.search = requestUrl.search || base.search;
    return { sourceId, url: target.href };
  }

  async function handle(req, res, requestUrl) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, CORS);
      return res.end();
    }

    const allowed = authorize(requestUrl);
    const source = allowed && sources.get(allowed.sourceId);
    if (!source) {
      res.writeHead(403, CORS);
      return res.end('Unknown stream');
    }
    const { sourceId, url } = allowed;

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    try {
      const extra = req.headers.range ? { range: req.headers.range } : {};
      const upstream = await fetchUpstream(source, url, extra, { method: req.method, signal: abort.signal });
      const headers = { ...CORS };
      PASSED_RESPONSE_HEADERS.forEach((name) => {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      });
      if (upstream.headers.get('content-encoding')) delete headers['content-length'];

      const declaredSize = Number(upstream.headers.get('content-length') || 0);
      const contentType = upstream.headers.get('content-type') || '';
      const canBePlaylist = upstream.ok && req.method === 'GET' && declaredSize <= MAX_MANIFEST_BYTES;
      const named = canBePlaylist ? classifyResponse(upstream.url, contentType) : null;
      const isManifestByName = named === MEDIA_TYPE.HLS || named === MEDIA_TYPE.DASH;
      // A playlist under an unrevealing name is only known by reading it.
      const worthReading = canBePlaylist && !isManifestByName && !named && !BINARY_TYPE.test(contentType)
        && declaredSize > 0 && declaredSize <= MAX_SNIFF_BYTES;
      let bodyBytes = null;
      if (isManifestByName || worthReading) bodyBytes = Buffer.from(await upstream.arrayBuffer());
      const text = bodyBytes ? bodyBytes.toString('utf8') : null;
      const type = isManifestByName ? named : text !== null ? sniffManifest(text) : null;
      if (type === MEDIA_TYPE.HLS || type === MEDIA_TYPE.DASH) {
        const query = new URL(upstream.url).search;
        const body = type === MEDIA_TYPE.HLS
          ? rewriteHls(text, upstream.url, (next) => urlFor(sourceId, next))
          : rewriteDash(text, upstream.url, (directory) => urlForDirectory(sourceId, directory, query));
        delete headers['content-range'];
        delete headers.etag;
        headers['content-length'] = Buffer.byteLength(body);
        headers['cache-control'] = 'no-store';
        res.writeHead(200, headers);
        return res.end(body);
      }

      res.writeHead(upstream.status, headers);
      if (bodyBytes) return res.end(bodyBytes);
      if (!upstream.body || req.method === 'HEAD') return res.end();
      pipeline(Readable.fromWeb(upstream.body), res, () => {});
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('[relay]', err.message);
      if (!res.headersSent) res.writeHead(502, CORS);
      res.end();
    }
  }

  return { register, urlFor, readText, handle };
}
