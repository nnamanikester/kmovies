'use strict';
/**
 * Compiles modern JS/CSS down to what the TV's engine understands, using the
 * native esbuild binary (fast, and independent of the TV's old Node.js).
 * Work is queued, de-duplicated and cached on disk.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;
var config = require('./config');
var cache = require('./cache');
var log = require('./log');

var esbuildPath = null;
var queue = [];
var running = 0;
var inFlight = {};

/** The packaged binary may lose its exec bit; fall back to an executable copy in /tmp. */
function resolveBinary() {
  if (esbuildPath) return esbuildPath;
  try {
    fs.accessSync(config.ESBUILD_PATH, fs.constants.X_OK);
    esbuildPath = config.ESBUILD_PATH;
  } catch (e) {
    var copy = path.join(os.tmpdir(), 'kmovies-esbuild');
    fs.writeFileSync(copy, fs.readFileSync(config.ESBUILD_PATH));
    fs.chmodSync(copy, 493); // 0755
    esbuildPath = copy;
  }
  log.info('esbuild:', esbuildPath);
  return esbuildPath;
}

function runEsbuild(source, loader) {
  return new Promise(function (resolve, reject) {
    var args = ['--loader=' + loader, '--target=' + config.TRANSPILE_TARGET, '--charset=utf8', '--log-level=error'];
    var child = spawn(resolveBinary(), args);
    var out = [];
    var err = [];
    child.stdout.on('data', function (d) { out.push(d); });
    child.stderr.on('data', function (d) { err.push(d); });
    child.on('error', reject);
    // EPIPE when esbuild exits before reading all input; 'close' reports why.
    child.stdin.on('error', function () {});
    child.on('close', function (code, signal) {
      if (code === 0) return resolve(Buffer.concat(out));
      var detail = Buffer.concat(err).toString().trim().slice(0, 300);
      reject(new Error('esbuild exited (code ' + code + ', signal ' + signal + ')' + (detail ? ': ' + detail : '')));
    });
    child.stdin.end(source);
  });
}

/** Retries transient failures (the TV can briefly run short of memory). */
function runWithRetry(job, attemptsLeft) {
  return runEsbuild(job.source, job.loader).catch(function (e) {
    if (attemptsLeft <= 1) throw e;
    log.error('esbuild failed, retrying:', e.message);
    return new Promise(function (r) { setTimeout(r, 300); }).then(function () {
      return runWithRetry(job, attemptsLeft - 1);
    });
  });
}

function pump() {
  while (running < config.TRANSPILE_CONCURRENCY && queue.length) {
    var job = queue.shift();
    running++;
    runWithRetry(job, config.TRANSPILE_ATTEMPTS)
      .then(job.resolve, job.reject)
      .then(function () {
        running--;
        pump();
      });
  }
}

/**
 * @param {Buffer|string} source
 * @param {'js'|'css'} loader
 * @param {string} [cacheKey] stable key (e.g. asset URL); omit for uncacheable content
 * @returns {Promise<Buffer>} transpiled code; rejects if compilation keeps failing
 *          (callers must not cache or serve the untranspiled source as if it worked)
 */
function transpile(source, loader, cacheKey) {
  var key = cacheKey && config.TRANSPILE_TARGET + ':' + cacheKey;
  if (key) {
    var hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    if (inFlight[key]) return inFlight[key];
  }

  var started = Date.now();
  var promise = new Promise(function (resolve, reject) {
    queue.push({ source: source, loader: loader, resolve: resolve, reject: reject });
    pump();
  })
    .then(function (output) {
      if (key) cache.set(key, output);
      if (cacheKey) log.debug('transpiled', cacheKey, '(' + (Date.now() - started) + 'ms)');
      return output;
    })
    .then(
      function (result) {
        if (key) delete inFlight[key];
        return result;
      },
      function (e) {
        if (key) delete inFlight[key];
        log.error('transpile failed for', cacheKey || '(inline)', '-', e.message);
        throw e;
      }
    );

  if (key) inFlight[key] = promise;
  return promise;
}

module.exports = { transpile: transpile };
