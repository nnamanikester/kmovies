import { Logo, Screen, Spinner } from '../../components';
import './SplashScreen.css';

export function SplashScreen({ message }) {
  return (
    <Screen>
      <Logo />
      <Spinner />
      <p className="splash__message">{message}</p>
    </Screen>
  );
}
