import { useMemo } from 'react';
import { siteName } from '../site';
import { Favicon } from './Favicon';

const MAX_TILES = 12;
const SECTIONS_ORDER = (history) => [...history].sort((a, b) => (b.visits || 0) - (a.visits || 0));

function Tiles({ heading, items, onOpen }) {
  if (items.length === 0) return null;
  return (
    <section className="start__section">
      <h2>{heading}</h2>
      <ul className="start__tiles">
        {items.map((item) => (
          <li key={item.url}>
            <button type="button" className="tile" title={item.url} onClick={() => onOpen(item.url)}>
              <Favicon url={item.url} size={32} />
              <span className="tile__name">{item.title || siteName(item.url)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What a new tab shows: your bookmarks and most visited sites. */
export function StartPage({ library, onOpen }) {
  const frequent = useMemo(() => {
    const bySite = new Map();
    SECTIONS_ORDER(library.history).forEach((entry) => {
      const site = siteName(entry.url);
      if (!bySite.has(site)) bySite.set(site, entry);
    });
    return [...bySite.values()].slice(0, MAX_TILES);
  }, [library.history]);

  return (
    <div className="start">
      <h1 className="start__title">KMovies</h1>
      <p className="start__hint">Go to any website and play a video. It starts on your TV.</p>
      <Tiles heading="Bookmarks" items={library.bookmarks.slice(0, MAX_TILES)} onOpen={onOpen} />
      <Tiles heading="Most visited" items={frequent} onOpen={onOpen} />
    </div>
  );
}
