import { useMemo, useRef, useState } from "react";

import { slugifyOrganizationName } from "../../../packages/utils/organizationName";
import { BindersnapLogoMark } from "./BindersnapLogoMark";

/**
 * Where a person names the organization that will own their binders.
 *
 * This is the only place an organization gets created. Signup used to do it
 * silently, deriving a name from the username that nobody chose and nobody
 * could change — which meant the one thing an organization needs from its
 * owner was the one thing it never asked for.
 *
 * It is deliberately skippable. Reading is never gated (ADR 0004), so a wall
 * here would contradict the rule the API already enforces, and someone waiting
 * to be added to a colleague's organization should not be trapped in a form
 * that cannot help them. The prompt comes back when they try to author, which
 * is the moment an organization is actually required.
 */

interface OrganizationSetupPageProps {
  /** From the signup form, so the field arrives filled rather than blank. */
  suggestedName?: string | null;
  /**
   * Whether this would be their first. Only the first gets a trial, so this
   * decides whether we may promise one.
   */
  isFirstOrganization: boolean;
  /** Why they are here: a write they tried, or their own navigation. */
  reason?: "blocked-write" | null;
  onCreate: (name: string) => Promise<void>;
  onSkip: () => void;
}

export function OrganizationSetupPage({
  suggestedName,
  isFirstOrganization,
  reason = null,
  onCreate,
  onSkip,
}: OrganizationSetupPageProps) {
  const [name, setName] = useState(suggestedName?.trim() ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const slug = useMemo(() => slugifyOrganizationName(name), [name]);
  const canSubmit = slug !== "" && !isSubmitting;

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
          <h1>
            {reason === "blocked-write"
              ? "Name your organization to start writing"
              : "Create your organization"}
          </h1>

          <p style={{ color: "var(--bs-text-muted)" }}>
            {/* The reason, not the mechanics. Ownership is the whole point of
                the level: a binder belongs to the organization, so it stays
                when the person who wrote it leaves. */}
            Your binders belong to an organization, not to you personally — so
            they stay put when people join and leave.
          </p>

          <form
            className="app-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!canSubmit) return;

              setIsSubmitting(true);
              setError(null);
              try {
                await onCreate(name.trim());
              } catch (createError) {
                if (isMounted.current) {
                  setError(
                    createError instanceof Error &&
                      createError.message.trim() !== ""
                      ? createError.message
                      : "Unable to create the organization.",
                  );
                }
              } finally {
                if (isMounted.current) {
                  setIsSubmitting(false);
                }
              }
            }}
          >
            <label className="app-field">
              <span className="bs-label">Organization name</span>
              <input
                className="bs-input"
                name="organization-name"
                type="text"
                autoComplete="organization"
                autoFocus
                placeholder="Mercy Health"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            {/* What they type is not what Gitea can be given, so show the
                address they are actually choosing before they commit to it. */}
            {slug ? (
              <p
                className="app-field-hint"
                style={{
                  color: "var(--bs-text-muted)",
                  fontSize: "var(--brand-text-sm)",
                }}
              >
                Your workspace address will be <code>{slug}</code>
              </p>
            ) : null}

            {isFirstOrganization ? (
              <p
                style={{
                  color: "var(--bs-text-muted)",
                  fontSize: "var(--brand-text-sm)",
                }}
              >
                Includes a 14-day trial. No card needed.
              </p>
            ) : null}

            <button
              className="bs-btn bs-btn-primary app-submit"
              type="submit"
              disabled={!canSubmit}
            >
              {isSubmitting ? "Creating…" : "Create organization"}
            </button>
          </form>

          {error ? <p className="app-inline-error">{error}</p> : null}

          {/* No "join" field: binders are private, so letting anyone type an
              organization's name and join it would hand them the contents.
              Being added is something an owner does. */}
          <p
            style={{
              color: "var(--bs-text-muted)",
              fontSize: "var(--brand-text-sm)",
            }}
          >
            Joining one that already exists? Ask an owner to add you — it will
            show up here once they do.
          </p>

          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--bs-text-muted)",
              fontSize: "var(--brand-text-sm)",
              fontFamily: "var(--brand-font-sans)",
              textAlign: "left",
            }}
            onClick={() => onSkip()}
          >
            Skip for now
          </button>
        </div>
      </div>
    </section>
  );
}
