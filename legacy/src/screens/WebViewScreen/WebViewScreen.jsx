import { useRef, useState } from 'react';
import { SplashScreen } from '../SplashScreen/SplashScreen';
import './WebViewScreen.css';

/** Permissions the embedded site needs for video playback. */
const FRAME_ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture';

/**
 * Lets the site run normally (scripts, its own cookies/storage, forms, dialogs)
 * but NOT navigate the app's top window or open pop-ups — ad scripts use both to
 * hijack the whole app.
 */
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-presentation';

/**
 * Shows the (proxied) site full-screen. The splash stays on top until the
 * first page has loaded, since the first launch transpiles the site's code.
 */
export function WebViewScreen({ src }) {
  const frameRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = () => {
    setLoaded(true);
    // Hand remote-control key presses to the site.
    if (frameRef.current) frameRef.current.focus();
  };

  return (
    <div className="webview">
      <iframe
        ref={frameRef}
        className="webview__frame"
        src={src}
        title="site"
        allow={FRAME_ALLOW}
        sandbox={FRAME_SANDBOX}
        allowFullScreen
        onLoad={handleLoad}
      />
      {!loaded && (
        <div className="webview__overlay">
          <SplashScreen message="Loading… (the first launch can take a minute)" />
        </div>
      )}
    </div>
  );
}
