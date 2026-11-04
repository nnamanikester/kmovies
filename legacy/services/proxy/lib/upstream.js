'use strict';
/** HTTP(S) client for talking to the real site. */
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var URL = require('url').URL;
var config = require('./config');

var agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 8 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 8 }),
};

/** Headers that must not be forwarded hop-to-hop. */
var HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

/**
 * @param {{ stream?: NodeJS.ReadableStream, buffer?: Buffer }|null} body
 * @returns {Promise<http.IncomingMessage>}
 */
function request(method, url, headers, body) {
  var parsed = new URL(url);
  var transport = parsed.protocol === 'https:' ? https : http;

  return new Promise(function (resolve, reject) {
    var req = transport.request(
      {
        method: method,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: headers,
        agent: agents[parsed.protocol],
        timeout: config.UPSTREAM_TIMEOUT_MS,
      },
      resolve
    );
    req.on('timeout', function () {
      req.abort();
      reject(new Error('Upstream timeout: ' + url));
    });
    req.on('error', reject);
    if (body && body.stream) body.stream.pipe(req);
    else req.end(body && body.buffer);
  });
}

/** Reads and decompresses a full response body. */
function readBody(res) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('error', reject);
    res.on('end', function () {
      var raw = Buffer.concat(chunks);
      var encoding = (res.headers['content-encoding'] || '').toLowerCase();
      try {
        if (encoding === 'gzip') resolve(zlib.gunzipSync(raw));
        else if (encoding === 'deflate') resolve(zlib.inflateSync(raw));
        else resolve(raw);
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = { request: request, readBody: readBody, HOP_BY_HOP: HOP_BY_HOP };
