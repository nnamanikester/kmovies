import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import dashjs from 'dashjs';
import { APP_CONFIG } from '../config/app.config';

export const AUTO_QUALITY = -1;

/** Names each quality, adding the bitrate where two share a resolution. */
function labelQualities(list) {
  const heights = list.map((quality) => quality.height);
  return list
    .map((quality) => {
      const shared = !quality.height || heights.indexOf(quality.height) !== heights.lastIndexOf(quality.height);
      const kbps = quality.bitrate ? `${Math.round(quality.bitrate / 1000)} kbps` : '';
      const label = quality.height ? `${quality.height}p${shared && kbps ? ` · ${kbps}` : ''}` : kbps || `Quality ${quality.id + 1}`;
      return { ...quality, label };
    })
    .sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));
}

const describeMediaError = (video) => {
  const code = video.error ? video.error.code : 0;
  if (code === 4) return 'the TV can’t open this video format';
  if (code === 3) return 'the TV can’t decode this video';
  if (code === 2) return 'the video stopped downloading';
  return 'playback failed';
};

/**
 * Plays `media` in a <video> element, follows control signals and reports back.
 * @param {{ url: string, mediaType: string, castId: string }|null} media
 * @param {(status: object) => void} sendStatus
 */
export function usePlayer(media, sendStatus) {
  const videoRef = useRef(null);
  /** The stream's qualities, and the chosen one (AUTO_QUALITY lets the player decide). */
  const [qualities, setQualities] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState(AUTO_QUALITY);
  const [playingQuality, setPlayingQuality] = useState(null);
  const setQualityRef = useRef(() => {});
  const sendStatusRef = useRef(sendStatus);
  sendStatusRef.current = sendStatus;

  const report = useCallback((status) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    sendStatusRef.current({ status, position: video.currentTime, duration, paused: video.paused });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!media || !video) return undefined;
    let hls = null;
    let dash = null;
    let status = 'loading';
    let recoveredMedia = false;

    setQualities([]);
    setSelectedQuality(AUTO_QUALITY);
    setPlayingQuality(null);
    setQualityRef.current = () => {};

    const set = (next) => {
      status = next;
      report(next);
    };
    const fail = (message) => sendStatusRef.current({ status: 'error', error: message });

    const onPlaying = () => set('playing');
    const onPause = () => set('paused');
    const onWaiting = () => set('buffering');
    const onEnded = () => set('ended');
    const onError = () => fail(describeMediaError(video));
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    const play = () => {
      const started = video.play();
      if (started && started.catch) started.catch(() => {});
    };

    if (media.mediaType === 'hls' && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false });
      hls.loadSource(media.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setQualities(labelQualities(hls.levels.map((level, id) => ({ id, height: level.height, bitrate: level.bitrate }))));
        play();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setPlayingQuality(data.level));
      setQualityRef.current = (id) => {
        hls.currentLevel = id;
      };
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
          recoveredMedia = true;
          hls.recoverMediaError();
        } else fail(data.details);
      });
    } else if (media.mediaType === 'dash') {
      dash = dashjs.MediaPlayer().create();
      dash.on(dashjs.MediaPlayer.events.ERROR, ({ error }) => {
        const detail = error && (error.message || error.code);
        fail(`DASH: ${detail || 'playback failed'}`);
      });
      dash.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
        const list = dash.getBitrateInfoListFor('video') || [];
        setQualities(labelQualities(list.map((info) => ({ id: info.qualityIndex, height: info.height, bitrate: info.bitrate }))));
      });
      dash.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, (event) => {
        if (event.mediaType === 'video') setPlayingQuality(event.newQuality);
      });
      setQualityRef.current = (id) => {
        const automatic = id === AUTO_QUALITY;
        dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: automatic } } } });
        if (!automatic) dash.setQualityFor('video', id, true);
      };
      dash.initialize(video, media.url, true);
    } else {
      video.src = media.url;
      play();
    }

    // Continue from the same point when switching to another version.
    const onLoadedMetadata = () => {
      if (media.startAt > 0) video.currentTime = media.startAt;
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    const heartbeat = setInterval(() => report(status), APP_CONFIG.STATUS_INTERVAL_MS);

    return () => {
      clearInterval(heartbeat);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (hls) hls.destroy();
      if (dash) dash.reset();
      video.removeAttribute('src');
      video.load();
    };
  }, [media, report]);

  const control = useCallback(({ action, value }) => {
    const video = videoRef.current;
    if (!video) return;
    const seekTo = (seconds) => {
      const end = Number.isFinite(video.duration) ? video.duration : seconds;
      video.currentTime = Math.min(Math.max(0, seconds), end);
    };
    const play = () => {
      const started = video.play();
      if (started && started.catch) started.catch(() => {});
    };
    if (action === 'play') play();
    else if (action === 'pause') video.pause();
    else if (action === 'toggle') {
      if (video.paused) play();
      else video.pause();
    } else if (action === 'seekBy') seekTo(video.currentTime + value);
    else if (action === 'seekTo') seekTo(value);
    else if (action === 'speed') video.playbackRate = value;
  }, []);

  const selectQuality = useCallback((id) => {
    setSelectedQuality(id);
    setQualityRef.current(id);
  }, []);

  return { videoRef, control, qualities, selectedQuality, playingQuality, selectQuality };
}
