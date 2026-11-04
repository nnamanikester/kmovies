import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'kmovies-subtitles';
const DEFAULT_PREFS = { language: null, size: 'medium', background: true };
const NONE = { kind: 'none', id: null };
const NO_TRACKS = [];

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch (e) {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    // Settings just won't be remembered.
  }
}

const sameLanguage = (a, b) => Boolean(a && b) && a.slice(0, 2).toLowerCase() === b.slice(0, 2).toLowerCase();

function subtitleTextTracks(video) {
  if (!video) return [];
  return Array.prototype.filter.call(video.textTracks, (track) => track.kind === 'subtitles' || track.kind === 'captions');
}

/**
 * All the TV's subtitle state: what's available from each source, what's
 * showing, and how it looks. Files are parsed on the server and arrive as cues.
 */
export function useSubtitles(media, videoRef, send) {
  // Kept with the video they belong to, as they can arrive just ahead of the new video's setup.
  const [trackList, setTrackList] = useState({ castId: null, tracks: [] });
  const [onlineSearch, setOnlineSearch] = useState(false);
  const [embedded, setEmbedded] = useState([]);
  const [selection, setSelection] = useState(NONE);
  const [cues, setCues] = useState([]);
  const [embeddedText, setEmbeddedText] = useState(null);
  const [delay, setDelay] = useState(0);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const selectionRef = useRef(NONE);
  const chosenThisCastRef = useRef(false);
  const castId = media ? media.castId : null;
  const tracks = trackList.castId === castId ? trackList.tracks : NO_TRACKS;

  const updatePrefs = useCallback((change) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      savePrefs(next);
      return next;
    });
  }, []);

  const applySelection = useCallback((next) => {
    selectionRef.current = next;
    setSelection(next);
    setCues([]);
    setEmbeddedText(null);
    setError(null);
  }, []);

  const hideEmbedded = useCallback(() => {
    subtitleTextTracks(videoRef.current).forEach((track) => { track.mode = 'disabled'; });
  }, [videoRef]);

  const turnOff = useCallback(() => {
    chosenThisCastRef.current = true;
    hideEmbedded();
    applySelection(NONE);
    setBusy(false);
    updatePrefs({ language: null });
  }, [applySelection, hideEmbedded, updatePrefs]);

  /** @param {{ id: string, language?: string|null }} track */
  const selectFile = useCallback((track, byUser = true) => {
    if (byUser) {
      chosenThisCastRef.current = true;
      updatePrefs({ language: track.language || null });
    }
    hideEmbedded();
    applySelection({ kind: 'file', id: track.id, language: track.language || null, source: track.source || null });
    setBusy(true);
    send({ type: 'subtitle', action: 'load', id: track.id });
  }, [applySelection, hideEmbedded, send, updatePrefs]);

  const selectEmbedded = useCallback((index, byUser = true) => {
    const list = subtitleTextTracks(videoRef.current);
    const track = list[index];
    if (!track) return;
    if (byUser) {
      chosenThisCastRef.current = true;
      updatePrefs({ language: track.language || null });
    }
    list.forEach((other) => { if (other !== track) other.mode = 'disabled'; });
    // Hidden, not showing: the cues are drawn by SubtitleOverlay so size and background apply.
    track.mode = 'hidden';
    applySelection({ kind: 'embedded', id: index });
    setBusy(false);
  }, [applySelection, updatePrefs, videoRef]);

  const search = useCallback((query, language) => {
    setBusy(true);
    setError(null);
    send({ type: 'subtitle', action: 'search', query, language });
  }, [send]);

  const refresh = useCallback(() => send({ type: 'subtitle', action: 'refresh' }), [send]);

  /** Handles the server's subtitle messages. */
  const onMessage = useCallback((message) => {
    if (message.type === 'subtitleTracks') {
      setTrackList({ castId: message.castId, tracks: message.tracks });
      setOnlineSearch(message.onlineSearch);
    } else if (message.type === 'subtitleReply') {
      if (message.action === 'search') {
        setBusy(false);
        if (message.error) setError(message.error);
        else setResults(message.results);
      } else if (message.action === 'load' && selectionRef.current.id === message.id) {
        setBusy(false);
        if (message.error) {
          selectionRef.current = NONE;
          setSelection(NONE);
          setError(message.error);
        } else {
          setCues(message.cues);
        }
      }
    }
  }, []);

  // Each new video starts clean.
  useEffect(() => {
    selectionRef.current = NONE;
    chosenThisCastRef.current = false;
    setEmbedded([]);
    setSelection(NONE);
    setCues([]);
    setEmbeddedText(null);
    setDelay(0);
    setResults(null);
    setBusy(false);
    setError(null);
  }, [castId]);

  // Tracks inside the stream appear as the player reads it.
  useEffect(() => {
    const video = videoRef.current;
    if (!castId || !video) return undefined;
    const update = () => setEmbedded(subtitleTextTracks(video).map((track, index) => ({
      index,
      label: track.label || track.language || `Track ${index + 1}`,
      language: track.language || null,
    })));
    update();
    video.textTracks.addEventListener('addtrack', update);
    video.textTracks.addEventListener('removetrack', update);
    return () => {
      video.textTracks.removeEventListener('addtrack', update);
      video.textTracks.removeEventListener('removetrack', update);
    };
  }, [castId, videoRef]);

  // The site replaced what's showing with a newer list, as when its episode loaded late: follow it.
  useEffect(() => {
    const showing = selectionRef.current;
    if (showing.kind !== 'file' || showing.source !== 'page' || tracks === NO_TRACKS) return;
    if (tracks.some((track) => track.id === showing.id)) return;
    const replacement = tracks.find((track) => track.source === 'page' && sameLanguage(track.language, showing.language));
    if (replacement) selectFile(replacement, false);
    else {
      selectionRef.current = NONE;
      setSelection(NONE);
      setCues([]);
    }
  }, [tracks, selectFile]);

  // Show the language you last chose, as soon as it's offered.
  useEffect(() => {
    if (chosenThisCastRef.current || !prefs.language || selectionRef.current.kind !== 'none') return;
    const file = tracks.find((track) => sameLanguage(track.language, prefs.language));
    if (file) {
      selectFile(file, false);
      return;
    }
    const inside = embedded.find((track) => sameLanguage(track.language, prefs.language));
    if (inside) selectEmbedded(inside.index, false);
  }, [tracks, embedded, prefs.language, selectFile, selectEmbedded]);

  // Follow the chosen track inside the stream.
  useEffect(() => {
    if (selection.kind !== 'embedded') return undefined;
    const track = subtitleTextTracks(videoRef.current)[selection.id];
    if (!track) return undefined;
    const onCueChange = () => {
      const active = track.activeCues;
      const lines = active ? Array.prototype.map.call(active, (cue) => cue.text.replace(/<[^>]*>/g, '')) : [];
      setEmbeddedText(lines.length ? lines.join('\n') : null);
    };
    track.addEventListener('cuechange', onCueChange);
    return () => track.removeEventListener('cuechange', onCueChange);
  }, [selection, videoRef]);

  return {
    tracks, embedded, onlineSearch, selection, cues, embeddedText, delay, results, busy, error, prefs,
    setDelay, updatePrefs, turnOff, selectFile, selectEmbedded, search, refresh, onMessage,
  };
}
