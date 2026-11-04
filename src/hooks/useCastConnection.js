import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../config/app.config';
import { readServerConfig } from '../services/serverConfig';

const { RECONNECT_DELAY_MS } = APP_CONFIG;

const CODECS = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hev1: 'video/mp4; codecs="hev1.1.6.L93.90"',
  hvc1: 'video/mp4; codecs="hvc1.1.6.L93.90"',
};

/** What this TV can decode, shown in the server's log. */
function playableCodecs() {
  const result = {};
  Object.keys(CODECS).forEach((name) => {
    result[name] = Boolean(window.MediaSource && MediaSource.isTypeSupported(CODECS[name]));
  });
  return result;
}

/**
 * Keeps the TV connected to the KMovies server and receives what to play.
 * If the connection drops, whatever is playing carries on and the TV reconnects.
 *
 * @param {(message: object) => void} onMessage anything else the server sends
 */
export function useCastConnection(onMessage) {
  const [config, setConfig] = useState(readServerConfig);
  const [connected, setConnected] = useState(false);
  const [media, setMedia] = useState(null);
  const socketRef = useRef(null);
  const castIdRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const { server, token } = config;

  // `npm start` opening the app again, usually because this computer's address changed.
  useEffect(() => {
    const onRelaunch = () => {
      setConfig(readServerConfig());
      const system = window.webOSSystem || window.PalmSystem;
      if (system && system.activate) system.activate();
    };
    document.addEventListener('webOSRelaunch', onRelaunch);
    return () => document.removeEventListener('webOSRelaunch', onRelaunch);
  }, []);

  useEffect(() => {
    if (!server) return undefined;
    let closed = false;
    let retryTimer;

    const connect = () => {
      const socket = new WebSocket(`${server.replace(/^http/, 'ws')}/ws/receiver?t=${encodeURIComponent(token)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        socket.send(JSON.stringify({ type: 'hello', castId: castIdRef.current, codecs: playableCodecs() }));
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'load') {
          castIdRef.current = message.castId;
          setMedia(message);
        } else if (message.type === 'stop') {
          castIdRef.current = null;
          setMedia(null);
        } else {
          onMessageRef.current(message);
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      if (socketRef.current) socketRef.current.close();
    };
  }, [server, token]);

  const send = useCallback((message) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const sendStatus = useCallback((status) => send({ type: 'status', castId: castIdRef.current, ...status }), [send]);

  const clearMedia = useCallback(() => {
    castIdRef.current = null;
    setMedia(null);
  }, []);

  // Script errors on the TV are otherwise invisible, so they go to the server's log.
  useEffect(() => {
    const onError = (event) => send({ type: 'log', text: `${event.message} (${event.filename}:${event.lineno})` });
    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, [send]);

  return { connected, server, media, send, sendStatus, clearMedia };
}
