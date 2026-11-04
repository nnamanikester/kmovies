/**
 * Key codes sent by the LG remote (plus desktop equivalents for local dev).
 */
export const KEY = Object.freeze({
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  UP: 'UP',
  DOWN: 'DOWN',
  ENTER: 'ENTER',
  BACK: 'BACK',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  REWIND: 'REWIND',
  FAST_FORWARD: 'FAST_FORWARD',
});

export const KEY_CODE_MAP = Object.freeze({
  37: KEY.LEFT,
  38: KEY.UP,
  39: KEY.RIGHT,
  40: KEY.DOWN,
  13: KEY.ENTER,
  461: KEY.BACK, // webOS remote "Back"
  27: KEY.BACK, // Escape (desktop)
  8: KEY.BACK, // Backspace (desktop)
  415: KEY.PLAY,
  19: KEY.PAUSE,
  413: KEY.STOP,
  412: KEY.REWIND,
  417: KEY.FAST_FORWARD,
});
