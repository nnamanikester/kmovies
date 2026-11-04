'use strict';
/**
 * Keeps one bad request from taking the whole proxy down, and records why the
 * process ends (webOS kills services silently otherwise).
 */
var log = require('./log');

function install() {
  process.on('uncaughtException', function (err) {
    log.error('uncaughtException:', (err && err.stack) || err);
  });
  process.on('unhandledRejection', function (reason) {
    log.error('unhandledRejection:', (reason && reason.stack) || reason);
  });
  ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(function (signal) {
    process.on(signal, function () {
      log.error('received', signal, '- exiting');
      process.exit(0);
    });
  });
  process.on('exit', function (code) {
    log.error('process exit, code', code, 'uptime', Math.round(process.uptime()) + 's', 'rss', Math.round(process.memoryUsage().rss / 1048576) + 'MB');
  });
}

module.exports = { install: install };
