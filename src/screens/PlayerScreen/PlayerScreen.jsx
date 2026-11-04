import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/app.config';
import { AUTO_QUALITY } from '../../hooks/usePlayer';
import { useRemoteKeys } from '../../hooks/useRemoteKeys';
import { cueTextAt } from '../../services/cues';
import { ControlBar } from './ControlBar';
import { EpisodesPanel } from './EpisodesPanel';
import { QualityPanel } from './QualityPanel';
import { SubtitlePanel } from './SubtitlePanel';
import { UpNext } from './UpNext';
import './PlayerScreen.css';

const {
  CONTROLS_DURATION_MS, PEEK_DURATION_MS, SKIP_SECONDS, SCRUB_STEP_SECONDS, SCRUB_COMMIT_DELAY_MS, SPEEDS,
  UP_NEXT_COUNTDOWN_SECONDS, UP_NEXT_MIN_DURATION_SECONDS, STILL_WATCHING_AFTER, FINISHED_DURATION_MS,
} = APP_CONFIG;

/** hidden: just the video. peek: position shown, keys still skip. controls: bar in charge. panel: subtitles open. */
const MODE = { HIDDEN: 'hidden', PEEK: 'peek', CONTROLS: 'controls', PANEL: 'panel' };

/** What the Quality button shows: the chosen quality's name. */
function qualityLabel({ qualities, selectedQuality, playingQuality }) {
  const shown = selectedQuality === AUTO_QUALITY ? playingQuality : selectedQuality;
  const quality = qualities.find((item) => item.id === shown);
  return quality && quality.height ? `${quality.height}p` : 'HD';
}

/** Full-screen video with the playback controls, run by the remote or its pointer. */
export function PlayerScreen({ media, player, subtitles, episodes, speed, onSpeedChange, versions, onSwitchVersion, onStop, peekRef }) {
  const { videoRef, control } = player;
  const rootRef = useRef(null);
  const [mode, setMode] = useState(MODE.PEEK);
  const [time, setTime] = useState({ position: 0, duration: NaN });
  const [paused, setPaused] = useState(false);
  const [scrub, setScrub] = useState(null);
  const scrubTimer = useRef(null);
  const [panel, setPanel] = useState(null);

  const peek = useCallback(() => setMode((m) => (m === MODE.HIDDEN ? MODE.PEEK : m)), []);
  peekRef.current = peek;

  const focusOn = (selector) => {
    const node = rootRef.current && rootRef.current.querySelector(selector);
    if (node) node.focus();
  };
  const activeNav = () => document.activeElement && document.activeElement.getAttribute('data-nav');

  const showControls = (focus = '[data-nav="play"]') => {
    setMode(MODE.CONTROLS);
    setTimeout(() => focusOn(focus));
  };
  const closePanel = () => showControls(`[data-nav="${panel}"]`);
  const openPanel = (name) => {
    setPanel(name);
    setMode(MODE.PANEL);
    // Start on what's selected, if anything.
    setTimeout(() => {
      focusOn('.subs .subs__item--selected');
      if (!rootRef.current.querySelector('.subs :focus')) moveInPanel(0);
    });
  };

  // Controls go away on their own, unless paused or in the subtitle panel.
  const [activity, setActivity] = useState(0);
  const touch = () => setActivity((n) => n + 1);
  useEffect(() => {
    if (mode === MODE.HIDDEN || mode === MODE.PANEL || (paused && mode === MODE.CONTROLS)) return undefined;
    const wait = mode === MODE.PEEK ? PEEK_DURATION_MS : CONTROLS_DURATION_MS;
    const timer = setTimeout(() => setMode(MODE.HIDDEN), wait);
    return () => clearTimeout(timer);
  }, [mode, activity, paused]);

  useEffect(() => () => clearTimeout(scrubTimer.current), []);

  /* ---------- what's next ---------- */

  const [ended, setEnded] = useState(false);
  // Cancelled for this ending. Seeking back away from the end offers it again.
  const [dismissed, setDismissed] = useState(false);
  const [countdown, setCountdown] = useState(UP_NEXT_COUNTDOWN_SECONDS);
  const remaining = time.duration - time.position;
  const nearEnd = Number.isFinite(remaining)
    && time.duration >= UP_NEXT_MIN_DURATION_SECONDS
    && remaining <= episodes.prefs.lead;
  const canAutoplay = episodes.prefs.autoplay && !dismissed;
  const stillWatchingDue = episodes.unattendedRef.current >= STILL_WATCHING_AFTER;
  const nextLabel = episodes.nextEpisode ? episodes.nextEpisode.label : null;

  useEffect(() => {
    if (!nearEnd && !ended) {
      setDismissed(false);
      setCountdown(UP_NEXT_COUNTDOWN_SECONDS);
    }
  }, [nearEnd, ended]);

  // Have the latest from the site before it's needed.
  const { look } = episodes;
  const nearingEnd = Number.isFinite(remaining) && remaining <= episodes.prefs.lead + 20;
  useEffect(() => {
    if (nearingEnd) look();
  }, [nearingEnd, look]);

  let overlay = null;
  if (episodes.advancing) overlay = { kind: 'advancing', label: episodes.advancing.label };
  else if (episodes.failed) overlay = { kind: 'failed', label: episodes.failed.label };
  else if (nextLabel && canAutoplay && stillWatchingDue && (nearEnd || ended)) overlay = { kind: 'still-watching' };
  else if (ended && nextLabel) overlay = { kind: 'ended', label: nextLabel };
  else if (ended && episodes.seriesEnd) overlay = { kind: 'finished' };
  else if (nearEnd && nextLabel && canAutoplay) overlay = { kind: 'countdown', label: nextLabel, seconds: countdown, total: UP_NEXT_COUNTDOWN_SECONDS };
  const overlayKind = overlay ? overlay.kind : null;

  const { next: goNext } = episodes;
  useEffect(() => {
    if (overlayKind !== 'countdown' || paused) return undefined;
    if (countdown <= 0) {
      goNext(true);
      return undefined;
    }
    const timer = setTimeout(() => setCountdown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [overlayKind, countdown, paused, goNext]);

  // An ending reached with autoplay on simply moves on.
  useEffect(() => {
    if (ended && overlayKind === 'ended' && canAutoplay) goNext(true);
  }, [ended, overlayKind, canAutoplay, goNext]);

  useEffect(() => {
    if (overlayKind !== 'finished') return undefined;
    const timer = setTimeout(onStop, FINISHED_DURATION_MS);
    return () => clearTimeout(timer);
  }, [overlayKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever appears takes the remote, unless you're in the middle of using the controls.
  const overlayHasKeys = Boolean(overlay) && mode !== MODE.PANEL && mode !== MODE.CONTROLS;
  useEffect(() => {
    if (!overlayHasKeys) return;
    setMode(MODE.HIDDEN);
    setTimeout(() => focusOn('.upnext [data-nav]'));
  }, [overlayKind, overlayHasKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = (seconds) => control({ action: 'seekBy', value: seconds });
  const toggle = () => control({ action: 'toggle' });
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    onSpeedChange(next);
    control({ action: 'speed', value: next });
  };

  const scrubBy = (seconds) => {
    if (!Number.isFinite(time.duration)) return;
    const from = scrub === null ? time.position : scrub;
    const to = Math.min(time.duration, Math.max(0, from + seconds));
    setScrub(to);
    clearTimeout(scrubTimer.current);
    scrubTimer.current = setTimeout(() => {
      control({ action: 'seekTo', value: to });
      setScrub(null);
    }, SCRUB_COMMIT_DELAY_MS);
  };

  const moveInBar = (step) => {
    const buttons = Array.prototype.slice.call(rootRef.current.querySelectorAll('.bar__buttons [data-nav]'));
    const next = buttons[buttons.indexOf(document.activeElement) + step];
    if (next) next.focus();
  };

  const moveInPanel = (step) => {
    const items = Array.prototype.slice.call(rootRef.current.querySelectorAll('.subs [data-nav]'));
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement);
    const next = items[current === -1 ? 0 : Math.min(items.length - 1, Math.max(0, current + step))];
    next.focus();
    if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest' });
  };

  const inTextBox = () => document.activeElement && document.activeElement.tagName === 'INPUT';

  const moveInOverlay = (step) => {
    const actions = Array.prototype.slice.call(rootRef.current.querySelectorAll('.upnext [data-nav]'));
    if (actions.length === 0) return;
    const index = actions.indexOf(document.activeElement);
    const target = actions[Math.min(actions.length - 1, Math.max(0, index + step))];
    target.focus();
  };

  const dismissOverlay = () => {
    if (overlayKind === 'advancing') episodes.cancel();
    else if (overlayKind === 'failed') episodes.clearFailed();
    else if (overlayKind === 'countdown') setDismissed(true);
    else onStop();
  };

  const overlayKeys = {
    LEFT: () => moveInOverlay(-1),
    RIGHT: () => moveInOverlay(1),
    UP: () => moveInOverlay(-1),
    DOWN: () => moveInOverlay(1),
    ENTER: () => {
      if (document.activeElement && document.activeElement.matches('.upnext [data-nav]')) document.activeElement.click();
      else moveInOverlay(0);
    },
    BACK: dismissOverlay,
    STOP: onStop,
  };

  useRemoteKeys(overlayHasKeys ? overlayKeys : {
    LEFT: (e) => {
      touch();
      if (mode === MODE.PANEL) {
        if (inTextBox()) return;
        moveInPanel(-1);
      } else if (mode === MODE.CONTROLS) {
        if (activeNav() === 'seek') scrubBy(-SCRUB_STEP_SECONDS);
        else moveInBar(-1);
      } else {
        skip(-SKIP_SECONDS);
        setMode(MODE.PEEK);
      }
      e.preventDefault();
    },
    RIGHT: (e) => {
      touch();
      if (mode === MODE.PANEL) {
        if (inTextBox()) return;
        moveInPanel(1);
      } else if (mode === MODE.CONTROLS) {
        if (activeNav() === 'seek') scrubBy(SCRUB_STEP_SECONDS);
        else moveInBar(1);
      } else {
        skip(SKIP_SECONDS);
        setMode(MODE.PEEK);
      }
      e.preventDefault();
    },
    UP: () => {
      touch();
      if (mode === MODE.PANEL) moveInPanel(-1);
      else if (mode === MODE.CONTROLS) focusOn('[data-nav="seek"]');
      else showControls();
    },
    DOWN: () => {
      touch();
      if (mode === MODE.PANEL) moveInPanel(1);
      else if (mode === MODE.CONTROLS) {
        if (activeNav() === 'seek') focusOn('[data-nav="play"]');
      } else showControls();
    },
    ENTER: () => {
      touch();
      if (mode === MODE.PANEL || mode === MODE.CONTROLS) {
        const active = document.activeElement;
        if (!active || active === document.body) return;
        if (active.tagName === 'INPUT') active.focus();
        else if (activeNav() === 'seek') toggle();
        else active.click();
      } else {
        toggle();
        setMode(MODE.PEEK);
      }
    },
    BACK: () => {
      touch();
      if (mode === MODE.PANEL) closePanel();
      else if (mode === MODE.CONTROLS) setMode(MODE.HIDDEN);
      else showControls('[data-nav="stop"]');
    },
    PLAY: () => { control({ action: 'play' }); peek(); },
    PAUSE: () => { control({ action: 'pause' }); peek(); },
    REWIND: () => { skip(-SKIP_SECONDS); peek(); },
    FAST_FORWARD: () => { skip(SKIP_SECONDS); peek(); },
    STOP: onStop,
  });

  // Magic Remote pointer: any movement brings the controls up.
  const onPointerMove = () => {
    touch();
    if (mode === MODE.HIDDEN || mode === MODE.PEEK) setMode(MODE.CONTROLS);
  };

  const onTimeUpdate = (event) => {
    const { currentTime, duration } = event.target;
    setTime({ position: currentTime, duration });
  };

  const barVisible = mode !== MODE.HIDDEN && mode !== MODE.PANEL;
  const { selection, cues, embeddedText, delay, prefs } = subtitles;
  const subtitleText = selection.kind === 'embedded' ? embeddedText : selection.kind === 'file' ? cueTextAt(cues, time.position, delay) : null;

  return (
    <div className="player" ref={rootRef} onMouseMove={onPointerMove}>
      <video
        ref={videoRef}
        className="player__video"
        onTimeUpdate={onTimeUpdate}
        onPlay={() => {
          setPaused(false);
          setEnded(false);
        }}
        onEnded={() => setEnded(true)}
        onLoadedMetadata={(event) => {
          // Loading resets the speed, which carries across episodes.
          event.target.playbackRate = speed;
        }}
        onPause={() => setPaused(true)}
        onClick={() => showControls()}
      />
      {subtitleText && (
        <div className={`caption caption--${prefs.size} ${prefs.background ? 'caption--boxed' : ''} ${barVisible ? 'caption--raised' : ''}`}>
          <span className="caption__text">{subtitleText}</span>
        </div>
      )}
      {barVisible && (
        <ControlBar
          title={media.title}
          time={time}
          scrub={scrub}
          paused={paused}
          speed={speed}
          compact={mode === MODE.PEEK}
          subtitlesOn={selection.kind !== 'none'}
          onSeek={(to) => control({ action: 'seekTo', value: to })}
          onSkip={skip}
          onToggle={toggle}
          onStop={onStop}
          onOpenSubtitles={() => openPanel('subtitles')}
          onOpenQuality={() => openPanel('quality')}
          episodeLabel={episodes.current ? episodes.current.label : null}
          hasNext={Boolean(episodes.nextEpisode)}
          hasEpisodes={Boolean(episodes.current || episodes.nextEpisode || episodes.previousEpisode)}
          onNext={() => episodes.next()}
          onOpenEpisodes={() => openPanel('episodes')}
          qualityLabel={qualityLabel(player, versions)}
          onCycleSpeed={cycleSpeed}
        />
      )}
      {mode === MODE.PANEL && panel === 'subtitles' && <SubtitlePanel title={media.title} subtitles={subtitles} onClose={closePanel} />}
      {mode === MODE.PANEL && panel === 'episodes' && <EpisodesPanel episodes={episodes} onClose={closePanel} />}
      {overlay && mode !== MODE.PANEL && (
        <UpNext
          overlay={overlay}
          onPlayNow={() => episodes.next()}
          onDismiss={() => setDismissed(true)}
          onStop={onStop}
          onRetry={() => episodes.next()}
          onCancelAdvance={() => episodes.cancel()}
          onKeepWatching={() => {
            episodes.unattendedRef.current = 0;
            episodes.next();
          }}
        />
      )}
      {mode === MODE.PANEL && panel === 'quality' && <QualityPanel player={player} versions={versions} currentVersion={media.castId} onSwitchVersion={onSwitchVersion} onClose={closePanel} />}
    </div>
  );
}
