import { Logo, Screen, Spinner } from '../../components';
import { useRemoteKeys } from '../../hooks/useRemoteKeys';
import { exitApp } from '../../services/platform';
import './WaitingScreen.css';

/** Shown while nothing is casting. */
export function WaitingScreen({ connected, server }) {
  useRemoteKeys({ BACK: exitApp });

  return (
    <Screen>
      <Logo />
      {connected ? (
        <div>
          <h1 className="waiting__title">Ready to cast</h1>
          <p className="waiting__text">Open a website in the KMovies web app and play a video.</p>
        </div>
      ) : (
        <div>
          <Spinner />
          <h1 className="waiting__title">Looking for your computer</h1>
          <p className="waiting__text">
            Run <code>npm start</code> on your computer, on the same network as this TV.
            {server ? ` Last seen at ${server.replace('http://', '')}.` : ''}
          </p>
        </div>
      )}
    </Screen>
  );
}
