import { useCallback, useEffect, useRef } from 'react';

/**
 * Remote-friendly focus for a row/column of buttons.
 * Attach `register(index)` as each item's ref; call `move(+1 | -1)` from key handlers.
 * The first item is focused on mount.
 */
export function useFocusGroup() {
  const itemsRef = useRef([]);

  const register = useCallback(
    (index) => (node) => {
      itemsRef.current[index] = node;
    },
    [],
  );

  const move = useCallback((step) => {
    const items = itemsRef.current.filter(Boolean);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement);
    const next = current === -1 ? 0 : (current + step + items.length) % items.length;
    items[next].focus();
  }, []);

  useEffect(() => {
    const first = itemsRef.current.find(Boolean);
    if (first) first.focus();
  }, []);

  return { register, move };
}
