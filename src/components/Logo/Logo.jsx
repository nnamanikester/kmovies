import { APP_CONFIG } from '../../config/app.config';
import './Logo.css';

export function Logo() {
  return (
    <div className="logo">
      <span className="logo__mark" aria-hidden="true" />
      <span className="logo__name">{APP_CONFIG.APP_NAME}</span>
    </div>
  );
}
