'use strict';
/**
 * Content and header rewriting so the site works when served from 127.0.0.1.
 */
var crypto = require('crypto');
var transpiler = require('./transpiler');

/**
 * HTML/JS/CSS are transpiled; JSON and streaming manifests only get their URLs
 * localised (so the player's follow-up requests also go through the proxy).
 */
var CONTENT_KIND = { HTML: 'html', JS: 'js', CSS: 'css', JSON: 'json', MANIFEST: 'manifest', OTHER: 'other' };

function classify(contentType, path) {
  var type = (contentType || '').toLowerCase();
  var cleanPath = path.split('?')[0];
  if (type.indexOf('text/html') !== -1) return CONTENT_KIND.HTML;
  if (type.indexOf('json') !== -1) return CONTENT_KIND.JSON;
  if (/mpegurl|dash\+xml/.test(type) || /\.(m3u8|mpd)$/.test(cleanPath)) return CONTENT_KIND.MANIFEST;
  if (type.indexOf('javascript') !== -1 || /\.m?js$/.test(cleanPath)) return CONTENT_KIND.JS;
  if (type.indexOf('text/css') !== -1 || /\.css$/.test(cleanPath)) return CONTENT_KIND.CSS;
  return CONTENT_KIND.OTHER;
}

/**
 * Cookies come from an https site but are now served over plain http on a
 * different host: drop the attributes that would make the browser reject them.
 */
function rewriteSetCookie(cookies) {
  return [].concat(cookies || []).map(function (cookie) {
    return cookie.replace(/;\s*(Domain=[^;]*|Secure|SameSite=[^;]*|Partitioned)/gi, '');
  });
}

var STRIPPED_RESPONSE_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'alt-svc',
  'expect-ct',
];

/** Copies upstream headers, adjusted for the local origin. */
function rewriteResponseHeaders(headers, origins, hopByHop) {
  var out = {};
  Object.keys(headers).forEach(function (name) {
    if (STRIPPED_RESPONSE_HEADERS.indexOf(name) !== -1 || hopByHop.indexOf(name) !== -1) return;
    out[name] = headers[name];
  });
  if (out['set-cookie']) out['set-cookie'] = rewriteSetCookie(out['set-cookie']);
  if (out.location) out.location = origins.toLocal(out.location);
  return out;
}

var INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
var EXECUTABLE_TYPE = /^\s*$|type\s*=\s*["']?(module|text\/javascript|application\/javascript)["']?/i;
var PREFETCH_LINK = /<link\b[^>]*\brel=["']?prefetch["']?[^>]*>/gi;

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/** Patches and transpiles inline <script> blocks (e.g. bootstrapping code) in an HTML document. */
function transpileInlineScripts(html, policy) {
  var jobs = [];
  html.replace(INLINE_SCRIPT, function (match, attrs, code) {
    var hasNoSrc = !/\bsrc\s*=/.test(attrs);
    var isExecutable = !/\btype\s*=/.test(attrs) || EXECUTABLE_TYPE.test(attrs);
    if (hasNoSrc && isExecutable && code.trim()) {
      var patched = policy.patchScript(code);
      jobs.push(
        transpiler
          .transpile(patched, 'js', 'inline:' + policy.version + ':' + sha1(patched))
          .catch(function () { return patched; })
          .then(function (out) {
            return { from: match, to: '<script' + attrs + '>' + out.toString() + '</script>' };
          })
      );
    }
    return match;
  });

  return Promise.all(jobs).then(function (replacements) {
    return replacements.reduce(function (acc, r) {
      return acc.split(r.from).join(r.to);
    }, html);
  });
}

/**
 * @param {string} html
 * @param {object} origins  origin map from origins.js
 * @param {object} policy   site policy from policy.js
 * @param {string} headInjection markup inserted at the very start of <head>
 */
function rewriteHtml(html, origins, policy, headInjection) {
  var localised = origins
    .toLocal(html)
    // Prefetches would make the TV transpile dozens of files it may never need.
    .replace(PREFETCH_LINK, '')
    .replace(/<head\b[^>]*>/i, function (head) { return head + headInjection; });
  return transpileInlineScripts(localised, policy);
}

module.exports = {
  CONTENT_KIND: CONTENT_KIND,
  classify: classify,
  rewriteHtml: rewriteHtml,
  rewriteResponseHeaders: rewriteResponseHeaders,
};
