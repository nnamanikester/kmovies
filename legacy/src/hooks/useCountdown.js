import { useEffect, useRef, useState } from 'react';

/**
 * Counts down from `seconds` while `active`, then calls `onComplete`.
 * Restarts whenever it becomes active again. Returns the seconds remaining.
 */
export function useCountdown(seconds, onComplete, active = true) {
  const [remaining, setRemaining] = useState(seconds);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) return undefined;

    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          onCompleteRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [seconds, active]);

  return remaining;
}
