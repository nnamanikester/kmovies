import { StreamList } from './StreamList';

/** The TV's status, what's casting, and the videos found on this page. */
export function CastBar({ state, send, fullscreen, onToggleFullscreen }) {
  return (
    <footer className="dock">
      <div className="dock__row">
        <span className={`tv-status ${state?.tvConnected ? 'tv-status--on' : ''}`}>
          {state?.tvConnected ? 'TV connected' : 'Looking for your TV'}
        </span>
        {state?.cast && (
          <p className="now-casting">
            <strong>On the TV: {state.cast.title}</strong>
            <small>{state.cast.status === 'waiting-for-tv' ? 'Waiting for the TV to connect.' : 'Control it with the TV remote.'}</small>
          </p>
        )}
        <StreamList candidates={state?.candidates ?? []} activeId={state?.cast?.id} send={send} />
        <label className="toggle">
          <input type="checkbox" checked={state?.autoCast ?? true} onChange={(event) => send({ type: 'autoCast', enabled: event.target.checked })} />
          Auto-cast
        </label>
        <button type="button" className="icon-button icon-button--small" aria-pressed={fullscreen} aria-label={fullscreen ? 'Show browser controls' : 'Hide browser controls'} title={fullscreen ? 'Show browser controls' : 'Hide browser controls'} onClick={onToggleFullscreen}>
          {fullscreen ? '⤡' : '⤢'}
        </button>
      </div>
    </footer>
  );
}
