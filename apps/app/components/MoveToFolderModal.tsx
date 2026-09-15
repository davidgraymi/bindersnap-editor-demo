import { useState } from "react";

import { formatDocumentName } from "../documentDisplay";
import { acceptsDrop, type DragSubject } from "../binderMove";

/**
 * Filing something somewhere else, without dragging it.
 *
 * **Drag and drop is the fast path, not the only one.** It needs a pointer, it
 * needs both ends of the move on screen at once, and it is unreachable from a
 * keyboard — none of which is acceptable as the sole way to move a policy in a
 * product a compliance officer has to use all day. A binder with forty folders
 * and a scrollbar is the ordinary case, not the edge one.
 *
 * One question, because in edit mode the name is changed in the row: this
 * screen is only ever "where does it go". That is what makes it a picker
 * rather than the rename-or-move form the document page still uses.
 */

interface MoveToFolderModalProps {
  /** What is being moved, and what its own address is. */
  subject: DragSubject;
  /** What to call it on the heading. */
  label: string;
  /** Every folder in the binder. Ones it cannot go in are filtered out here. */
  folders: readonly string[];
  onClose: () => void;
  onMove: (folder: string) => void;
}

export function MoveToFolderModal({
  subject,
  label,
  folders,
  onClose,
  onMove,
}: MoveToFolderModalProps) {
  // Only the folders this could actually land in. A folder cannot be moved
  // inside itself and nothing can be moved to where it already is, and both
  // read better as an option that is not there than as an error after the
  // fact. The top level is always a destination, which is why it is prepended
  // rather than expected in the list.
  const options = ["", ...folders].filter((folder) =>
    acceptsDrop(subject, folder),
  );

  const [folder, setFolder] = useState(() => options[0] ?? "");

  return (
    <div
      className="upload-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="upload-modal create-document-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-to-folder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="move-to-folder-title">Move {label}</h2>

        <div className="create-document-form">
          {options.length === 0 ? (
            // A binder with one folder and nothing else. Saying so is better
            // than a picker with nothing in it and a button that does nothing.
            <p className="add-policy-note">
              There is nowhere else to put this yet. Make a folder first.
            </p>
          ) : (
            <label htmlFor="move-to-folder" className="create-document-field">
              <span className="bs-label">Where it goes</span>
              <select
                id="move-to-folder"
                className="bs-input"
                value={folder}
                autoFocus
                onChange={(event) => setFolder(event.target.value)}
              >
                {options.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry === ""
                      ? "The binder’s top level"
                      : entry.split("/").map(formatDocumentName).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* The reassurance, but only when there is something to be
              reassured about. Under "there is nowhere to put this" it reads as
              a promise about an act nobody can perform. */}
          {options.length === 0 ? null : (
            <p className="add-policy-note">
              {subject.kind === "folder"
                ? "Everything in the folder moves with it, and every version stays with every policy."
                : "Every version stays with it. A policy that moves carries on from the version it is on."}
            </p>
          )}

          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => onMove(folder)}
              disabled={options.length === 0}
            >
              Move
            </button>
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
    </div>
  );
}
