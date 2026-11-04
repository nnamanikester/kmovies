/**
 * Thin wrapper around webOS-specific browser APIs, so the rest of the app
 * never touches platform globals directly.
 */
export function isWebOS() {
  return typeof window !== 'undefined' && (Boolean(window.PalmSystem) || /Web0S|webOS/i.test(navigator.userAgent));
}

/** Closes the app on the TV; on desktop it's a no-op (browsers block it). */
export function exitApp() {
  window.close();
}
