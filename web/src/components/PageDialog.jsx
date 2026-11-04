import { useEffect, useRef, useState } from 'react';

/** A site's alert, confirm or prompt, which it's waiting on. */
export function PageDialog({ dialog, send, onDone }) {
  const [text, setText] = useState(dialog.defaultValue || '');
  const primaryRef = useRef(null);
  const needsAnswer = dialog.type !== 'alert';

  useEffect(() => primaryRef.current?.focus(), []);

  const answer = (accept) => {
    send({ type: 'dialog', accept, text: dialog.type === 'prompt' ? text : undefined });
    onDone();
  };

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Message from this page"
        onSubmit={(event) => {
          event.preventDefault();
          answer(true);
        }}
      >
        <p className="dialog__title">This page says</p>
        <p className="dialog__message">{dialog.type === 'beforeunload' ? 'Leave this page? Changes you made may not be saved.' : dialog.message}</p>
        {dialog.type === 'prompt' && <input ref={primaryRef} value={text} aria-label="Your answer" onChange={(event) => setText(event.target.value)} />}
        <div className="dialog__actions">
          {needsAnswer && <button type="button" className="chip" onClick={() => answer(false)}>Cancel</button>}
          <button ref={dialog.type === 'prompt' ? undefined : primaryRef} type="submit" className="chip chip--accent">OK</button>
        </div>
      </form>
    </div>
  );
}
