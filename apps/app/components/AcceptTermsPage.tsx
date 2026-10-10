import { useState } from "react";

import type { LegalStatusPayload } from "../../../packages/api-schema/schemas/legal";
import { acceptLegal } from "../api";
import { AgreementCheckbox } from "./AgreementCheckbox";
import { AuthShell } from "./AuthShell";

/**
 * What a signed-in account sees when the Terms it is on are no longer the
 * ones we ask for: after a material change, or with no agreement on record.
 *
 * One box for the person, and one for each organization they own that has
 * not accepted, because the organization is the Customer the Terms are with.
 * Every box has to be ticked to go on; signing out is the other way out.
 */
export function AcceptTermsPage({
  status,
  onAccepted,
  onSignOut,
}: {
  status: LegalStatusPayload;
  onAccepted: (next: LegalStatusPayload) => void;
  onSignOut: () => Promise<void>;
}) {
  const [person, setPerson] = useState(false);
  const [organizations, setOrganizations] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const allTicked =
    (!status.person || person) &&
    status.organizations.every((organization) =>
      organizations.has(organization.name),
    );

  const accept = async () => {
    if (!allTicked) {
      setError("Tick each box to accept the Terms and go on.");
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      onAccepted(
        await acceptLegal({
          acceptedTerms: status.version,
          person: status.person,
          organizations: status.organizations.map(
            (organization) => organization.name,
          ),
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Your acceptance could not be saved. Try again.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AuthShell title="Accept our updated Terms.">
      <p className="app-gate-copy">
        Our Terms of Service have changed, or we have no record of your
        accepting them. Read them, then accept them to go on.
      </p>
      <form
        className="app-form"
        onSubmit={(event) => {
          event.preventDefault();
          void accept();
        }}
      >
        {status.person ? (
          <AgreementCheckbox
            scope="person"
            checked={person}
            onChange={setPerson}
          />
        ) : null}
        {status.organizations.map((organization) => (
          <AgreementCheckbox
            key={organization.name}
            scope="organization"
            organization={organization.displayName}
            checked={organizations.has(organization.name)}
            onChange={(checked) =>
              setOrganizations((current) => {
                const next = new Set(current);
                if (checked) next.add(organization.name);
                else next.delete(organization.name);
                return next;
              })
            }
          />
        ))}
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="submit"
          disabled={isBusy}
        >
          {isBusy ? "Saving…" : "Accept and continue"}
        </button>
      </form>
      {error ? (
        <p className="app-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="app-login-switch">
        <span>Not ready to accept?</span>
        <button
          className="app-login-switch-button"
          type="button"
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
