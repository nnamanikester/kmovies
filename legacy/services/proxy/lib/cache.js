'use strict';
/**
 * Tiny disk cache for transpiled assets. Asset filenames on the CDN are
 * content-hashed, so entries never need invalidating.
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var config = require('./config');
var log = require('./log');

var cacheDir = null;

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function init() {
  cacheDir = config.CACHE_DIR_CANDIDATES.filter(Boolean).filter(ensureDir)[0] || null;
  log.info('cache dir:', cacheDir || '(disabled)');
}

function fileFor(key) {
  return cacheDir && path.join(cacheDir, crypto.createHash('sha1').update(key).digest('hex'));
}

function get(key) {
  var file = fileFor(key);
  try {
    return file ? fs.readFileSync(file) : null;
  } catch (e) {
    return null;
  }
}

function set(key, buffer) {
  var file = fileFor(key);
  if (!file) return;
  fs.writeFile(file, buffer, function (err) {
    if (err) log.error('cache write failed:', err.message);
  });
}

module.exports = { init: init, get: get, set: set, dir: function () { return cacheDir; } };
