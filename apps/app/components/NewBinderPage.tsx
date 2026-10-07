import { useMemo, useState } from "react";
import { Building2, Lock } from "lucide-react";

import { createBinder } from "../api";
import { followInApp } from "../appLink";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { slugifyOrganizationName } from "../../../packages/utils/organizationName";

/**
 * A new binder, on a page of its own: `/{org}/-/binders/new`.
 *
 * **GitLab's "Create blank project", for a binder.** The form used to open in
 * place above the list, which made it a drawer on somebody else's page: no
 * address to send, a Cancel in the header where "New binder" had been, and a
 * list shoved down the screen while you typed. It also asked less than the API
 * takes — no description — and never said what the binder's address would be,
 * which is the one thing about it that cannot be taken back quietly.
 *
 * The address is previewed with the rule the server applies, from the one
 * shared copy of it, so the preview never promises a name the server will not
 * give. A name another binder already has is caught here rather than after a
 * round trip.
 */

interface NewBinderPageProps {
  org: string;
  /** "Riverside Health", not `riverside-health` — people read this form. */
  orgDisplayName: string;
  /** The binders already here, so a taken name is refused before submitting. */
  existing: readonly WorkspaceSummary[] | null;
  /** Where Cancel goes: the organization's list. */
  cancelHref: string;
  onCancel: () => void;
  /** Into the binder just made — the next thing to do is put something in it. */
  onCreated: (binder: WorkspaceSummary) => void;
}

/** What to say under the name: its address, or why it cannot have one. */
export function describeBinderAddress(
  org: string,
  name: string,
  existing: readonly Pick<WorkspaceSummary, "name">[] | null,
): { slug: string; problem: string | null } {
  const slug = slugifyOrganizationName(name);
  if (name.trim() === "") return { slug, problem: null };
  if (slug === "") {
    return {
      slug,
      problem: "Use at least one letter or number.",
    };
  }
  if (existing?.some((binder) => binder.name.toLowerCase() === slug)) {
    return {
      slug,
      problem: `${org} already has a binder at /${org}/${slug}.`,
    };
  }
  return { slug, problem: null };
}

export function NewBinderPage({
  org,
  orgDisplayName,
  existing,
  cancelHref,
  onCancel,
  onCreated,
}: NewBinderPageProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Open, because the common case is a policy manual everybody must be able
  // to read in order to attest to it. A default, not an assumption: the
  // question is on the form, and this is the moment its answer is known.
  const [openToOrganization, setOpenToOrganization] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = useMemo(
    () => describeBinderAddress(org, name, existing),
    [org, name, existing],
  );
  const canSubmit =
    address.slug !== "" && address.problem === null && !submitting;

  return (
    <section className="docw-page">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">New binder</h1>
          <p className="bs-subtitle">
            A set of documents governed together — by the same people, under the
            same rules.
          </p>
        </div>
      </div>

      <form
        className="bs-fields new-binder"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSubmit) return;

          setSubmitting(true);
          setError(null);
          try {
            const created = await createBinder(
              org,
              name.trim(),
              description.trim() === "" ? undefined : description.trim(),
              openToOrganization,
            );
            onCreated(created);
          } catch (err) {
            setError(
              err instanceof Error && err.message.trim() !== ""
                ? err.message
                : "Unable to create the binder.",
            );
            setSubmitting(false);
          }
        }}
      >
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="new-binder-name">
            Binder name
          </label>
          <input
            className="bs-input"
            id="new-binder-name"
            name="binder-name"
            type="text"
            placeholder="Clinical policies"
            value={name}
            maxLength={100}
            autoFocus
            disabled={submitting}
            aria-invalid={address.problem !== null}
            aria-describedby="new-binder-address"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {/* GitLab's project URL, as a sentence: the address is derived from
              the name rather than typed, so it is shown, not asked for. */}
          <p
            className={`bs-field-hint new-binder-address${
              address.problem ? " new-binder-address--problem" : ""
            }`}
            id="new-binder-address"
            aria-live="polite"
          >
            {address.problem ??
              (address.slug === "" ? (
                <>
                  Its address comes from its name: <code>/{org}/…</code>
                </>
              ) : (
                <>
                  Its address will be{" "}
                  <code>
                    /{org}/{address.slug}
                  </code>
                </>
              ))}
          </p>
        </div>

        <div className="bs-field">
          <label className="bs-field-label" htmlFor="new-binder-description">
            Description
            <span className="bs-field-optional">optional</span>
          </label>
          <textarea
            className="bs-input bs-settings-description"
            id="new-binder-description"
            name="binder-description"
            rows={2}
            placeholder="What belongs in it, and who it is for."
            value={description}
            disabled={submitting}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <fieldset className="bs-field">
          <legend className="bs-field-label new-binder-legend">
            Who can see it
          </legend>
          <label className="bs-choice">
            <input
              type="radio"
              name="binder-visibility"
              checked={openToOrganization}
              disabled={submitting}
              onChange={() => setOpenToOrganization(true)}
            />
            <Building2
              className="bs-choice-icon"
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span>
              <span className="bs-choice-name">
                Everyone at {orgDisplayName}
              </span>
              <span className="bs-choice-note">
                They can read it and comment on changes. Reading is free.
              </span>
            </span>
          </label>
          <label className="bs-choice">
            <input
              type="radio"
              name="binder-visibility"
              checked={!openToOrganization}
              disabled={submitting}
              onChange={() => setOpenToOrganization(false)}
            />
            <Lock
              className="bs-choice-icon"
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span>
              <span className="bs-choice-name">Only people you add</span>
              <span className="bs-choice-note">
                For a binder not everybody should see — an investigation, or
                board papers. You can change this later in its settings.
              </span>
            </span>
          </label>
        </fieldset>

        {error ? (
          <p className="bs-note bs-note--danger" role="alert">
            {error}
          </p>
        ) : null}

        {/* GitLab's order: the act, then the way out, at the foot of the
            form they finish — not a Cancel in the page header. */}
        <div className="new-binder-actions">
          <button
            className="bs-btn bs-btn-primary"
            type="submit"
            disabled={!canSubmit}
          >
            {submitting ? "Creating…" : "Create binder"}
          </button>
          <a
            className="bs-btn bs-btn-secondary"
            href={cancelHref}
            onClick={(event) => followInApp(event, onCancel)}
          >
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
