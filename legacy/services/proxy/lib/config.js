'use strict';
/**
 * Service-level settings. Site-specific values (target URL, asset origins)
 * are NOT here — the app passes them in when it starts the proxy, so the
 * site is configured in one place: src/config/app.config.js.
 */
var path = require('path');

module.exports = Object.freeze({
  /** 127.0.0.1, not "localhost": some sites treat "localhost" as a dev environment. */
  HOST: '127.0.0.1',
  /** First port to try; the next few are tried if it's taken. */
  BASE_PORT: Number(process.env.PROXY_PORT) || 8765,
  PORT_ATTEMPTS: 10,

  /** Browser engine to compile for (webOS 5 = Chrome 68). */
  TRANSPILE_TARGET: process.env.TRANSPILE_TARGET || 'chrome68',
  /** Parallel esbuild processes; the TV CPU is slow, keep this small. */
  TRANSPILE_CONCURRENCY: 1,
  TRANSPILE_ATTEMPTS: 3,

  /** URL prefix for proxy-internal endpoints and for secondary origins. */
  INTERNAL_PREFIX: '/__kmovies',
  ORIGIN_PREFIX: '/__o',
  /** URL prefix for media hosts matched by domain: /__h/<hostname>/... */
  HOST_PREFIX: '/__h',

  VENDOR_DIR: path.join(__dirname, '..', 'vendor'),
  ESBUILD_PATH: process.env.ESBUILD_PATH || path.join(__dirname, '..', 'vendor', 'esbuild'),

  /** First writable directory wins. /media/developer/temp survives reboots on dev-mode TVs. */
  CACHE_DIR_CANDIDATES: [process.env.PROXY_CACHE_DIR, '/media/developer/temp/kmovies-cache', require('os').tmpdir() + '/kmovies-cache'],

  UPSTREAM_TIMEOUT_MS: 30000,
});
