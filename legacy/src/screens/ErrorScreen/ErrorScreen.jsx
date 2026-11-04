import { Button, Logo, Screen } from '../../components';
import { APP_CONFIG } from '../../config/app.config';
import { useCountdown } from '../../hooks/useCountdown';
import { useFocusGroup } from '../../hooks/useFocusGroup';
import { useRemoteKeys } from '../../hooks/useRemoteKeys';
import { exitApp } from '../../services/platform';
import './ErrorScreen.css';

/** Full-screen error with Retry / Exit and an automatic retry countdown. */
export function ErrorScreen({ title, message, onRetry }) {
  const { register, move } = useFocusGroup();
  const secondsLeft = useCountdown(APP_CONFIG.AUTO_RETRY_SECONDS, onRetry);

  useRemoteKeys({
    LEFT: () => move(-1),
    RIGHT: () => move(1),
    BACK: exitApp,
  });

  return (
    <Screen>
      <Logo />
      <div>
        <h1 className="error__title">{title}</h1>
        <p className="error__text">{message}</p>
        <p className="error__hint">Retrying automatically in {secondsLeft}s</p>
      </div>
      <div className="error__actions">
        <Button ref={register(0)} onClick={onRetry}>
          Try again
        </Button>
        <Button ref={register(1)} variant="secondary" onClick={exitApp}>
          Exit
        </Button>
      </div>
    </Screen>
  );
}
