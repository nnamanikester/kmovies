import { APP_CONFIG } from '../config/app.config';
import { callService } from './luna';
import { isWebOS } from './platform';

const { PROXY_SERVICE_URI, TARGET_URL, SITE, DEV_PROXY_ORIGIN, PROXY_START_TIMEOUT_MS } = APP_CONFIG;

/** Open subscription; holding it keeps the service alive while the app runs. */
let cancelSubscription = null;

/**
 * Starts the on-TV compatibility proxy and resolves with its local origin
 * (e.g. "http://127.0.0.1:8765"). Off-TV, resolves with the dev proxy origin.
 */
export function startProxy() {
  if (!isWebOS()) return Promise.resolve(DEV_PROXY_ORIGIN);

  if (cancelSubscription) cancelSubscription();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The proxy service did not respond.')), PROXY_START_TIMEOUT_MS);

    cancelSubscription = callService(
      PROXY_SERVICE_URI,
      { ...SITE, targetUrl: TARGET_URL, subscribe: true },
      (response) => {
        clearTimeout(timer);
        if (response.returnValue && response.origin) resolve(response.origin);
        else reject(new Error(response.errorText || 'The proxy service failed to start.'));
      },
    );
  });
}
