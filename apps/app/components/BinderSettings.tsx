import { useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";

import { fetchBinderSettings, renameBinder, setBinderRules } from "../api";
import type { WorkspaceSettingsPayload } from "../../../packages/api-schema/schemas/workspaces";
import { describeBinderRules } from "../binderSettings";
import { formatDocumentName } from "../documentDisplay";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * What has to be true before a policy in this binder changes.
 *
 * Branch protection on `main` plus the one gate that has no Gitea equivalent,
 * said in sentences rather than as a settings form read backwards — with the
 * product's core claim first, because that is the thing a customer is buying,
 * and **both sides of every rule stated**, because a rule that is off is still
 * a rule the customer chose.
 *
 * Who can act here used to be on this tab and has moved to People, which is
 * where the binder's tab bar says it should be and where the acts that change
 * it now live. A page that lists people is a page somebody expects to be able
 * to edit.
 */

interface BinderSettingsProps {
  org: string;
  binder: string;
  /**
   * The binder's new address, once it has one.
   *
   * The page this sits on is addressed by the name that just stopped being the
   * binder's, so somebody above has to move it. Old links keep working — Gitea
   * answers a redirect from the old name — but the address bar should say what
   * the binder is called now.
   */
  onRenamed?: (binder: string) => void;
}

export function BinderSettings({
  org,
  binder,
  onRenamed,
}: BinderSettingsProps) {
  // The same fold every other editable surface uses: a delinquent organization
  // draws no controls, by the one flag that already decides whether controls
  // exist.
  const isReadOnly = useIsReadOnly();
  const [settings, setSettings] = useState<WorkspaceSettingsPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(() => formatDocumentName(binder));
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError(null);

    fetchBinderSettings(org, binder)
      .then((payload) => {
        if (!cancelled) setSettings(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read this binder's settings.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  if (settings === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Reading this binder's settings">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const canEdit = settings.canManage && !isReadOnly;

  async function toggleThreads(next: boolean) {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await setBinderRules(org, binder, next);
      setSettings({
        ...settings!,
        rules: {
          ...settings!.rules,
          blockOnUnresolvedThreads: updated.blockOnUnresolvedThreads,
        },
      });
    } catch (err: unknown) {
      setNotice(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to change the rules.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function rename() {
    const next = name.trim();
    if (next === "" || renaming) return;

    setRenaming(true);
    setNotice(null);
    try {
      const renamed = await renameBinder(org, binder, next);
      // The page is addressed by the name it just stopped having, so somebody
      // has to move it. Old links keep working — Gitea redirects — but the
      // address bar should say what the binder is called now.
      onRenamed?.(renamed.workspace);
    } catch (err: unknown) {
      setNotice(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to rename this binder.",
      );
      setRenaming(false);
    }
  }

  return (
    <div className="binder-pane">
      {canEdit ? (
        <section className="binder-settings-section">
          <h2 className="doc-rail-title">What this binder is called</h2>

          <div className="binder-rename">
            <input
              className="bs-input"
              type="text"
              value={name}
              disabled={renaming}
              aria-label="What this binder is called"
              onChange={(event) => {
                setName(event.target.value);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void rename();
                }
              }}
            />
            <button
              type="button"
              className="bs-btn bs-btn-secondary"
              disabled={
                renaming ||
                name.trim() === "" ||
                name.trim() === formatDocumentName(binder)
              }
              onClick={() => void rename()}
            >
              {renaming ? "Renaming…" : "Rename"}
            </button>
          </div>

          {/* The thing somebody hesitating over this actually wants to know.
              It is true because Gitea answers a redirect from the old name,
              which was checked against the version this runs on rather than
              assumed. */}
          <p className="doc-rail-note">
            Links to the old name keep working. Nothing filed in the binder
            moves, and no version changes.
          </p>
        </section>
      ) : null}

      <section className="binder-settings-section">
        <h2 className="doc-rail-title">The rules</h2>

        {notice ? <p className="app-inline-error">{notice}</p> : null}

        <ul className="binder-rule-list">
          {describeBinderRules(settings.rules).map((rule) => (
            <li className="binder-rule" key={rule}>
              {rule}
            </li>
          ))}
        </ul>

        {canEdit ? (
          <label className="org-choice" htmlFor="binder-block-on-threads">
            {/* An explicit `id`/`htmlFor` pair rather than relying on the label
                wrapping the input: the visible text is inside nested spans, and
                a screen reader announced this control as "on" with no name at
                all. */}
            <input
              id="binder-block-on-threads"
              type="checkbox"
              checked={settings.rules.blockOnUnresolvedThreads}
              disabled={saving}
              aria-describedby="binder-block-on-threads-note"
              onChange={(event) => void toggleThreads(event.target.checked)}
            />
            <span>
              <span className="docs-list-item-name">
                Every discussion must be resolved before a change is published
              </span>
              {/* Immediate, and the page says so — the sign-off rules on their
                  own tab are not, and a page with two save behaviours has to
                  tell them apart. */}
              <span
                className="docs-list-item-meta"
                id="binder-block-on-threads-note"
              >
                Takes effect straight away. Who changed it, and when, is
                recorded.
              </span>
            </span>
          </label>
        ) : null}
      </section>

      {/* Said plainly rather than by drawing controls that do nothing. How many
          approvals a change needs is Gitea branch protection, which the binder
          does not edit yet; who signs off on a folder is its own tab, because
          changing that is an approved change. */}
      <p className="doc-rail-note">
        {canEdit
          ? "Who can act in this binder is on the People tab, and who signs off on each folder is on Sign-off rules. How many approvals a change needs is not editable here yet."
          : "Who can act in this binder is on the People tab. Only a binder administrator can change these rules."}
      </p>
    </div>
  );
}
