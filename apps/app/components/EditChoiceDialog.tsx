import { useEffect, useRef } from "react";

import {
  describeEditChoices,
  type EditChoice,
  whoseChange,
} from "../editChoices";
import { HelpLink } from "./HelpLink";

interface EditChoiceDialogProps {
  choices: readonly EditChoice[];
  /** Write in that change: its author or a co-editor, and nobody else. */
  onContinue: (changeNumber: number) => void;
  /** Read that change's words, where a passage is commented on. */
  onComment: (changeNumber: number) => void;
  /** Your own draft, reviewed apart from every change listed. */
  onStartSeparate: () => void;
  onClose: () => void;
}

/**
 * Edit, on a document somebody is already changing (`editChoices.ts`).
 *
 * One row per open change, each with the one act that is yours to do in it,
 * and below them the way that is always open: a change of your own. Nothing
 * is chosen for you, because which is right depends on what you mean to
 * write — a fix to their wording belongs in a comment, a different rule in a
 * separate change.
 */
export function EditChoiceDialog({
  choices,
  onContinue,
  onComment,
  onStartSeparate,
  onClose,
}: EditChoiceDialogProps) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="upload-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="upload-modal edit-choice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-choice-title"
        aria-describedby="edit-choice-note"
      >
        <h2 id="edit-choice-title">{describeEditChoices(choices)}</h2>

        <ul className="bs-row-list edit-choice-list">
          {choices.map((choice, index) => (
            <li key={choice.number} className="bs-row edit-choice-row">
              <span className="bs-row-body">
                <span className="bs-row-name bs-row-name--wrap">
                  {choice.title}
                </span>
                <span className="bs-row-meta">
                  {whoseChange(choice)} · Change {choice.number}
                  {choice.canContinue && !choice.mine
                    ? " · you are a co-editor"
                    : ""}
                </span>
              </span>
              {choice.canContinue ? (
                <button
                  ref={index === 0 ? first : undefined}
                  type="button"
                  className="bs-btn bs-btn-primary bs-btn--sm"
                  onClick={() => onContinue(choice.number)}
                >
                  Continue in it
                </button>
              ) : (
                <button
                  ref={index === 0 ? first : undefined}
                  type="button"
                  className="bs-btn bs-btn-secondary bs-btn--sm"
                  onClick={() => onComment(choice.number)}
                >
                  Comment on it
                </button>
              )}
            </li>
          ))}
        </ul>

        <p className="add-policy-note" id="edit-choice-note">
          {choices.some((choice) => !choice.canContinue)
            ? "Only a change’s author and its co-editors can write in it. To suggest different words, select them on its Changes tab and comment. "
            : ""}
          A separate change is reviewed on its own. If both change the same
          words, whichever is published second chooses between them first.{" "}
          <HelpLink
            guide="writing"
            section="When somebody is already changing it"
          >
            How this works
          </HelpLink>
        </p>

        <div className="upload-modal-actions">
          <button
            type="button"
            className="bs-btn bs-btn-secondary"
            onClick={onStartSeparate}
          >
            Start a separate change
          </button>
          <button
            type="button"
            className="bs-btn bs-btn--quiet"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
