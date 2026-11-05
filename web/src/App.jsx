import { useCallback, useEffect, useRef, useState } from 'react';
import { CastBar } from './components/CastBar';
import { PageDialog } from './components/PageDialog';
import { RemoteView } from './components/RemoteView';
import { StartPage } from './components/StartPage';
import { TabStrip } from './components/TabStrip';
import { Toolbar } from './components/Toolbar';
import { useServer } from './useServer';

export default function App() {
  const viewRef = useRef(null);
  const toolbarRef = useRef(null);
  const onFrame = useCallback((blob) => viewRef.current?.showFrame(blob), []);
  const { connected, hasToken, state, library, cursor, selection, pageSize, send } = useServer(onFrame);
  const [fullscreen, setFullscreen] = useState(false);
  const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId);
  const isBlank = !activeTab || !/^https?:/.test(activeTab.url);

  const shortcuts = useCallback((action) => {
    if (action === 'address') toolbarRef.current?.focusAddress();
    else send({ type: action });
  }, [send]);

  useEffect(() => {
    document.title = activeTab?.title ? `${activeTab.title} · KMovies` : 'KMovies';
  }, [activeTab?.title]);

  // Typing goes to the page unless you're in KMovies' own fields.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target === document.body) viewRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    if (isBlank) toolbarRef.current?.focusAddress();
    else if (document.activeElement === document.body) viewRef.current?.focus();
  }, [state?.activeTabId, isBlank]);

  if (!hasToken) {
    return (
      <main className="message">
        <h1>KMovies</h1>
        <p>Open the link shown in the terminal where KMovies is running, or scan its QR code.</p>
      </main>
    );
  }

  const open = (url) => send({ type: 'navigate', url });
  const isBookmarked = Boolean(activeTab && library.bookmarks.some((item) => item.url === activeTab.url));

  return (
    <main className={`app ${fullscreen ? 'app--fullscreen' : ''}`}>
      {!fullscreen && <TabStrip tabs={state?.tabs ?? []} activeId={state?.activeTabId} send={send} />}
      {!fullscreen && (
        <Toolbar
          ref={toolbarRef}
          tab={activeTab}
          connected={connected}
          library={library}
          isBookmarked={isBookmarked}
          send={send}
          onDone={() => viewRef.current?.focus()}
        />
      )}
      <div className={`loading ${activeTab?.loading ? 'loading--on' : ''}`} role="progressbar" aria-hidden={!activeTab?.loading} aria-label="Page loading" />

      <div className="viewport">
        <RemoteView ref={viewRef} send={send} connected={connected} cursor={cursor} selection={selection} pageSize={pageSize} onShortcut={shortcuts} />
        {isBlank && state && <StartPage library={library} onOpen={open} />}
        {state?.dialog && <PageDialog dialog={state.dialog} send={send} onDone={() => viewRef.current?.focus()} />}
      </div>

      {state?.notice && (
        <p className="banner">
          <span>{state.notice}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => send({ type: 'dismissNotice' })}>×</button>
        </p>
      )}

      <CastBar state={state} send={send} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen((on) => !on)} />
    </main>
  );
}
