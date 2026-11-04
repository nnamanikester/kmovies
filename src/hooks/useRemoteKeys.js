import { useEffect, useRef } from 'react';
import { KEY_CODE_MAP } from '../constants/keys';

/**
 * Subscribes to remote-control key presses.
 *
 * @param {Partial<Record<keyof typeof import('../constants/keys').KEY, (e: KeyboardEvent) => void>>} handlers
 * @example useRemoteKeys({ BACK: exitApp, LEFT: focusPrev })
 */
export function useRemoteKeys(handlers) {
  // Keep the latest handlers without re-binding the listener every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = KEY_CODE_MAP[event.keyCode];
      // In a text box, Backspace deletes rather than going back.
      if (event.keyCode === 8 && event.target && event.target.tagName === 'INPUT') return;
      const handler = key && handlersRef.current[key];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
