'use strict';
/**
 * Maps between real origins and their local, proxied equivalents:
 *   target site      https://themoviebox.xyz/...         <->  http://127.0.0.1:PORT/...
 *   proxied origin n https://h5-static.aoneroom.com/...  <->  http://127.0.0.1:PORT/__o/<version>.n/...
 *
 * <version> changes whenever the content transformation does (patches, target),
 * so the browser can never reuse a stale cached copy of a transformed file.
 *
 *   media host       https://<any>.cdn.example/...       <->  http://127.0.0.1:PORT/__h/<host>/...
 *
 * Proxied origins come in three kinds:
 *   asset - static CDN files: cookie-less, JS/CSS transpiled and cached
 *   api   - backend APIs the page calls directly: proxied so they're same-origin
 *           (no CORS rejection of 127.0.0.1) and see the site's Origin/Referer
 *   media - video/subtitle CDNs, matched by domain suffix since stream hosts vary;
 *           proxied so requests carry the site's Referer, as from the real site
 */
var URL = require('url').URL;
var config = require('./config');

var ORIGIN_TYPE = { TARGET: 'target', ASSET: 'asset', API: 'api', MEDIA: 'media' };

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching `text` plainly and in JSON-escaped form ("https:\/\/host"). */
function literalPattern(text) {
  return new RegExp(escapeRegExp(text).replace(/\\\//g, '(?:\\/|\\\\/)'), 'g');
}

function replaceAll(text, pairs) {
  return pairs.reduce(function (acc, p) {
    return acc.replace(p.pattern, p.to);
  }, text);
}

/**
 * @param {{ targetUrl: string, assetOrigins?: string[], apiOrigins?: string[] }} site
 * @param {string} localOrigin e.g. http://127.0.0.1:8765
 * @param {string} version     cache-busting version for proxied URLs
 */
function createOriginMap(site, localOrigin, version) {
  var target = new URL(site.targetUrl);
  var local = new URL(localOrigin);
  var prefix = config.ORIGIN_PREFIX + '/';
  var hostPrefix = config.HOST_PREFIX + '/';
  var mediaDomains = site.mediaDomains || [];

  function isMediaHost(hostname) {
    return mediaDomains.some(function (d) {
      return hostname === d || hostname.slice(-(d.length + 1)) === '.' + d;
    });
  }

  var proxied = []
    .concat((site.assetOrigins || []).map(function (o) { return { remote: new URL(o).origin, type: ORIGIN_TYPE.ASSET }; }))
    .concat((site.apiOrigins || []).map(function (o) { return { remote: new URL(o).origin, type: ORIGIN_TYPE.API }; }));
  proxied.forEach(function (p, i) {
    p.local = localOrigin + prefix + version + '.' + i;
  });

  // remote -> local, for content sent to the browser
  var toLocalPairs = proxied
    .map(function (p) { return { pattern: literalPattern(p.remote), to: p.local }; })
    .concat([{ pattern: literalPattern(target.origin), to: localOrigin }])
    .concat(
      mediaDomains.map(function (d) {
        // https://sub.domain.com  (plain or JSON-escaped)  ->  local/__h/sub.domain.com
        var re = new RegExp('https:(?:\\/\\/|\\\\/\\\\/)((?:[a-z0-9-]+\\.)*' + escapeRegExp(d) + ')(?![a-z0-9.-])', 'gi');
        return { pattern: re, to: localOrigin + hostPrefix + '$1' };
      })
    );

  // local -> remote, for anything the page sends upstream (URLs, bodies, headers).
  // Longest/most specific first so origins win over bare hosts.
  var toUpstreamPairs = []
    .concat([{ pattern: new RegExp(escapeRegExp(localOrigin + hostPrefix) + '([a-z0-9.-]+)', 'gi'), to: 'https://$1' }])
    .concat(proxied.map(function (p) { return { pattern: literalPattern(p.local), to: p.remote }; }))
    .concat([
      { pattern: literalPattern(localOrigin), to: target.origin },
      { pattern: new RegExp(escapeRegExp(encodeURIComponent(localOrigin)), 'gi'), to: encodeURIComponent(target.origin) },
      { pattern: literalPattern(local.host), to: target.host },
      { pattern: literalPattern(local.hostname), to: target.hostname },
    ]);

  return {
    target: target.origin,
    local: localOrigin,

    /** Which upstream origin serves a local request path. */
    resolve: function (requestPath) {
      if (requestPath.indexOf(hostPrefix) === 0) {
        var hostRest = requestPath.slice(hostPrefix.length);
        var hostSlash = hostRest.indexOf('/');
        var host = hostSlash === -1 ? hostRest : hostRest.slice(0, hostSlash);
        if (isMediaHost(host)) return { origin: 'https://' + host, path: hostSlash === -1 ? '/' : hostRest.slice(hostSlash), type: ORIGIN_TYPE.MEDIA };
      }
      if (requestPath.indexOf(prefix) === 0) {
        var rest = requestPath.slice(prefix.length);
        var slash = rest.indexOf('/');
        var segment = slash === -1 ? rest : rest.slice(0, slash);
        var entry = proxied[Number(segment.slice(segment.lastIndexOf('.') + 1))];
        if (entry) return { origin: entry.remote, path: slash === -1 ? '/' : rest.slice(slash), type: entry.type };
      }
      return { origin: target.origin, path: requestPath, type: ORIGIN_TYPE.TARGET };
    },

    /** Rewrites every known remote origin in `text` to its local equivalent. */
    toLocal: function (text) {
      return replaceAll(text, toLocalPairs);
    },

    /** Rewrites local origins/hosts in `text` (URL, body, header) back to the real site. */
    toUpstream: function (text) {
      return replaceAll(text, toUpstreamPairs);
    },
  };
}

module.exports = { createOriginMap: createOriginMap, ORIGIN_TYPE: ORIGIN_TYPE };
