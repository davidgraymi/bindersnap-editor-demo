import { useEffect, useState } from "react";

import { acceptInvitation, fetchInvitation } from "../api";
import { navigateToHref } from "../appLink";
import { rememberReturnTo } from "../authReturn";
import type { SessionUser } from "../../../packages/api-schema/schemas/auth";
import type { InvitationSummary } from "../../../packages/api-schema/schemas/invitations";
import { AuthShell } from "./AuthShell";

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

/**
 * `/-/invitations/{token}`: where an invitation email lands.
 *
 * Says what it is before asking anything. Signed out, it offers to make an
 * account with the invited address or to sign in, and comes back here after
 * either. Signed in, Accept — which the API only honours for the account
 * whose address was invited.
 */
export function InvitationPage({
  token,
  user,
}: {
  token: string;
  user: SessionUser | null;
}) {
  const [summary, setSummary] = useState<InvitationSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [invitedEmail] = useState(
    () => new URLSearchParams(window.location.search).get("email") ?? "",
  );

  useEffect(() => {
    let cancelled = false;
    fetchInvitation(token)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(messageOf(err, "This invitation link does not work."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.username]);

  const here = `/-/invitations/${encodeURIComponent(token)}${
    invitedEmail ? `?email=${encodeURIComponent(invitedEmail)}` : ""
  }`;

  if (loadError) {
    return (
      <AuthShell title="This invitation link does not work.">
        <p className="app-gate-copy">
          It may have been sent again since, which retires the old link. Use the
          newest email, or ask whoever invited you to send another.
        </p>
      </AuthShell>
    );
  }

  if (!summary) {
    return (
      <AuthShell title="Opening your invitation…">
        <p className="app-gate-copy" role="status">
          One moment.
        </p>
      </AuthShell>
    );
  }

  const org = summary.organizationName;

  if (summary.status === "joined" && summary.acceptedByYou) {
    return (
      <AuthShell title={`You are in ${org}.`}>
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="button"
          onClick={() => navigateToHref(`/${summary.organization}`)}
        >
          Open {org}
        </button>
      </AuthShell>
    );
  }

  if (waiting || (summary.status === "accepted" && summary.acceptedByYou)) {
    return (
      <AuthShell title="Accepted.">
        <p className="app-gate-copy" role="status">
          You will be in {org} as soon as one of its owners is next on
          Bindersnap — usually within minutes. Nothing else to do.
        </p>
      </AuthShell>
    );
  }

  if (summary.status !== "pending") {
    return (
      <AuthShell title="This invitation no longer works.">
        <p className="app-gate-copy">
          {summary.status === "expired"
            ? "It has expired. "
            : summary.status === "revoked"
              ? "It was withdrawn. "
              : "It was already accepted. "}
          Ask {summary.invitedBy} for a new one.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${org}.`}>
      <p className="app-gate-copy">
        {summary.invitedBy} invited {summary.email} to join {org} as{" "}
        {summary.grant}.
      </p>

      {user ? (
        <>
          <button
            className="bs-btn bs-btn-primary app-submit"
            type="button"
            disabled={working}
            onClick={() => {
              setWorking(true);
              setError(null);
              acceptInvitation(token)
                .then((status) => {
                  if (status === "joined") {
                    navigateToHref(`/${summary.organization}`);
                  } else {
                    setWaiting(true);
                  }
                })
                .catch((err) => {
                  setError(
                    messageOf(err, "The invitation could not be accepted."),
                  );
                  setWorking(false);
                });
            }}
          >
            {working ? "Joining…" : `Join ${org}`}
          </button>
          <p className="app-gate-copy">Signed in as {user.username}.</p>
        </>
      ) : (
        <>
          <button
            className="bs-btn bs-btn-primary app-submit"
            type="button"
            onClick={() => {
              rememberReturnTo(here);
              navigateToHref(
                `/-/signup${invitedEmail ? `?email=${encodeURIComponent(invitedEmail)}` : ""}`,
              );
            }}
          >
            Create your account
          </button>
          <div className="app-login-switch">
            <span>Already on Bindersnap?</span>
            <button
              className="app-login-switch-button"
              type="button"
              onClick={() => {
                rememberReturnTo(here);
                navigateToHref("/-/login");
              }}
            >
              Sign in
            </button>
          </div>
        </>
      )}
      {error ? <p className="app-inline-error">{error}</p> : null}
    </AuthShell>
  );
}
