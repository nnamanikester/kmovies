import { useCallback, useEffect, useState } from 'react';
import { APP_CONFIG } from '../config/app.config';
import { LAUNCH_STATUS } from '../constants/launchStatus';
import { isReachable } from '../services/connectivity';
import { delay } from '../services/delay';
import { startProxy } from '../services/proxy';
import { useProxyWatchdog } from './useProxyWatchdog';

const { TARGET_URL, SPLASH_MIN_DURATION_MS, CONNECTIVITY_TIMEOUT_MS } = APP_CONFIG;

/**
 * Drives the launch flow:
 *   check connectivity -> start the compatibility proxy -> ready (show the site)
 * falling back to OFFLINE / ERROR so the user can retry. While ready, a
 * watchdog restarts the proxy if the TV stops it.
 *
 * @returns {{ status: string, siteUrl: string|null, error: string|null, retry: () => void }}
 */
export function useLauncher() {
  const [state, setState] = useState({ status: LAUNCH_STATUS.CHECKING, siteUrl: null, error: null });

  const launch = useCallback(async () => {
    setState({ status: LAUNCH_STATUS.CHECKING, siteUrl: null, error: null });

    // Run the check alongside the minimum splash time so the logo never flashes.
    const [reachable] = await Promise.all([
      isReachable(TARGET_URL, CONNECTIVITY_TIMEOUT_MS),
      delay(SPLASH_MIN_DURATION_MS),
    ]);
    if (!reachable) {
      setState({ status: LAUNCH_STATUS.OFFLINE, siteUrl: null, error: null });
      return;
    }

    setState({ status: LAUNCH_STATUS.STARTING_PROXY, siteUrl: null, error: null });
    try {
      const origin = await startProxy();
      setState({ status: LAUNCH_STATUS.READY, siteUrl: `${origin}/`, error: null });
    } catch (e) {
      setState({ status: LAUNCH_STATUS.ERROR, siteUrl: null, error: e.message });
    }
  }, []);

  useEffect(() => {
    launch();
  }, [launch]);

  // If webOS stops the proxy service mid-session, restart it and reload the site.
  useProxyWatchdog(state.siteUrl, launch);

  // Relaunch automatically as soon as the TV reports it's back online.
  useEffect(() => {
    if (state.status !== LAUNCH_STATUS.OFFLINE) return undefined;
    window.addEventListener('online', launch);
    return () => window.removeEventListener('online', launch);
  }, [state.status, launch]);

  return { ...state, retry: launch };
}
