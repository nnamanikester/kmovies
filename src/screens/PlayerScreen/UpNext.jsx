const focusOnHover = (event) => event.currentTarget.focus();

function Action({ label, onClick, primary }) {
  return (
    <button type="button" data-nav="upnext" className={`upnext__action ${primary ? 'upnext__action--primary' : ''}`} onClick={onClick} onMouseEnter={focusOnHover}>
      {label}
    </button>
  );
}

/** What's coming next, or a question or message about it. Sits over the video. */
export function UpNext({ overlay, onPlayNow, onDismiss, onStop, onRetry, onCancelAdvance, onKeepWatching }) {
  const { kind, label, seconds, total } = overlay;

  if (kind === 'advancing') {
    return (
      <div className="upnext upnext--center" role="status">
        <div className="upnext__spinner" />
        <p className="upnext__title">Loading {label}…</p>
        <div className="upnext__actions"><Action label="Cancel" onClick={onCancelAdvance} /></div>
      </div>
    );
  }
  if (kind === 'failed') {
    return (
      <div className="upnext upnext--center" role="alert">
        <p className="upnext__title">{label} didn’t start</p>
        <p className="upnext__text">The website didn’t play it. It may need you to sign in, or a Premium plan. You can check on your computer.</p>
        <div className="upnext__actions">
          <Action primary label="Try again" onClick={onRetry} />
          <Action label="Stop" onClick={onStop} />
        </div>
      </div>
    );
  }
  if (kind === 'still-watching') {
    return (
      <div className="upnext upnext--center" role="alertdialog" aria-label="Are you still watching?">
        <p className="upnext__title">Are you still watching?</p>
        <div className="upnext__actions">
          <Action primary label="Keep watching" onClick={onKeepWatching} />
          <Action label="Stop" onClick={onStop} />
        </div>
      </div>
    );
  }
  if (kind === 'finished') {
    return (
      <div className="upnext upnext--center" role="status">
        <p className="upnext__title">You’ve finished this series</p>
        <div className="upnext__actions"><Action primary label="Close" onClick={onStop} /></div>
      </div>
    );
  }
  if (kind === 'ended') {
    return (
      <div className="upnext upnext--center" role="status">
        <p className="upnext__title">Next: {label}</p>
        <div className="upnext__actions">
          <Action primary label="Play now" onClick={onPlayNow} />
          <Action label="Stop" onClick={onStop} />
        </div>
      </div>
    );
  }
  const progress = total ? ((total - seconds) / total) * 100 : 0;
  return (
    <div className="upnext upnext--corner" role="status">
      <p className="upnext__kicker">Next episode in {seconds}s</p>
      <p className="upnext__title">{label}</p>
      <div className="upnext__bar"><div className="upnext__fill" style={{ width: `${progress}%` }} /></div>
      <div className="upnext__actions">
        <Action primary label="Play now" onClick={onPlayNow} />
        <Action label="Cancel" onClick={onDismiss} />
      </div>
    </div>
  );
}
