/**
 * Resolves `true` if `url` answers within `timeoutMs`, `false` otherwise.
 * Uses `no-cors` so it works from the file:// origin webOS apps run under —
 * we only care that the server responds, not what it says.
 */
export function isReachable(url, timeoutMs) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve(false);
  }

  const request = fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
    .then(() => true)
    .catch(() => false);

  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));

  return Promise.race([request, timeout]);
}
