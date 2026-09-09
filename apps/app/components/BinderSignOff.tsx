import { useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";

import { fetchBinderSettings, proposeBinderSignOff } from "../api";
import type {
  SignOffRuleView,
  WorkspaceSettingsPayload,
} from "../../../packages/api-schema/schemas/workspaces";
import { describeGroupName } from "../../../packages/utils/groupName";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Who has to sign off on each folder.
 *
 * **The customer never sees `.gitea/CODEOWNERS` and never hears "code owner".**
 * They see a sentence: "Nursing must be signed off by Infection Control." There
 * is no pattern, no path syntax and no file — the folder picker lists the
 * binder's actual folders and the group picker lists the organization's groups.
 *
 * **A group, not a list of names**, and this page exists to spend that. It is
 * what the Gitea 28.0.0 upgrade buys: when somebody leaves Infection Control,
 * no rule changes, nothing is approved and nothing goes stale. Before it, a
 * rule had to name individuals, so every personnel change became a change in
 * every binder naming that person — approved by the very people being changed.
 *
 * **Saving does not save, and that is the feature.** Changing who signs off is
 * itself a change to the binder, so it goes through the same approval a policy
 * does. A customer buying "nothing changes without approval" who then found the
 * approval rules could be changed silently would have found the hole in the
 * product; showing them it is closed, at the exact moment they would wonder, is
 * worth more than the click it costs.
 */

interface BinderSignOffProps {
  org: string;
  binder: string;
  onOpenChange: (changeNumber: number) => void;
}

/** A rule being edited. `key` survives a folder being retyped. */
interface DraftRule extends SignOffRuleView {
  key: string;
}

let nextKey = 0;
function draftFrom(rule: SignOffRuleView): DraftRule {
  nextKey += 1;
  return { ...rule, key: `rule-${nextKey}` };
}

export function BinderSignOff({
  org,
  binder,
  onOpenChange,
}: BinderSignOffProps) {
  // The same fold every other editable surface uses: a delinquent organization
  // draws no controls, by the one flag that already decides whether controls
  // exist.
  const isReadOnly = useIsReadOnly();
  const [settings, setSettings] = useState<WorkspaceSettingsPayload | null>(
    null,
  );
  const [draft, setDraft] = useState<DraftRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setDraft(null);
    setError(null);
    setOpened(null);

    fetchBinderSettings(org, binder)
      .then((payload) => {
        if (cancelled) return;
        setSettings(payload);
        setDraft(payload.signOff.rules.map(draftFrom));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read this binder's sign-off rules.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  if (error) return <p className="app-inline-error">{error}</p>;

  if (settings === null || draft === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Reading who signs off on each folder">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const signOff = settings.signOff;
  const canEdit = settings.canManage && !isReadOnly;
  const pending = signOff.pendingChange;

  async function propose() {
    setSaving(true);
    setNotice(null);
    try {
      const result = await proposeBinderSignOff(
        org,
        binder,
        (draft ?? []).map(({ folder, teams, users }) => ({
          folder,
          teams,
          users,
        })),
      );
      setOpened(result.changeNumber);
    } catch (err: unknown) {
      setNotice(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to propose these rules.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">Sign-off rules</h2>

        {/* Read first, and said before anything else on the page. Rules that
            are listed but not enforced are worse than no rules at all: the
            screen would be promising something that is not happening. */}
        {signOff.enforced ? null : (
          <p className="app-inline-error">
            This binder cannot hold a change for these rules yet. Anything set
            here is recorded and shown, and nothing enforces it yet.
          </p>
        )}

        {notice ? <p className="app-inline-error">{notice}</p> : null}

        {opened !== null ? (
          <div className="binder-rule-list">
            <p className="binder-rule">
              <strong>This change needs approval.</strong> Changing who signs
              off is itself a change to the binder, so it goes through the same
              approval your policies do. We have opened it for you.
            </p>
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => onOpenChange(opened)}
            >
              Review the change
            </button>
          </div>
        ) : null}

        {signOff.rules.length === 0 && signOff.unreadable.length === 0 ? (
          <p className="doc-rail-note">
            No folder needs its own sign-off. Every change needs only this
            binder&rsquo;s usual approvals.
          </p>
        ) : (
          <ul className="binder-rule-list">
            {signOff.rules.map((rule) => (
              <li className="binder-rule" key={rule.folder}>
                {describeSignOffRule(rule)}
              </li>
            ))}
          </ul>
        )}

        {/* A rule the screen omitted would be a rule somebody believes is not
            there. Gitea drops what it cannot read with only a log warning, so
            this is the only place it is ever visible. */}
        {signOff.unreadable.length > 0 ? (
          <div className="binder-rule-list">
            <p className="app-inline-error">
              {signOff.unreadable.length === 1
                ? "One rule in this binder cannot be read, and enforces nothing:"
                : `${signOff.unreadable.length} rules in this binder cannot be read, and enforce nothing:`}
            </p>
            {signOff.unreadable.map((line) => (
              <p className="doc-rail-note" key={line.line}>
                <code>{line.text}</code>
              </p>
            ))}
          </div>
        ) : null}
      </section>

      {canEdit ? (
        <section className="binder-settings-section">
          <h3 className="doc-rail-title">Change the rules</h3>

          {pending !== null && opened === null ? (
            <div className="binder-rule-list">
              {/* Two open at once would leave competing versions of the rules in
                  review, and whichever was published last would silently win. */}
              <p className="binder-rule">
                A change to these rules is already waiting for a decision.
              </p>
              <button
                type="button"
                className="bs-btn bs-btn-secondary"
                onClick={() => onOpenChange(pending)}
              >
                Review the change
              </button>
            </div>
          ) : (
            <>
              {draft.map((rule) => (
                <RuleEditor
                  key={rule.key}
                  rule={rule}
                  folders={signOff.folders}
                  groups={signOff.groups}
                  busy={saving}
                  onChange={(next) =>
                    setDraft(
                      draft.map((entry) =>
                        entry.key === rule.key
                          ? { ...next, key: rule.key }
                          : entry,
                      ),
                    )
                  }
                  onRemove={() =>
                    setDraft(draft.filter((entry) => entry.key !== rule.key))
                  }
                />
              ))}

              <div className="org-group-add">
                <button
                  type="button"
                  className="bs-btn bs-btn-secondary bs-btn--sm"
                  disabled={saving || signOff.folders.length === 0}
                  onClick={() =>
                    setDraft([
                      ...draft,
                      draftFrom({
                        folder: signOff.folders[0] ?? "",
                        teams: [],
                        users: [],
                      }),
                    ])
                  }
                >
                  Add a rule
                </button>

                <button
                  type="button"
                  className="bs-btn bs-btn-primary bs-btn--sm"
                  disabled={saving}
                  onClick={() => void propose()}
                >
                  {saving ? "Opening a change…" : "Propose these rules"}
                </button>
              </div>

              {signOff.folders.length === 0 ? (
                <p className="doc-rail-note">
                  This binder has no folders yet. A sign-off rule is set on a
                  folder, so file a policy in one first.
                </p>
              ) : null}

              {/* Immediate versus approved, made visible. Nothing else on this
                  page saves instantly, and the button says "propose" for the
                  same reason. */}
              <p className="doc-rail-note">
                Changes to these rules are approved like a policy. Nothing takes
                effect until the change is published.
              </p>
            </>
          )}
        </section>
      ) : (
        <p className="doc-rail-note">
          Only a binder administrator can change who signs off on a folder.
        </p>
      )}
    </div>
  );
}

/** "Nursing must be signed off by Infection Control." */
export function describeSignOffRule(rule: SignOffRuleView): string {
  const owners = [
    ...rule.teams.map((team) => describeGroupName(team)),
    ...rule.users,
  ];

  const where = rule.folder === "" ? "Everything in this binder" : rule.folder;

  if (owners.length === 0) {
    // Gitea would have dropped this line, so it should never arrive — said
    // rather than rendered as a sentence with a hole in it.
    return `${where} has a sign-off rule with nobody on it, so nothing enforces it.`;
  }

  return `${where} must be signed off by ${listSentence(owners)}.`;
}

/** "A", "A and B", "A, B and C" — the way a person would say a list. */
function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function RuleEditor({
  rule,
  folders,
  groups,
  busy,
  onChange,
  onRemove,
}: {
  rule: DraftRule;
  folders: string[];
  groups: string[];
  busy: boolean;
  onChange: (rule: SignOffRuleView) => void;
  onRemove: () => void;
}) {
  // A folder that has a rule but no longer holds a document is still offered,
  // so editing another rule cannot silently retarget this one.
  const options = folders.includes(rule.folder)
    ? folders
    : [rule.folder, ...folders];

  return (
    <div className="org-group-add">
      <select
        className="bs-input org-group-select"
        value={rule.folder}
        disabled={busy}
        aria-label="Which folder"
        onChange={(event) => onChange({ ...rule, folder: event.target.value })}
      >
        {options.map((folder) => (
          <option key={folder} value={folder}>
            {folder === "" ? "Everything in this binder" : folder}
          </option>
        ))}
      </select>

      <span className="docs-list-item-meta">must be signed off by</span>

      <select
        className="bs-input org-group-select"
        value={rule.teams[0] ?? ""}
        disabled={busy}
        aria-label="Which group"
        onChange={(event) =>
          onChange({
            ...rule,
            teams: event.target.value === "" ? [] : [event.target.value],
          })
        }
      >
        <option value="">Choose a group…</option>
        {groups.map((group) => (
          <option key={group} value={group}>
            {describeGroupName(group)}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="bs-btn bs-btn-ghost bs-btn--sm"
        disabled={busy}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}
