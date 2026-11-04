'use strict';
/**
 * webOS JS service entry point.
 *
 * Luna API:  luna://com.kmovies.tv.proxy/start
 *   params:  { targetUrl, assetOrigins?, apiOrigins?, allowedScriptOrigins?, allowedFrameOrigins?,
 *              blockedPaths?, hiddenSelectors?, scriptPatches?, subscribe: true }
 *            (see src/config/site.config.json)
 *   reply:   { returnValue: true, origin: "http://127.0.0.1:8765" }
 *
 * The app keeps the subscription open for as long as it runs; that (plus a
 * keepAlive activity) stops webOS from shutting the service down mid-session.
 */
require('./lib/process-guard').install();

var Service = require('webos-service');
var pkg = require('./package.json');
var proxy = require('./lib/server');
var log = require('./lib/log');

var service = new Service(pkg.name);
log.info('service process started, pid', process.pid);
var subscribers = {};
var keepAliveActivity = null;

function acquireKeepAlive() {
  if (keepAliveActivity) return;
  try {
    service.activityManager.create('keepAlive', function (activity) {
      keepAliveActivity = activity;
    });
  } catch (e) {
    log.error('keepAlive unavailable:', e.message);
  }
}

function releaseKeepAlive() {
  if (!keepAliveActivity || Object.keys(subscribers).length) return;
  try {
    service.activityManager.complete(keepAliveActivity, function () {});
  } catch (e) {
    log.error('keepAlive release failed:', e.message);
  }
  keepAliveActivity = null;
}

service.register(
  'start',
  function (message) {
    log.info('start called, subscription:', Boolean(message.isSubscription));
    if (message.isSubscription) {
      subscribers[message.uniqueToken] = message;
      acquireKeepAlive();
    }
    proxy
      .start(message.payload)
      .then(function (info) {
        message.respond({ returnValue: true, origin: info.origin, subscribed: Boolean(message.isSubscription) });
      })
      .catch(function (err) {
        log.error('start failed:', err.message);
        message.respond({ returnValue: false, errorText: err.message });
      });
  },
  function (message) {
    log.info('subscription cancelled');
    delete subscribers[message.uniqueToken];
    releaseKeepAlive();
  }
);
