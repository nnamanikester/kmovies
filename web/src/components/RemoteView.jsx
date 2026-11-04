import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const RESIZE_DEBOUNCE_MS = 200;
const MAX_PIXEL_RATIO = 3;
const RATIO_CHECK_MS = 1000;
const INPUT_INTERVAL_MS = 16;
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DISTANCE = 5;
const BUTTON_NAMES = ['left', 'middle', 'right'];
const IS_MAC = /mac/i.test(navigator.platform);
/** Your own browser won't let a page have these, so they aren't forwarded. */
const LEFT_TO_BROWSER = new Set(['KeyT', 'KeyN', 'KeyW', 'KeyQ', 'Tab']);

function modifierBits(event) {
  // Ctrl on Windows and Linux does what Cmd does on a Mac.
  const command = IS_MAC ? event.metaKey : event.ctrlKey;
  const control = IS_MAC ? event.ctrlKey : false;
  return (event.altKey ? 1 : 0) + (control ? 2 : 0) + (command ? 4 : 0) + (event.shiftKey ? 8 : 0);
}

/**
 * Shows the active tab's screen and passes your mouse and keyboard straight to
 * the page, so it behaves as if you were using it directly.
 */
export const RemoteView = forwardRef(function RemoteView({ send, connected, cursor, selection, onShortcut }, ref) {
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  /** The size Chrome was last told to use, which pointer positions must map onto. */
  const sentSizeRef = useRef(null);
  const lastClickRef = useRef({ time: 0, x: 0, y: 0, count: 0 });
  /** Moves are sent at most once per INPUT_INTERVAL_MS, always ending with the latest. */
  const lastMoveAtRef = useRef(0);
  const moveTimerRef = useRef(null);
  const wheelRef = useRef(null);
  const selectionRef = useRef('');
  selectionRef.current = selection;

  useImperativeHandle(ref, () => ({
    showFrame(blob) {
      const image = imageRef.current;
      if (!image) return;
      const previous = image.src;
      image.src = URL.createObjectURL(blob);
      if (previous) URL.revokeObjectURL(previous);
    },
    focus() {
      stageRef.current?.focus({ preventScroll: true });
    },
  }), []);

  // Chrome's window takes the size of this stage, so the page lays out for your screen.
  // Told again on every connection: a restarted server starts with its default size.
  useEffect(() => {
    if (!connected) return undefined;
    const stage = stageRef.current;
    const mobile = window.matchMedia('(pointer: coarse)').matches;
    let timer;
    const report = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      sentSizeRef.current = { width, height };
      // Exactly your screen's pixels, so the page is drawn at the resolution it's shown at.
      send({ type: 'viewport', width, height, deviceScaleFactor: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO), mobile });
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(report, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(stage);
    // Browser zoom resizes the window; moving it to another screen changes the pixel ratio alone.
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(report, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);
    let ratio = window.devicePixelRatio;
    const ratioWatch = setInterval(() => {
      if (window.devicePixelRatio === ratio) return;
      ratio = window.devicePixelRatio;
      onResize();
    }, RATIO_CHECK_MS);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      clearInterval(ratioWatch);
    };
  }, [send, connected]);

  // Scrolling is sent once per screen update, and React's wheel listener can't stop the page's own.
  useEffect(() => {
    const stage = stageRef.current;
    const onWheel = (event) => {
      event.preventDefault();
      const point = position(event);
      if (wheelRef.current) {
        wheelRef.current.deltaX += event.deltaX;
        wheelRef.current.deltaY += event.deltaY;
        return;
      }
      wheelRef.current = { ...point, deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifierBits(event) };
      setTimeout(() => {
        send({ type: 'wheel', ...wheelRef.current });
        wheelRef.current = null;
      }, INPUT_INTERVAL_MS);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [send]);

  // The clipboard belongs to your browser: paste into the page, copy what's selected in it.
  useEffect(() => {
    const stage = stageRef.current;
    const onPaste = (event) => {
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      if (text) send({ type: 'text', text });
    };
    const onCopy = (event) => {
      if (!selectionRef.current) return;
      event.clipboardData.setData('text/plain', selectionRef.current);
      event.preventDefault();
    };
    stage.addEventListener('paste', onPaste);
    stage.addEventListener('copy', onCopy);
    stage.addEventListener('cut', onCopy);
    return () => {
      stage.removeEventListener('paste', onPaste);
      stage.removeEventListener('copy', onCopy);
      stage.removeEventListener('cut', onCopy);
    };
  }, [send]);

  function position(event) {
    const rect = stageRef.current.getBoundingClientRect();
    const size = sentSizeRef.current ?? rect;
    return {
      x: ((event.clientX - rect.left) * size.width) / rect.width,
      y: ((event.clientY - rect.top) * size.height) / rect.height,
    };
  }

  const countClicks = (event) => {
    const last = lastClickRef.current;
    const isRepeat = event.timeStamp - last.time < DOUBLE_CLICK_MS
      && Math.abs(event.clientX - last.x) < DOUBLE_CLICK_DISTANCE
      && Math.abs(event.clientY - last.y) < DOUBLE_CLICK_DISTANCE;
    lastClickRef.current = { time: event.timeStamp, x: event.clientX, y: event.clientY, count: isRepeat ? Math.min(last.count + 1, 3) : 1 };
    return lastClickRef.current.count;
  };

  const sendPointer = (phase, event) => {
    if (!event.isPrimary) return;
    if (event.pointerType !== 'mouse') {
      send({ type: 'pointer', kind: 'touch', phase, ...position(event) });
      return;
    }
    const button = phase === 'move' ? (event.buttons & 1 ? 'left' : 'none') : BUTTON_NAMES[event.button] || 'left';
    send({
      type: 'pointer',
      kind: 'mouse',
      phase,
      button,
      clickCount: phase === 'move' ? 0 : lastClickRef.current.count,
      modifiers: modifierBits(event),
      ...position(event),
    });
  };

  const onPointerDown = (event) => {
    clearTimeout(moveTimerRef.current);
    stageRef.current.focus({ preventScroll: true });
    stageRef.current.setPointerCapture(event.pointerId);
    countClicks(event);
    sendPointer('down', event);
  };

  const onPointerMove = (event) => {
    clearTimeout(moveTimerRef.current);
    const wait = lastMoveAtRef.current + INPUT_INTERVAL_MS - event.timeStamp;
    const sendMove = () => {
      lastMoveAtRef.current = performance.now();
      sendPointer('move', event);
    };
    if (wait <= 0) sendMove();
    else moveTimerRef.current = setTimeout(sendMove, wait);
  };

  const sendKey = (phase, event) => {
    const hasShortcutModifier = event.metaKey || event.ctrlKey;
    const text = phase === 'down' && !hasShortcutModifier
      ? (event.key === 'Enter' ? '\r' : event.key.length === 1 ? event.key : undefined)
      : undefined;
    send({
      type: 'key',
      phase,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      text,
      modifiers: modifierBits(event),
      location: event.location,
      repeat: event.repeat,
    });
  };

  const onKeyDown = (event) => {
    if (event.isComposing) return;
    const command = IS_MAC ? event.metaKey : event.ctrlKey;
    if (command && LEFT_TO_BROWSER.has(event.code)) return;
    if (command && !event.shiftKey && !event.altKey) {
      // Browser commands, for the page you're looking at.
      const shortcut = { KeyL: 'address', KeyR: 'reload', BracketLeft: 'back', BracketRight: 'forward' }[event.code];
      if (shortcut) {
        event.preventDefault();
        onShortcut(shortcut);
        return;
      }
      // These fire your browser's clipboard events, handled above.
      if (event.code === 'KeyV' || event.code === 'KeyC') return;
      if (event.code === 'KeyX') {
        sendKey('down', event);
        return;
      }
    }
    event.preventDefault();
    sendKey('down', event);
  };

  const onKeyUp = (event) => {
    if (event.isComposing) return;
    event.preventDefault();
    sendKey('up', event);
  };

  return (
    <div
      ref={stageRef}
      className="stage"
      tabIndex={0}
      role="application"
      aria-label="Web page"
      style={{ cursor: cursor || 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        clearTimeout(moveTimerRef.current);
        sendPointer('up', event);
      }}
      onPointerCancel={(event) => sendPointer('cancel', event)}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onCompositionEnd={(event) => {
        if (event.data) send({ type: 'text', text: event.data });
      }}
    >
      <img ref={imageRef} className="stage__screen" alt="" draggable="false" />
    </div>
  );
});
