import { Building2, UserPlus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  RESERVED_ORGANIZATION_NAMES,
  slugifyOrganizationName,
} from "../../../packages/utils/organizationName";
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
  /** Who they are, for the message they send an owner to be added. */
  username: string;
  fullName?: string | null;
  /**
   * Whether an organization has added them yet. Asked every few seconds while
   * they wait, so the page moves on by itself the moment an owner adds them.
   */
  checkForOrganization: () => Promise<boolean>;
  /** An owner added them; take them into it. */
  onJoined: () => void | Promise<void>;
}

type SetupStep = "choose" | "create" | "join";

export function OrganizationSetupPage({
  suggestedName,
  isFirstOrganization,
  reason = null,
  onCreate,
  onSkip,
  username,
  fullName = null,
  checkForOrganization,
  onJoined,
}: OrganizationSetupPageProps) {
  // **Two ways in, asked first.** Somebody whose team already uses Bindersnap
  // used to land on "Create your organization" and, reasonably, create one —
  // a second, empty organization with its own trial, while their colleagues'
  // binders sat in the first. Asked only of somebody with no organization
  // yet: anybody who has one is here to make another.
  const [step, setStep] = useState<SetupStep>(
    isFirstOrganization && reason === null ? "choose" : "create",
  );
  const [path, setPath] = useState<"create" | "join">("create");
  const [name, setName] = useState(suggestedName?.trim() ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  // The address the server will give it, reserved names included, so the
  // preview never promises `/help` and delivers `/help-org`.
  const slug = useMemo(() => {
    const derived = slugifyOrganizationName(name);
    return RESERVED_ORGANIZATION_NAMES.has(derived)
      ? `${derived}-org`
      : derived;
  }, [name]);
  const canSubmit = slug !== "" && !isSubmitting;

  const shell = (children: ReactNode) => (
    <section className="app-login-shell">
      <div className="app-login-wrap">
        <div className="app-login-logo">
          <div className="app-login-logo-mark" aria-hidden="true">
            <BindersnapLogoMark width={24} height={24} />
          </div>
          <span className="app-login-logo-text">Bindersnap</span>
        </div>
        <div className="app-login-panel bs-card">{children}</div>
      </div>
    </section>
  );

  if (step === "choose") {
    return shell(
      <>
        <h1>Welcome to Bindersnap</h1>
        <p className="org-setup-lede">
          Is your team already using Bindersnap, or are you the first?
        </p>
        <form
          className="app-form"
          onSubmit={(event) => {
            event.preventDefault();
            setStep(path);
          }}
        >
          <div role="radiogroup" aria-label="How you are joining">
            <label className="bs-choice">
              <input
                type="radio"
                name="org-setup-path"
                checked={path === "create"}
                onChange={() => setPath("create")}
              />
              <Building2
                className="bs-choice-icon"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                <span className="bs-choice-name">Start a new organization</span>
                <span className="bs-choice-note">
                  You are setting Bindersnap up for your team. Includes a 14-day
                  trial.
                </span>
              </span>
            </label>
            <label className="bs-choice">
              <input
                type="radio"
                name="org-setup-path"
                checked={path === "join"}
                onChange={() => setPath("join")}
              />
              <UserPlus
                className="bs-choice-icon"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                <span className="bs-choice-name">
                  Join my team&rsquo;s organization
                </span>
                <span className="bs-choice-note">
                  Somebody at your workplace already runs Bindersnap and will
                  add you.
                </span>
              </span>
            </label>
          </div>
          <button className="bs-btn bs-btn-primary app-submit" type="submit">
            Continue
          </button>
        </form>
      </>,
    );
  }

  if (step === "join") {
    return shell(
      <JoinInstructions
        username={username}
        fullName={fullName}
        checkForOrganization={checkForOrganization}
        onJoined={onJoined}
        onBack={() => setStep("choose")}
        onSkip={onSkip}
      />,
    );
  }

  return shell(
    <>
      <h1>
        {reason === "blocked-write"
          ? "Name your organization to start writing"
          : "Create your organization"}
      </h1>

      <p className="org-setup-lede">
        {/* The reason, not the mechanics. Ownership is the whole point of
                the level: a binder belongs to the organization, so it stays
                when the person who wrote it leaves. */}
        Your binders belong to an organization, not to you personally — so they
        stay put when people join and leave.
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
          <p className="bs-field-hint">
            Your workspace address will be <code>{slug}</code>
          </p>
        ) : null}

        {isFirstOrganization ? (
          <p className="org-setup-note">
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
              Being added is something an owner does — the join step says how
              to ask. */}
      {isFirstOrganization && reason === null ? (
        <button
          type="button"
          className="org-setup-link"
          onClick={() => setStep("choose")}
        >
          &larr; Back
        </button>
      ) : (
        <p className="org-setup-note">
          Joining one that already exists? Ask an owner to add you — it will
          show up here once they do.
        </p>
      )}

      <button type="button" className="org-setup-link" onClick={() => onSkip()}>
        Skip for now
      </button>
    </>,
  );
}

/** How often the join step asks whether an owner has added them yet. */
const JOIN_POLL_MS = 5000;

/**
 * What to send an owner, and a page that moves on by itself once they act.
 *
 * Bindersnap cannot email an invitation yet, so the person waiting has to ask
 * — and the one thing the owner needs from them is the username, typed into
 * People & access. So the message is written for them, with the username in
 * it, ready to paste into whatever their workplace uses.
 */
function JoinInstructions({
  username,
  fullName,
  checkForOrganization,
  onJoined,
  onBack,
  onSkip,
}: {
  username: string;
  fullName: string | null;
  checkForOrganization: () => Promise<boolean>;
  onJoined: () => void | Promise<void>;
  onBack: () => void;
  onSkip: () => void;
}) {
  const message = `Hi — could you add me to our Bindersnap organization? My username is ${username}. You can add me under People & access → Add someone.`;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const joined = await checkForOrganization().catch(() => false);
      if (joined && !cancelled) {
        window.clearInterval(timer);
        await onJoined();
      }
    }, JOIN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [checkForOrganization, onJoined]);

  return (
    <>
      <h1>Ask to be added</h1>
      <p className="org-setup-lede">
        An owner of your team&rsquo;s organization adds you from{" "}
        <strong>People &amp; access</strong>. They need your username.
      </p>

      <div className="org-setup-identity">
        <span className="bs-label">Your username</span>
        <code className="org-setup-username">{username}</code>
        {fullName ? (
          <span className="org-setup-identity-name">{fullName}</span>
        ) : null}
      </div>

      <div className="bs-field">
        <label className="bs-label" htmlFor="org-setup-message">
          Send them this
        </label>
        <textarea
          id="org-setup-message"
          className="bs-input org-setup-message"
          readOnly
          rows={3}
          value={message}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
      <button
        type="button"
        className="bs-btn bs-btn-primary app-submit"
        onClick={async () => {
          await navigator.clipboard.writeText(message).catch(() => undefined);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy message"}
      </button>

      <p className="org-setup-note" role="status">
        This page moves on by itself as soon as they add you.
      </p>

      <div className="org-setup-actions">
        <button type="button" className="org-setup-link" onClick={onBack}>
          &larr; Back
        </button>
        <button type="button" className="org-setup-link" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </>
  );
}
