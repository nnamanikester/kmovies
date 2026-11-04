function describe(candidate) {
  if (candidate.hasDrm) return 'DRM-protected, can’t be cast';
  if (candidate.isLive) return 'Live';
  if (candidate.duration) return `${Math.round(candidate.duration / 60)} min`;
  if (candidate.bytes) return `${Math.round(candidate.bytes / (1024 * 1024))} MB`;
  return candidate.mediaType.toUpperCase();
}

/** Videos found on this page, so you can cast one that wasn't picked automatically. */
export function StreamList({ candidates, activeId, send }) {
  if (candidates.length === 0) return null;

  return (
    <details className="streams">
      <summary>Videos found on this page ({candidates.length})</summary>
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <span className="streams__info">
              <strong>{new URL(candidate.url).hostname}</strong>
              <small>{describe(candidate)}</small>
            </span>
            <button
              type="button"
              className="chip chip--accent"
              disabled={candidate.hasDrm || candidate.id === activeId}
              onClick={() => send({ type: 'cast', id: candidate.id })}
            >
              {candidate.id === activeId ? 'Casting' : 'Cast'}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
