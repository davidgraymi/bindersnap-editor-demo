import type { ReactNode } from "react";

import { BindersnapLogoMark } from "./BindersnapLogoMark";

/**
 * The centred card the signed-out pages share — reset, unsubscribe — drawn
 * the way the sign-in form is, so arriving from an email looks like arriving
 * at Bindersnap.
 */
export function AuthShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="app-login-shell">
      <div className="app-login-wrap">
        <div className="app-login-logo">
          <div className="app-login-logo-mark" aria-hidden="true">
            <BindersnapLogoMark width={24} height={24} />
          </div>
          <span className="app-login-logo-text">Bindersnap</span>
        </div>
        <div className="app-login-panel bs-card">
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </section>
  );
}
