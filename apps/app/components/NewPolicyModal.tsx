import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchBinders } from "../api";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { formatDocumentName } from "../documentDisplay";
import { AddPolicyModal } from "./AddPolicyModal";
import { SkeletonPanel } from "./Skeleton";

/**
 * "New policy", from the top nav — where no binder is in scope yet.
 *
 * The old create-a-document modal made a repository, protected its branch and
 * installed its rules, because a document *was* a repository. Under ADR 0004 a
 * document is a file inside a binder that already has all of that, so the only
 * thing this adds over `AddPolicyModal` is the question that page cannot ask:
 * **which binder**.
 *
 * It is asked first because it is the one answer that cannot be changed
 * afterwards without re-filing the policy — the binder decides who can see it,
 * who approves it, and what the rules are. Everything else on the next screen
 * is about the file.
 *
 * With exactly one binder the question is skipped: asking somebody to choose
 * from a list of one is a step that teaches nothing.
 */

interface NewPolicyModalProps {
  /**
   * The organization on screen. Its binders are the ones offered: a person in
   * several organizations was shown every binder they could reach, one row
   * each, named only by slug.
   */
  org?: string | null;
  onClose: () => void;
  /** The binder it was filed into, and the change request it is in. */
  onAdded: (org: string, binder: string, changeNumber: number) => void;
}

export function NewPolicyModal({
  org = null,
  onClose,
  onAdded,
}: NewPolicyModalProps) {
  const [binders, setBinders] = useState<WorkspaceSummary[] | null>(null);
  const [chosen, setChosen] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchBinders()
      .then((found) => {
        if (cancelled) return;
        // The organization's own, unless it has none this person can file in —
        // then everything, rather than a list with nothing on it.
        const here = org ? found.filter((binder) => binder.owner === org) : [];
        const offered = here.length > 0 ? here : found;
        setBinders(offered);
        if (offered.length === 1) setChosen(offered[0] ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read your binders.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org]);

  if (chosen) {
    return (
      <AddPolicyModal
        org={chosen.owner}
        binder={chosen.name}
        onClose={onClose}
        // Never null: null is what an act put into a draft answers with, and
        // this route names no draft — it is reached from the top nav, before
        // any binder is even in scope.
        onAdded={(changeNumber) =>
          onAdded(chosen.owner, chosen.name, changeNumber ?? 0)
        }
      />
    );
  }

  // The classes every other dialog uses. This one named `modal-backdrop` and
  // `modal-panel`, which no stylesheet defines, so it opened as loose text
  // under the page with nothing to click away on.
  return (
    <div
      className="upload-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-policy-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="new-policy-title">Which binder?</h2>

        {error ? <p className="app-inline-error">{error}</p> : null}

        {binders === null && error === null ? (
          <SkeletonPanel label="Reading your binders" rows={3} />
        ) : null}

        {binders !== null && binders.length === 0 ? (
          // Not an error, and not a dead end worth a stack trace: a person with
          // no binder has not gone wrong, they have not started yet.
          <p className="bs-field-hint">
            You are not in a binder yet. A document is filed in one, so somebody
            has to create a binder before there is anywhere to put this.
          </p>
        ) : null}

        {binders !== null && binders.length > 0 ? (
          <div className="bs-panel new-policy-binders">
            <ul className="bs-row-list">
              {binders.map((binder) => (
                <li key={binder.fullName}>
                  <button
                    type="button"
                    className="bs-row bs-row--tall"
                    onClick={() => setChosen(binder)}
                  >
                    <span className="bs-row-icon">
                      <BookOpen
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="bs-row-body">
                      <span className="bs-row-name">
                        {formatDocumentName(binder.name)}
                      </span>
                      <span className="bs-row-meta">
                        {/* Which organization, when the list spans more than
                            the one on screen. */}
                        {[
                          binder.owner === org ? null : binder.owner,
                          binder.description,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="upload-modal-actions">
          <button
            type="button"
            className="bs-btn bs-btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
