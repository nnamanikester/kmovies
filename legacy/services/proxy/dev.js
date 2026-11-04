'use strict';
/**
 * Runs the proxy on your computer (no TV needed) for development:
 *   npm run dev:proxy   ->  open http://127.0.0.1:8765
 * Uses the same site settings as the app (src/config/site.config.json).
 */
var path = require('path');
var site = require('../../src/config/site.config.json');

process.env.ESBUILD_PATH = process.env.ESBUILD_PATH || path.join(__dirname, '..', '..', 'node_modules', 'esbuild', 'bin', 'esbuild');

require('./lib/server')
  .start(site)
  .then(function (info) {
    console.log('KMovies proxy ready: ' + info.origin);
  });
