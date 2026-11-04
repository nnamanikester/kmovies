import { useCallback, useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'kmovies-token';
const RECONNECT_MS = 1500;

/** The token arrives in the link you open; it's remembered so the link can be tidied away. */
function readToken() {
  const params = new URLSearchParams(window.location.search);
  const fromLink = params.get('t');
  try {
    if (fromLink) localStorage.setItem(TOKEN_KEY, fromLink);
    return fromLink || localStorage.getItem(TOKEN_KEY);
  } catch {
    return fromLink;
  }
}

/**
 * Connection to the KMovies server.
 * @param {(frame: Blob) => void} onFrame called with each JPEG of Chrome's screen
 * @returns {{ connected: boolean, hasToken: boolean, state: object|null, library: object, cursor: string|null, selection: string, send: (message: object) => void }}
 */
export function useServer(onFrame) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState(null);
  const [library, setLibrary] = useState({ history: [], bookmarks: [] });
  const [cursor, setCursor] = useState(null);
  const [selection, setSelection] = useState('');
  const socketRef = useRef(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const [token] = useState(readToken);

  useEffect(() => {
    if (!token) return undefined;
    let retryTimer;
    let closed = false;

    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/ws/sender?t=${encodeURIComponent(token)}`);
      socket.binaryType = 'blob';
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return onFrameRef.current(event.data);
        const message = JSON.parse(event.data);
        if (message.type === 'state') setState(message);
        if (message.type === 'library') setLibrary(message);
        if (message.type === 'cursor') setCursor(message.cursor);
        if (message.type === 'selection') setSelection(message.text);
        return undefined;
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retryTimer = setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [token]);

  const send = useCallback((message) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  return { connected, hasToken: Boolean(token), state, library, cursor, selection, send };
}
