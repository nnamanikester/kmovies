/** States of the launch flow, in the order they normally occur. */
export const LAUNCH_STATUS = Object.freeze({
  CHECKING: 'checking',
  STARTING_PROXY: 'starting-proxy',
  READY: 'ready',
  OFFLINE: 'offline',
  ERROR: 'error',
});
