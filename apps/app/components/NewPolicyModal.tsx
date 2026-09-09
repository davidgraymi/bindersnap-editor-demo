import { useEffect, useState } from "react";

import { fetchBinders } from "../api";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { AddPolicyModal } from "./AddPolicyModal";

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
  onClose: () => void;
  onAdded: (org: string, binder: string, slugPath: string) => void;
}

export function NewPolicyModal({ onClose, onAdded }: NewPolicyModalProps) {
  const [binders, setBinders] = useState<WorkspaceSummary[] | null>(null);
  const [chosen, setChosen] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchBinders()
      .then((found) => {
        if (cancelled) return;
        setBinders(found);
        if (found.length === 1) setChosen(found[0] ?? null);
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
  }, []);

  if (chosen) {
    return (
      <AddPolicyModal
        org={chosen.owner}
        binder={chosen.name}
        onClose={onClose}
        onAdded={(slugPath) => onAdded(chosen.owner, chosen.name, slugPath)}
      />
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Add a policy"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="doc-rail-title">Which binder?</h2>

        {error ? <p className="app-inline-error">{error}</p> : null}

        {binders === null && error === null ? (
          <p className="doc-rail-note">Reading your binders…</p>
        ) : null}

        {binders !== null && binders.length === 0 ? (
          // Not an error, and not a dead end worth a stack trace: a person with
          // no binder has not gone wrong, they have not started yet.
          <p className="doc-rail-note">
            You are not in a binder yet. A policy is filed in one, so somebody
            has to create a binder before there is anywhere to put this.
          </p>
        ) : null}

        {binders !== null && binders.length > 0 ? (
          <div className="docs-list">
            {binders.map((binder) => (
              <button
                key={binder.fullName}
                type="button"
                className="docs-list-item"
                onClick={() => setChosen(binder)}
              >
                <span className="docs-list-item-body">
                  <span className="docs-list-item-name">{binder.name}</span>
                  <span className="docs-list-item-meta">
                    {binder.description || binder.owner}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="modal-actions">
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
