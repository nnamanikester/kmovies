const focusOnHover = (event) => event.currentTarget.focus();

/** One choice in a side panel, usable with the remote or its pointer. */
export function PanelItem({ label, detail, selected, onClick }) {
  return (
    <button type="button" data-nav="item" className={`subs__item ${selected ? 'subs__item--selected' : ''}`} onClick={onClick} onMouseEnter={focusOnHover}>
      <span className="subs__check">{selected ? '✓' : ''}</span>
      <span className="subs__label">{label}</span>
      {detail && <small className="subs__detail">{detail}</small>}
    </button>
  );
}
