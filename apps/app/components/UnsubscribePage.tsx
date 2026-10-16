import { useState } from "react";

import { unsubscribeWithToken } from "../api";
import { navigateToHref } from "../appLink";
import { AuthShell } from "./AuthShell";

/**
 * `/-/unsubscribe?token=…`: where an email's "Unsubscribe" lands.
 *
 * A button, not an automatic unsubscribe on arrival: mail scanners open links
 * to check them, and one of those should not turn somebody's email off. Mail
 * clients that offer their own unsubscribe button POST to the API directly
 * (`List-Unsubscribe-Post`) and never come here.
 */
export function UnsubscribePage() {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
  );
  const [state, setState] = useState<"ready" | "working" | "done" | "error">(
    "ready",
  );

  if (!token) {
    return (
      <AuthShell title="This link is incomplete.">
        <p className="app-gate-copy">
          Open the unsubscribe link from the email again, or choose what you get
          in your account settings.
        </p>
        <SettingsButton />
      </AuthShell>
    );
  }

  if (state === "done") {
    return (
      <AuthShell title="You will not get change emails.">
        <p className="app-gate-copy" role="status">
          No more emails about reviews, requested changes or publishing.
          Password resets still come when you ask for one. You can turn any of
          them back on in your account settings.
        </p>
        <SettingsButton />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Stop change emails?">
      <p className="app-gate-copy">
        You will stop getting emails about reviews, requested changes and
        publishing. You can turn them back on, one at a time, in your account
        settings.
      </p>
      <button
        className="bs-btn bs-btn-primary app-submit"
        type="button"
        disabled={state === "working"}
        onClick={() => {
          setState("working");
          unsubscribeWithToken(token)
            .then(() => setState("done"))
            .catch(() => setState("error"));
        }}
      >
        {state === "working" ? "Turning off…" : "Turn off change emails"}
      </button>
      {state === "error" ? (
        <p className="app-inline-error">
          That did not go through. Try again, or turn emails off in your account
          settings.
        </p>
      ) : null}
    </AuthShell>
  );
}

function SettingsButton() {
  return (
    <div className="app-login-switch">
      <span>Signed in?</span>
      <button
        className="app-login-switch-button"
        type="button"
        onClick={() => navigateToHref("/-/user_settings/profile#email")}
      >
        Email settings
      </button>
    </div>
  );
}
