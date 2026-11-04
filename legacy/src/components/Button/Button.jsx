import { forwardRef } from 'react';
import './Button.css';

/** Large, remote-focusable button. `variant`: "primary" | "secondary". */
export const Button = forwardRef(function Button({ variant = 'primary', children, ...props }, ref) {
  return (
    <button ref={ref} type="button" className={`button button--${variant}`} {...props}>
      {children}
    </button>
  );
});
