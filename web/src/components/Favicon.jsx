import { useEffect, useState } from 'react';
import { siteName } from '../site';

/** A site's icon, or its first letter when it has none. */
export function Favicon({ url, src, size = 16 }) {
  const [failed, setFailed] = useState(false);
  const icon = src || (/^https?:/.test(url || '') ? `${new URL(url).origin}/favicon.ico` : null);

  useEffect(() => setFailed(false), [icon]);

  if (!icon || failed) {
    const letter = /^https?:/.test(url || '') ? siteName(url)[0].toUpperCase() : '';
    return <span className="favicon favicon--letter" style={{ width: size, height: size, fontSize: size * 0.65 }} aria-hidden="true">{letter}</span>;
  }
  return <img className="favicon" src={icon} width={size} height={size} alt="" onError={() => setFailed(true)} />;
}
