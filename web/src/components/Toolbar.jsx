import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { siteName } from '../site';
import { Favicon } from './Favicon';

const MAX_SUGGESTIONS = 7;

/** History and bookmarks matching what's typed, best first. */
function findSuggestions(text, library) {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  const seen = new Set();
  const score = (item, isBookmark) => {
    const url = item.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
    const title = (item.title || '').toLowerCase();
    if (!url.includes(query) && !title.includes(query)) return 0;
    return (url.startsWith(query) ? 100 : 0) + (title.startsWith(query) ? 30 : 0) + (isBookmark ? 40 : 0) + Math.min(item.visits || 0, 25);
  };
  return [
    ...library.bookmarks.map((item) => ({ ...item, score: score(item, true) })),
    ...library.history.map((item) => ({ ...item, score: score(item, false) })),
  ]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** Back, forward, reload, the address bar with suggestions, and the bookmark star. */
export const Toolbar = forwardRef(function Toolbar({ tab, connected, library, isBookmarked, send, onDone }, ref) {
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const url = tab && /^https?:/.test(tab.url) ? tab.url : '';

  useImperativeHandle(ref, () => ({
    focusAddress() {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }), []);

  useEffect(() => {
    if (!editing) setValue(url);
  }, [url, editing]);

  const suggestions = useMemo(() => (editing && typed ? findSuggestions(value, library) : []), [editing, typed, value, library]);

  const go = (address) => {
    if (!address.trim()) return;
    send({ type: 'navigate', url: address });
    setEditing(false);
    setTyped(false);
    setHighlighted(-1);
    inputRef.current?.blur();
    onDone();
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setHighlighted((index) => Math.min(suggestions.length - 1, index + 1));
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setHighlighted((index) => Math.max(-1, index - 1));
    } else if (event.key === 'Escape') {
      setValue(url);
      setEditing(false);
      setTyped(false);
      inputRef.current?.blur();
      onDone();
    }
  };

  const isSecure = url.startsWith('https:');

  return (
    <form
      className="toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        go(highlighted >= 0 ? suggestions[highlighted].url : value);
      }}
    >
      <button type="button" className="icon-button" aria-label="Back" title="Back" disabled={!tab?.canGoBack} onClick={() => send({ type: 'back' })}>‹</button>
      <button type="button" className="icon-button" aria-label="Forward" title="Forward" disabled={!tab?.canGoForward} onClick={() => send({ type: 'forward' })}>›</button>
      <button type="button" className="icon-button icon-button--small" aria-label="Reload" title="Reload" disabled={!url} onClick={() => send({ type: 'reload' })}>↻</button>

      <div className="address">
        <span className={`address__lock ${isSecure ? 'address__lock--secure' : ''}`} title={isSecure ? 'Secure connection' : 'Not a secure connection'} aria-hidden="true">
          {url ? <Favicon url={url} src={tab?.favicon} size={15} /> : '⌕'}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setTyped(true);
            setHighlighted(-1);
          }}
          onFocus={(event) => {
            setEditing(true);
            event.target.select();
          }}
          onBlur={() => {
            setEditing(false);
            setTyped(false);
          }}
          onKeyDown={onKeyDown}
          placeholder={connected ? 'Search or enter a website' : 'Connecting to your computer…'}
          inputMode="url"
          enterKeyHint="go"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck="false"
          aria-label="Search or enter a website"
          aria-expanded={suggestions.length > 0}
          role="combobox"
          aria-controls="address-suggestions"
        />
        {suggestions.length > 0 && (
          <ul className="suggestions" id="address-suggestions" role="listbox">
            {suggestions.map((item, index) => (
              <li key={item.url} role="option" aria-selected={index === highlighted}>
                {/* Mouse down, as a click would come after the address bar loses focus. */}
                <button
                  type="button"
                  tabIndex={-1}
                  className={`suggestion ${index === highlighted ? 'suggestion--on' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    go(item.url);
                  }}
                >
                  <Favicon url={item.url} />
                  <span className="suggestion__title">{item.title || siteName(item.url)}</span>
                  <small className="suggestion__url">{siteName(item.url)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className={`icon-button icon-button--small ${isBookmarked ? 'icon-button--on' : ''}`}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        aria-pressed={isBookmarked}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        disabled={!url}
        onClick={() => send({ type: 'toggleBookmark' })}
      >
        {isBookmarked ? '★' : '☆'}
      </button>
    </form>
  );
});
