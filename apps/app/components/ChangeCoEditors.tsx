import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { ChangeUser } from "../../../packages/api-schema/schemas/documents";
import { ICON } from "../../../packages/ui-tokens/icons";
import { updateChangeAssignments } from "../api";
import { binderPeopleQuery, queryKeys } from "../data/queries";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";

/**
 * Who else may change what a change request proposes.
 *
 * **A change is edited by its author and the co-editors its author names.**
 * Anybody who could write in the binder could save into anybody's open
 * change; now a proposal holds only what the people answerable for it put
 * there. Everybody else comments on the words, or opens a change of their
 * own.
 *
 * The list is the pull request's assignees in Gitea, so who could edit a
 * change is on its record. Only somebody who can write in the binder can be
 * named: a co-editor who cannot save is a name on a list.
 */
export function ChangeCoEditors({
  org,
  binder,
  changeNumber,
  author,
  coEditors,
  canName,
  nameOf,
}: {
  org: string;
  binder: string;
  changeNumber: number;
  /** The author's login: they edit it anyway, and are never listed. */
  author: string;
  coEditors: readonly ChangeUser[];
  /** The author, or a binder admin, while the change is open. */
  canName: boolean;
  nameOf: (login: string) => string;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = useQuery({
    ...binderPeopleQuery(org, binder),
    enabled: canName && adding,
  });

  const listed = new Set(coEditors.map((editor) => editor.login.toLowerCase()));
  const candidates = (people.data?.people ?? []).filter(
    (person) =>
      person.login.toLowerCase() !== author.toLowerCase() &&
      !listed.has(person.login.toLowerCase()) &&
      // Writers only: a reviewer cannot save, whatever list they are on.
      person.access !== "read",
  );

  const save = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await updateChangeAssignments(
        { org, binder, documentPath: "" },
        changeNumber,
        { coEditors: next },
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.binder(org, binder),
      });
      setAdding(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to change who edits this change.",
      );
    } finally {
      setBusy(false);
    }
  };

  const logins = coEditors.map((editor) => editor.login);

  return (
    <div className="change-coeditors">
      {coEditors.length === 0 ? (
        <span className="change-coeditors-none">
          {canName ? "Only you" : "Only its author"}
        </span>
      ) : (
        <ul className="change-coeditors-list">
          {coEditors.map((editor) => (
            <li key={editor.login} className="change-about-person">
              <PersonAvatar
                person={editor}
                size="sm"
                card="Can edit this change"
              />
              {nameOf(editor.login)}
              {canName ? (
                <button
                  type="button"
                  className="bs-rowact change-coeditors-remove"
                  aria-label={`Stop ${nameOf(editor.login)} editing this change`}
                  title="Remove"
                  disabled={busy}
                  onClick={() =>
                    void save(logins.filter((login) => login !== editor.login))
                  }
                >
                  <AppIcon icon={ICON.close} size="xs" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canName && !adding ? (
        <button
          type="button"
          className="change-coeditors-add"
          onClick={() => setAdding(true)}
        >
          <AppIcon icon={ICON.add} size="xs" />
          Co-editor
        </button>
      ) : null}

      {canName && adding ? (
        <label className="change-coeditors-pick">
          <span className="sr-only">Let somebody else edit this change</span>
          <select
            className="bs-input bs-input--sm"
            autoFocus
            disabled={busy || people.isPending}
            value=""
            onChange={(event) => {
              if (event.target.value) {
                void save([...logins, event.target.value]);
              }
            }}
            onBlur={() => (busy ? undefined : setAdding(false))}
          >
            <option value="">
              {people.isPending
                ? "Finding who can write here…"
                : candidates.length === 0
                  ? "Nobody else can write in this binder"
                  : "Choose somebody…"}
            </option>
            {candidates.map((person) => (
              <option key={person.login} value={person.login}>
                {person.fullName.trim() || person.login}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? (
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
