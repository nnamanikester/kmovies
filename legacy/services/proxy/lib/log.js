'use strict';
/**
 * Logger: console + last lines in memory (for /__kmovies/status) + a file in
 * the OS temp dir, which survives service restarts (useful when it crashes).
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var MAX_LINES = 200;
var MAX_FILE_BYTES = 512 * 1024;
var LOG_FILE = path.join(os.tmpdir(), 'kmovies-proxy.log');
var lines = [];

function appendToFile(line) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_FILE_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {
    /* logging must never break the proxy */
  }
}

function write(level, args) {
  var line = new Date().toISOString() + ' [' + level + '] ' + Array.prototype.join.call(args, ' ');
  lines.push(line);
  if (lines.length > MAX_LINES) lines.shift();
  if (level !== 'debug') appendToFile(line);
  (level === 'error' ? console.error : console.log)('[kmovies-proxy] ' + line);
}

module.exports = {
  info: function () { write('info', arguments); },
  error: function () { write('error', arguments); },
  debug: function () { write('debug', arguments); },
  file: LOG_FILE,
  recent: function () { return lines.slice(); },
};
