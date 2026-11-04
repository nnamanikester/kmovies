import { useEffect, useRef } from 'react';
import { APP_CONFIG } from '../config/app.config';
import { isReachable } from '../services/connectivity';

const { PROXY_HEALTH_INTERVAL_MS, PROXY_HEALTH_TIMEOUT_MS } = APP_CONFIG;

/**
 * Polls the proxy while the site is showing; if webOS has stopped the
 * service, calls `onDown` once so the app can restart it and reload the site.
 *
 * @param {string|null} siteUrl  proxied site URL, or null when not running
 * @param {() => void} onDown
 */
export function useProxyWatchdog(siteUrl, onDown) {
  const onDownRef = useRef(onDown);
  onDownRef.current = onDown;

  useEffect(() => {
    if (!siteUrl) return undefined;
    const healthUrl = `${siteUrl}__kmovies/status`;
    let checking = false;

    const id = setInterval(async () => {
      if (checking) return;
      checking = true;
      const alive = await isReachable(healthUrl, PROXY_HEALTH_TIMEOUT_MS);
      checking = false;
      if (!alive) {
        clearInterval(id);
        onDownRef.current();
      }
    }, PROXY_HEALTH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [siteUrl]);
}
