import { siteName } from '../site';
import { Favicon } from './Favicon';

/** The open tabs. */
export function TabStrip({ tabs, activeId, send }) {
  return (
    <nav className="tabs" aria-label="Open tabs">
      <div className="tabs__list" role="tablist">
        {tabs.map((tab) => {
          const label = tab.title || (/^https?:/.test(tab.url) ? siteName(tab.url) : 'New tab');
          const isActive = tab.id === activeId;
          return (
            <div key={tab.id} role="presentation" className={`tab ${isActive ? 'tab--active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="tab__select"
                title={label}
                onClick={() => send({ type: 'activateTab', id: tab.id })}
                onAuxClick={(event) => {
                  if (event.button === 1) send({ type: 'closeTab', id: tab.id });
                }}
              >
                {tab.loading ? <span className="spinner" aria-label="Loading" /> : <Favicon url={tab.url} src={tab.favicon} />}
                <span className="tab__title">{label}</span>
              </button>
              <button type="button" className="tab__close" aria-label={`Close ${label}`} onClick={() => send({ type: 'closeTab', id: tab.id })}>×</button>
            </div>
          );
        })}
      </div>
      <button type="button" className="icon-button tabs__new" aria-label="New tab" title="New tab" onClick={() => send({ type: 'newTab' })}>+</button>
    </nav>
  );
}
