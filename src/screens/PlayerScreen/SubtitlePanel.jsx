import { useState } from 'react';
import { PanelItem as Item } from './PanelItem';

const DELAY_STEP = 0.5;
const SIZES = ['small', 'medium', 'large'];
const SOURCE_NAMES = { page: 'From this website', folder: 'From your computer' };
const focusOnHover = (event) => event.currentTarget.focus();

/** Removes tags like [English] that a page title adds, for a better search. */
const searchableTitle = (title) => (title || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

function Stepper({ name, value, onLower, onRaise }) {
  return (
    <div className="subs__stepper">
      <span className="subs__stepper-name">{name}</span>
      <button type="button" data-nav="step" className="subs__step" aria-label={`Lower ${name}`} onClick={onLower} onMouseEnter={focusOnHover}>−</button>
      <span className="subs__value">{value}</span>
      <button type="button" data-nav="step" className="subs__step" aria-label={`Raise ${name}`} onClick={onRaise} onMouseEnter={focusOnHover}>+</button>
    </div>
  );
}

/** Choosing subtitles from each source, and how they look. */
export function SubtitlePanel({ title, subtitles, onClose }) {
  const { tracks, embedded, onlineSearch, selection, delay, results, busy, error, prefs, setDelay, updatePrefs, turnOff, selectFile, selectEmbedded, search, refresh } = subtitles;
  const [query, setQuery] = useState(searchableTitle(title));
  const [language, setLanguage] = useState(prefs.language || 'en');

  const isFile = (id) => selection.kind === 'file' && selection.id === id;
  const sourceTracks = (source) => tracks.filter((track) => track.source === source);
  const sizeIndex = SIZES.indexOf(prefs.size);
  const setSize = (step) => {
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, sizeIndex + step))];
    updatePrefs({ size: next });
  };

  return (
    <aside className="subs" aria-label="Subtitles">
      <h2 className="subs__title">Subtitles</h2>
      {busy && <p className="subs__status">Loading…</p>}
      {error && <p className="subs__status subs__status--error">{error}</p>}

      <div className="subs__scroll">
        <Item label="Off" selected={selection.kind === 'none'} onClick={turnOff} />

        {embedded.length > 0 && <h3 className="subs__heading">In this video</h3>}
        {embedded.map((track) => (
          <Item
            key={track.index}
            label={track.label}
            selected={selection.kind === 'embedded' && selection.id === track.index}
            onClick={() => selectEmbedded(track.index)}
          />
        ))}

        {['page', 'folder'].map((source) => (
          sourceTracks(source).length > 0 && (
            <div key={source}>
              <h3 className="subs__heading">{SOURCE_NAMES[source]}</h3>
              {sourceTracks(source).map((track) => (
                <Item key={track.id} label={track.label} selected={isFile(track.id)} onClick={() => selectFile(track)} />
              ))}
            </div>
          )
        ))}

        {tracks.length === 0 && embedded.length === 0 && <p className="subs__empty">None found yet. Add a file to the subtitles folder on your computer, then choose Refresh.</p>}

        <Item label="Refresh list" onClick={refresh} />

        <h3 className="subs__heading">Search online</h3>
        {onlineSearch ? (
          <div>
            <input data-nav="input" className="subs__input" aria-label="Search for subtitles" value={query} onChange={(e) => setQuery(e.target.value)} onMouseEnter={focusOnHover} />
            <input data-nav="input" className="subs__input subs__input--short" aria-label="Language code" value={language} onChange={(e) => setLanguage(e.target.value)} onMouseEnter={focusOnHover} />
            <Item label="Search" onClick={() => search(query, language)} />
            {results && results.length === 0 && <p className="subs__empty">Nothing found. Try a different title.</p>}
            {results && results.map((result) => {
              const id = `online:${result.fileId}`;
              return <Item key={id} label={result.label} detail={result.language} selected={isFile(id)} onClick={() => selectFile({ id, language: result.language })} />;
            })}
          </div>
        ) : (
          <p className="subs__empty">Add a free OpenSubtitles API key on your computer to turn this on.</p>
        )}

        <h3 className="subs__heading">Timing and appearance</h3>
        <Stepper
          name="Delay"
          value={`${delay > 0 ? '+' : ''}${delay.toFixed(1)} s`}
          onLower={() => setDelay(delay - DELAY_STEP)}
          onRaise={() => setDelay(delay + DELAY_STEP)}
        />
        <Stepper name="Size" value={prefs.size} onLower={() => setSize(-1)} onRaise={() => setSize(1)} />
        <Item label="Background behind text" selected={prefs.background} onClick={() => updatePrefs({ background: !prefs.background })} />
        <Item label="Done" onClick={onClose} />
      </div>
    </aside>
  );
}
