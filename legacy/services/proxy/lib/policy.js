'use strict';
/**
 * Site policy: ad blocking and script patches, driven by the site options
 * the app passes in (see src/config/site.config.json).
 *
 * Ad blocking is allow-list based: a Content-Security-Policy lets the page
 * run scripts and frames ONLY from the proxy itself (i.e. the site's own
 * code). Third-party ad/tracker scripts, ad iframes and interstitials are
 * refused by the browser. Data (API calls, images, video) is unrestricted,
 * so the site keeps working.
 */
var crypto = require('crypto');
var config = require('./config');
var pkg = require('../package.json');

/**
 * @param {string[]} frameOrigins  third-party frames the site needs (e.g. trailer players)
 * @param {string[]} scriptOrigins third-party scripts the site needs to function (e.g. its player SDKs)
 */
function buildCsp(frameOrigins, scriptOrigins) {
  var frames = ["'self'", 'blob:'].concat(frameOrigins).join(' ');
  var scripts = ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'].concat(scriptOrigins).join(' ');
  return [
    'script-src ' + scripts,
    'frame-src ' + frames,
    'child-src ' + frames,
    "worker-src 'self' blob:",
    "object-src 'none'",
  ].join('; ');
}

var BLOCKED_PAGE = '<!doctype html><html><head></head><body></body></html>';

function createPolicy(options) {
  var blockedPaths = options.blockedPaths || [];
  var hiddenSelectors = options.hiddenSelectors || [];
  var patches = options.scriptPatches || [];
  // Anything that changes the transformed output must change this.
  var versionSource = JSON.stringify([pkg.version, config.TRANSPILE_TARGET, patches]);
  var patchesHash = crypto.createHash('sha1').update(versionSource).digest('hex').slice(0, 8);

  var hideCss = hiddenSelectors.length
    ? '<style>' + hiddenSelectors.join(',') + '{display:none!important}</style>'
    : '';

  return {
    contentSecurityPolicy: buildCsp(options.allowedFrameOrigins || [], options.allowedScriptOrigins || []),
    blockedPage: BLOCKED_PAGE,

    /** Changes whenever the output would, invalidating disk and browser caches. */
    version: patchesHash,

    /** Markup injected at the start of every HTML <head>. */
    headInjection: function (polyfillsUrl) {
      return '<script src="' + polyfillsUrl + '"></script>' + hideCss;
    },

    isBlocked: function (requestPath) {
      var pathname = requestPath.split('?')[0];
      return blockedPaths.some(function (p) {
        return pathname === p || pathname.indexOf(p + '/') === 0;
      });
    },

    /** Applies the configured find/replace patches to (pre-transpile) script source. */
    patchScript: function (code) {
      return patches.reduce(function (acc, p) {
        return acc.split(p.find).join(p.replace);
      }, code);
    },
  };
}

module.exports = { createPolicy: createPolicy };
