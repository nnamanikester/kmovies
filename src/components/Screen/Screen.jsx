import './Screen.css';

/** Full-screen, centred layout that respects the TV safe area. */
export function Screen({ children }) {
  return <main className="screen">{children}</main>;
}
