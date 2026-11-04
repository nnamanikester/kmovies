'use strict';
/**
 * The compatibility proxy: serves the target site from 127.0.0.1, forwarding
 * every request upstream and transpiling JS/CSS/inline scripts on the way back.
 */
var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var config = require('./config');
var log = require('./log');
var cache = require('./cache');
var upstream = require('./upstream');
var transpiler = require('./transpiler');
var rewrite = require('./rewrite');
var originsModule = require('./origins');
var createOriginMap = originsModule.createOriginMap;
var ORIGIN_TYPE = originsModule.ORIGIN_TYPE;
var createPolicy = require('./policy').createPolicy;

var KIND = rewrite.CONTENT_KIND;
var POLYFILLS_PATH = config.INTERNAL_PREFIX + '/polyfills.js';
var STATUS_PATH = config.INTERNAL_PREFIX + '/status';
/** Request bodies we rewrite (local -> real origin); everything else streams through untouched. */
var REWRITABLE_BODY = /json|x-www-form-urlencoded|text\/plain/i;
var MAX_REWRITE_BODY_BYTES = 1024 * 1024;
var state = { server: null, origins: null, policy: null, startedAt: null };

/* ---------- request helpers ---------- */

function buildUpstreamHeaders(reqHeaders, route, origins) {
  var headers = {};
  Object.keys(reqHeaders).forEach(function (name) {
    if (upstream.HOP_BY_HOP.indexOf(name) === -1) headers[name] = reqHeaders[name];
  });
  headers.host = route.origin.replace(/^https?:\/\//, '');
  headers['accept-encoding'] = 'gzip'; // the only encoding we can always decode on Node 8
  if (headers.origin) headers.origin = origins.target;
  if (headers.referer) headers.referer = origins.toUpstream(headers.referer);
  // Media CDNs only serve requests coming from the site's pages.
  else if (route.type === ORIGIN_TYPE.MEDIA) headers.referer = origins.target + '/';
  // In a real browser the site's cookies never reach these other hosts (separate
  // cookie jars); here they share 127.0.0.1's jar, so drop them explicitly.
  if (route.type !== ORIGIN_TYPE.TARGET) delete headers.cookie;
  return headers;
}

/** Buffers small text bodies so references to the local origin can be translated. */
function readRequestBody(req, origins) {
  var hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  if (!hasBody) return Promise.resolve(null);
  var length = Number(req.headers['content-length'] || 0);
  if (!REWRITABLE_BODY.test(req.headers['content-type'] || '') || length > MAX_REWRITE_BODY_BYTES) {
    return Promise.resolve({ stream: req });
  }
  return upstream.readBody(req).then(function (buf) {
    return { buffer: Buffer.from(origins.toUpstream(buf.toString('utf8'))) };
  });
}

function send(res, status, headers, body) {
  headers['content-length'] = Buffer.byteLength(body);
  res.writeHead(status, headers);
  res.end(body);
}

function sendError(res, err) {
  log.error(err.stack || err.message);
  if (!res.headersSent) {
    send(res, 502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'KMovies proxy error: ' + err.message);
  }
  else res.end();
}

/* ---------- internal endpoints ---------- */

function handleInternal(req, res) {
  if (req.url.split('?')[0] === POLYFILLS_PATH) {
    var file = path.join(config.VENDOR_DIR, 'polyfills.js');
    var body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('/* polyfills missing */');
    var etag = assetEtag(body.toString('utf8'));
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag: etag, 'cache-control': 'no-cache' });
      return res.end();
    }
    return send(res, 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache', etag: etag }, body);
  }
  if (req.url.split('?')[0] === STATUS_PATH) {
    var status = { target: state.origins.target, startedAt: state.startedAt, cacheDir: cache.dir(), log: log.recent() };
    return send(res, 200, { 'content-type': 'application/json' }, JSON.stringify(status, null, 2));
  }
  send(res, 404, { 'content-type': 'text/plain' }, 'Not found');
}

/* ---------- content transformation ---------- */

/** Transpiled JS/CSS for immutable CDN assets, straight from disk cache. */
function cachedAssetKey(route) {
  return route.type === ORIGIN_TYPE.ASSET && /\.(m?js|css)$/.test(route.path.split('?')[0]) ? state.policy.version + ':' + route.origin + route.path : null;
}

/**
 * Transformed assets keep their CDN URLs, so the browser must not reuse a copy
 * from before a patch/transpile change: revalidate every time via an ETag that
 * changes with the policy version (cheap 304s, served without going upstream).
 */
function assetEtag(cacheKey) {
  return '"' + crypto.createHash('sha1').update(cacheKey).digest('hex').slice(0, 16) + '"';
}

function transform(kind, body, cacheKey) {
  var origins = state.origins;
  var policy = state.policy;
  if (kind === KIND.HTML) {
    return rewrite.rewriteHtml(body.toString('utf8'), origins, policy, policy.headInjection(POLYFILLS_PATH));
  }
  if (kind === KIND.JSON || kind === KIND.MANIFEST) return Promise.resolve(origins.toLocal(body.toString('utf8')));
  var source = kind === KIND.JS ? policy.patchScript(body.toString('utf8')) : body;
  return transpiler.transpile(source, kind, cacheKey).then(function (out) {
    return origins.toLocal(out.toString('utf8'));
  });
}

/* ---------- main handler ---------- */

function handle(req, res) {
  // Aborted requests (page navigations, seeking video) are normal: never let them throw.
  req.on('error', function (err) { log.debug('client request error:', err.message); });
  res.on('error', function (err) { log.debug('client response error:', err.message); });

  if (req.url.indexOf(config.INTERNAL_PREFIX + '/') === 0) return handleInternal(req, res);

  var origins = state.origins;
  var route = origins.resolve(req.url);

  if (route.type === ORIGIN_TYPE.TARGET && state.policy.isBlocked(route.path)) {
    return send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, state.policy.blockedPage);
  }
  var assetKey = cachedAssetKey(route);
  if (assetKey && req.headers['if-none-match'] === assetEtag(assetKey)) {
    res.writeHead(304, { etag: assetEtag(assetKey), 'cache-control': 'no-cache' });
    return res.end();
  }

  // e.g. ?host=127.0.0.1 -> ?host=themoviebox.xyz
  var upstreamUrl = route.origin + (route.type === ORIGIN_TYPE.ASSET ? route.path : origins.toUpstream(route.path));
  var headers = buildUpstreamHeaders(req.headers, route, origins);

  readRequestBody(req, origins)
    .then(function (body) {
      if (body && body.buffer) headers['content-length'] = body.buffer.length;
      return upstream.request(req.method, upstreamUrl, headers, body);
    })
    .then(function (upRes) {
      var outHeaders = rewrite.rewriteResponseHeaders(upRes.headers, origins, upstream.HOP_BY_HOP);
      // Likewise, cookies from other hosts must not land in the site's jar
      // (a real browser blocks these third-party, SameSite cookies).
      if (route.type !== ORIGIN_TYPE.TARGET) delete outHeaders['set-cookie'];
      var kind = upRes.statusCode === 200 ? rewrite.classify(upRes.headers['content-type'], route.path) : KIND.OTHER;

      if (kind === KIND.OTHER || req.method === 'HEAD') {
        res.writeHead(upRes.statusCode, outHeaders);
        upRes.on('error', function (err) { sendError(res, err); });
        return upRes.pipe(res);
      }

      return upstream
        .readBody(upRes)
        .then(function (body) {
          return transform(kind, body, assetKey);
        })
        .then(function (output) {
          if (kind === KIND.HTML) outHeaders['content-security-policy'] = state.policy.contentSecurityPolicy;
          delete outHeaders['content-encoding'];
          delete outHeaders.etag; // content changed
          delete outHeaders['last-modified'];
          delete outHeaders.expires;
          outHeaders['cache-control'] = 'no-cache';
          if (assetKey) outHeaders.etag = assetEtag(assetKey);
          send(res, 200, outHeaders, output);
        });
    })
    .catch(function (err) {
      sendError(res, err);
    });
}

/* ---------- lifecycle ---------- */

function listen(server, port, attemptsLeft) {
  return new Promise(function (resolve, reject) {
    server.once('error', function (err) {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 1) resolve(listen(server, port + 1, attemptsLeft - 1));
      else reject(err);
    });
    server.listen(port, config.HOST, function () {
      resolve(port);
    });
  });
}

/**
 * Starts the proxy (idempotent: a running proxy is re-targeted, not restarted).
 * @param {{ targetUrl: string, assetOrigins?: string[], apiOrigins?: string[], blockedPaths?: string[],
 *           hiddenSelectors?: string[], scriptPatches?: {find: string, replace: string}[] }} options
 * @returns {Promise<{ origin: string }>} local origin to load in the browser
 */
function start(options) {
  if (!options || !options.targetUrl) return Promise.reject(new Error('targetUrl is required'));

  state.policy = createPolicy(options);

  if (state.server) {
    state.origins = createOriginMap(options, state.origins.local, state.policy.version);
    return Promise.resolve({ origin: state.origins.local });
  }

  cache.init();
  var server = http.createServer(handle);
  return listen(server, config.BASE_PORT, config.PORT_ATTEMPTS).then(function (port) {
    var localOrigin = 'http://' + config.HOST + ':' + port;
    state.server = server;
    state.origins = createOriginMap(options, localOrigin, state.policy.version);
    state.startedAt = new Date().toISOString();
    log.info('proxy listening on', localOrigin, '->', state.origins.target);
    return { origin: localOrigin };
  });
}

module.exports = { start: start };
