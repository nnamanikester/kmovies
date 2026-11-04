import { formatTime } from '../../services/format';

const focusOnHover = (event) => event.currentTarget.focus();

function PlayIcon() {
  return <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M7 4l14 8-14 8z" /></svg>;
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>;
}

function StopIcon() {
  return <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M5 5h14v14H5z" /></svg>;
}

function NextIcon() {
  return <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M5 4l11 8-11 8zM17 4h3v16h-3z" /></svg>;
}

/** Position, seek bar and buttons. `compact` shows just the position, after a skip. */
export function ControlBar({ title, time, scrub, paused, speed, compact, subtitlesOn, qualityLabel, episodeLabel, hasNext, hasEpisodes, onNext, onOpenEpisodes, onSeek, onSkip, onToggle, onStop, onOpenSubtitles, onOpenQuality, onCycleSpeed }) {
  const shown = scrub === null ? time.position : scrub;
  const hasLength = Number.isFinite(time.duration) && time.duration > 0;
  const progress = hasLength ? Math.min(100, (shown / time.duration) * 100) : 0;

  const onTrackClick = (event) => {
    if (!hasLength) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * time.duration);
  };

  const button = (nav, label, content, onClick, extraClass = '') => (
    <button type="button" data-nav={nav} className={`bar__button ${extraClass}`} aria-label={label} onClick={onClick} onMouseEnter={focusOnHover}>
      {content}
    </button>
  );

  return (
    <div className="bar">
      <p className="bar__title">{title}{episodeLabel ? <span className="bar__episode">{episodeLabel}</span> : null}</p>
      <div data-nav="seek" tabIndex={0} className="bar__track" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={hasLength ? time.duration : 0} aria-valuenow={shown} onClick={onTrackClick} onMouseEnter={focusOnHover}>
        <div className="bar__rail">
          <div className="bar__progress" style={{ width: `${progress}%` }} />
          <div className="bar__thumb" style={{ left: `${progress}%` }} />
        </div>
      </div>
      <p className="bar__time">
        {formatTime(shown)} / {formatTime(time.duration)}
        {compact ? '' : <span className="bar__hint">Up: seek bar. Back: hide.</span>}
      </p>
      {!compact && (
        <div className="bar__buttons">
          {button('back10', 'Back 10 seconds', '−10', () => onSkip(-10))}
          {button('play', paused ? 'Play' : 'Pause', paused ? <PlayIcon /> : <PauseIcon />, onToggle, 'bar__button--main')}
          {button('forward10', 'Forward 10 seconds', '+10', () => onSkip(10))}
          {hasNext && button('next', 'Next episode', <NextIcon />, onNext)}
          {button('stop', 'Stop', <StopIcon />, onStop)}
          {hasEpisodes && button('episodes', 'Episodes', 'EP', onOpenEpisodes, 'bar__button--text')}
          {button('subtitles', 'Subtitles', 'CC', onOpenSubtitles, subtitlesOn ? 'bar__button--on' : '')}
          {button('quality', 'Video quality', qualityLabel, onOpenQuality, 'bar__button--text')}
          {button('speed', 'Playback speed', `${speed}×`, onCycleSpeed)}
        </div>
      )}
    </div>
  );
}
