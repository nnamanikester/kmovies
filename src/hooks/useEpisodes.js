import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../config/app.config';

const STORAGE_KEY = 'kmovies-autoplay';
const DEFAULT_PREFS = { autoplay: true, lead: APP_CONFIG.UP_NEXT_LEAD_OPTIONS[1] };
const NOTHING = { castId: null, current: null, next: null, previous: null, episodes: [], seasons: [], seriesEnd: false };

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch (e) {
    return DEFAULT_PREFS;
  }
}

/** Where we are in a series, and moving through it. The server works out what the site offers. */
export function useEpisodes(media, send) {
  const [info, setInfo] = useState(NOTHING);
  const [advancing, setAdvancing] = useState(null);
  const [failed, setFailed] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  // Episodes that started by themselves since a button was last pressed.
  const unattendedRef = useRef(0);
  const castId = media ? media.castId : null;
  const known = info.castId === castId ? info : NOTHING;

  const updatePrefs = useCallback((change) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        // Settings just won't be remembered.
      }
      return next;
    });
  }, []);

  const request = useCallback((action, details) => {
    setFailed(null);
    send({ type: 'episode', action, ...details });
  }, [send]);

  /** @param {boolean} [automatic] started by itself @param {boolean} [finished] from the closing moments */
  const next = useCallback((automatic = false, finished = false) => {
    unattendedRef.current = automatic ? unattendedRef.current + 1 : 0;
    request('next', { finished });
  }, [request]);
  const previous = useCallback(() => request('previous'), [request]);
  const jump = useCallback((season, episode) => request('jump', { season, episode }), [request]);
  const cancel = useCallback(() => {
    setAdvancing(null);
    request('cancel');
  }, [request]);
  const look = useCallback(() => send({ type: 'episode', action: 'look' }), [send]);

  const onMessage = useCallback((message) => {
    if (message.type === 'episodes') {
      setInfo(message);
    } else if (message.type === 'advancing') {
      setFailed(null);
      setAdvancing({ castId: message.castId, label: message.label });
    } else if (message.type === 'advanceFailed') {
      setAdvancing(null);
      setFailed({ castId: message.castId, label: message.label });
    }
  }, []);

  useEffect(() => {
    setAdvancing(null);
    setFailed(null);
  }, [castId]);

  // Anyone pressing a button is clearly still watching.
  useEffect(() => {
    const onKey = () => {
      unattendedRef.current = 0;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return {
    current: known.current,
    nextEpisode: known.next,
    previousEpisode: known.previous,
    episodes: known.episodes,
    seasons: known.seasons,
    seriesEnd: known.seriesEnd,
    advancing: advancing && advancing.castId === castId ? advancing : null,
    failed: failed && failed.castId === castId ? failed : null,
    prefs,
    unattendedRef,
    updatePrefs,
    onMessage,
    next,
    previous,
    jump,
    cancel,
    look,
    clearFailed: () => setFailed(null),
  };
}
