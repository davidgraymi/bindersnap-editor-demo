import { useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";

import { fetchBinderSettings, proposeBinderSignOff } from "../api";
import type {
  SignOffDocumentView,
  SignOffRuleView,
  WorkspaceSettingsPayload,
} from "../../../packages/api-schema/schemas/workspaces";
import { describeGroupName } from "../../../packages/utils/groupName";
import { formatDocumentName } from "../../../packages/utils/documentTitle";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Who has to sign off on what.
 *
 * **Three scopes, one control.** A rule covers the whole binder, one folder, or
 * one document, and those are the three answers a customer actually gives to
 * "what has to be signed off?" — so the picker asks it once, with the folders
 * and the documents grouped under headings, rather than making somebody choose
 * a mode before they can choose a thing.
 *
 * **The customer never sees `.gitea/CODEOWNERS` and never hears "code owner".**
 * They see a sentence: "Nursing must be signed off by Infection Control." There
 * is no pattern, no path syntax and no file — the picker lists the binder's
 * actual folders and documents, and the group picker lists the organization's
 * groups.
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

/** A rule being edited. `key` survives the target being changed. */
interface DraftRule extends SignOffRuleView {
  key: string;
}

/**
 * The picker's value: scope and target in one string.
 *
 * One `<select>` rather than two controls, because "what has to be signed off"
 * is one question. `binder` has no target; the others carry theirs after a
 * colon, and a folder path may contain anything but the scope prefix is fixed
 * so the split is on the first colon only.
 */
function targetValue(rule: {
  scope: SignOffRuleView["scope"];
  target: string;
}) {
  return rule.scope === "binder" ? "binder" : `${rule.scope}:${rule.target}`;
}

function parseTargetValue(value: string): {
  scope: SignOffRuleView["scope"];
  target: string;
} {
  if (value === "binder") return { scope: "binder", target: "" };
  const at = value.indexOf(":");
  const scope = value.slice(0, at);
  return {
    scope: scope === "document" ? "document" : "folder",
    target: value.slice(at + 1),
  };
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
        (draft ?? []).map(({ scope, target, teams, users }) => ({
          scope,
          target,
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

  // Nothing drafted and nothing published: proposing would open a change
  // request that changes nothing. Deleting every rule from a binder that has
  // some is a real proposal, which is why the published count is part of this.
  const nothingToPropose =
    (draft?.length ?? 0) === 0 && signOff.rules.length === 0;

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">Sign-off rules</h2>

        {/* Read first, and said before anything else on the page. Rules that
            are listed but not enforced are worse than no rules at all: the
            screen would be promising something that is not happening. */}
        {signOff.enforced ? null : (
          <p className="app-inline-error">
            Nothing here is being enforced. These rules are recorded and shown,
            but this binder is not holding a change for them — so a change can
            be published without the sign-off below. Ask an administrator to
            check the binder&rsquo;s protection rules.
          </p>
        )}

        {/* **A rule whose group is empty enforces nothing**, verified against
            a running Gitea: there is no owner to wait for, so the gate finds
            nothing outstanding and the merge goes through. Said here for the
            same reason an unreadable line is — a control that is listed but
            not working is worse than one that was never set. */}
        {signOff.emptyGroups.length > 0 ? (
          <p className="app-inline-error">
            {signOff.emptyGroups.length === 1
              ? `${describeGroupName(signOff.emptyGroups[0]!)} has nobody in it, so the rule naming it is holding nothing. Add somebody to the group, or change the rule.`
              : `These groups have nobody in them, so the rules naming them are holding nothing: ${signOff.emptyGroups
                  .map((group) => describeGroupName(group))
                  .join(", ")}. Add somebody to each, or change the rules.`}
          </p>
        ) : null}

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
          /* The empty state is the page, so it says what the thing is rather
             than only that there is none of it. This is the one place the
             mockups' instinct — explain the model where it is used — earns its
             keep: a reader who has never set one cannot act on "nothing needs
             its own sign-off". It disappears the moment a rule exists, which is
             what keeps it from being the permanent onboarding rail the mockups
             drew. */
          <div className="binder-empty-rule">
            <p className="binder-empty-rule-lead">
              Nothing here needs its own sign-off yet.
            </p>
            <p className="doc-rail-note">
              Every change to this binder needs its usual approvals, whatever it
              touches. A sign-off rule adds a second requirement to one part of
              it —{" "}
              <em>
                the infection control group signs off on anything filed in
                nursing
              </em>{" "}
              — so a policy cannot be published without the people who own that
              subject.
            </p>
            <p className="doc-rail-note">
              A rule can cover this whole binder, one folder, or a single
              document, and a change that lands under two rules needs both.
            </p>
          </div>
        ) : (
          <ul className="binder-rule-list">
            {signOff.rules.map((rule) => (
              <li className="binder-rule" key={`${rule.scope}:${rule.target}`}>
                {describeSignOffRule(rule, signOff.documents)}
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
              {/* **What a rule can cover, said before anybody opens a picker.**
                  The three scopes live inside a `<select>`, which shows nothing
                  until it is opened — so a binder with no rules yet offered no
                  hint that a rule could name one policy rather than a folder,
                  and the feature was invisible to somebody looking straight at
                  it. A control's vocabulary belongs beside the control. */}
              <p className="doc-rail-note">
                A rule can cover this whole binder, one folder, or a single
                document.
              </p>

              {/* **Why the picker is short, when it is.** A document rule is
                  keyed on the identity in the filename, so a binder filed
                  before that existed offers no documents at all — and an empty
                  list with no explanation reads as a missing feature rather
                  than as a binder that cannot use it yet. The folder fallback
                  is said because it is real advice, not consolation. */}
              {signOff.documents.length === 0 &&
              signOff.unnameableDocuments > 0 ? (
                <p className="doc-rail-note">
                  {signOff.unnameableDocuments === 1
                    ? "The document in this binder was filed before Bindersnap could track policies individually, so no rule can name it on its own."
                    : `All ${signOff.unnameableDocuments} documents in this binder were filed before Bindersnap could track policies individually, so no rule can name one on its own.`}{" "}
                  A rule on their folder still covers them.
                </p>
              ) : null}

              {signOff.documents.length === 0 &&
              signOff.unnameableDocuments === 0 ? (
                <p className="doc-rail-note">
                  This binder holds no documents yet, so a rule can only cover
                  the binder itself.
                </p>
              ) : null}

              {draft.map((rule) => (
                <RuleEditor
                  key={rule.key}
                  rule={rule}
                  folders={signOff.folders}
                  documents={signOff.documents}
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
                  className={`bs-btn bs-btn--sm ${
                    nothingToPropose ? "bs-btn-primary" : "bs-btn-secondary"
                  }`}
                  // No longer gated on the binder having a folder: a rule can
                  // cover the binder itself, which every binder has.
                  disabled={saving}
                  onClick={() =>
                    setDraft([
                      ...draft,
                      draftFrom({
                        // A new rule starts at the whole binder: it is the one
                        // choice that is always available and always means
                        // something, so the row is never born pointing at
                        // whichever folder happened to sort first.
                        scope: "binder",
                        target: "",
                        teams: [],
                        users: [],
                      }),
                    ])
                  }
                >
                  Add a rule
                </button>

                {/* Nothing drafted and nothing published is nothing to
                    propose: pressing this would open a change request that
                    changes nothing. Adding the first rule is the primary act
                    in that state, so it carries the weight until there is
                    something to send. Deleting every rule from a binder that
                    has some is a real proposal, and stays enabled. */}
                <button
                  type="button"
                  className={`bs-btn bs-btn--sm ${
                    nothingToPropose ? "bs-btn-secondary" : "bs-btn-primary"
                  }`}
                  disabled={saving || nothingToPropose}
                  title={
                    nothingToPropose
                      ? "Add a rule before proposing a change."
                      : undefined
                  }
                  onClick={() => void propose()}
                >
                  {saving ? "Opening a change…" : "Propose these rules"}
                </button>
              </div>

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
export function describeSignOffRule(
  rule: SignOffRuleView,
  documents: readonly SignOffDocumentView[] = [],
): string {
  const owners = [
    ...rule.teams.map((team) => describeGroupName(team)),
    ...rule.users,
  ];

  const where = describeTarget(rule, documents);

  if (owners.length === 0) {
    // Gitea would have dropped this line, so it should never arrive — said
    // rather than rendered as a sentence with a hole in it.
    return `${where} has a sign-off rule with nobody on it, so nothing enforces it.`;
  }

  return `${where} must be signed off by ${listSentence(owners)}.`;
}

/**
 * What a rule covers, as a customer reads it.
 *
 * A document rule carries an identity, which is not a thing to put in front of
 * anybody — so it is looked up in the binder's own list. One that is not there
 * is **said**, not hidden: a rule about a document this binder no longer holds
 * enforces nothing, and a screen that quietly omitted it would be a screen
 * somebody trusts to be complete.
 */
export function describeTarget(
  rule: Pick<SignOffRuleView, "scope" | "target">,
  documents: readonly SignOffDocumentView[],
): string {
  switch (rule.scope) {
    case "binder":
      return "Everything in this binder";
    case "folder":
      return describeFolder(rule.target);
    case "document": {
      const match = documents.find((entry) => entry.uid === rule.target);
      return match
        ? formatDocumentName(match.name)
        : "A document that is no longer in this binder";
    }
  }
}

/** `clinical/nursing` → "Clinical / Nursing". A folder is a slug too. */
export function describeFolder(folder: string): string {
  return folder.split("/").map(formatDocumentName).join(" / ");
}

/** "A", "A and B", "A, B and C" — the way a person would say a list. */
function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function RuleEditor({
  rule,
  folders,
  documents,
  groups,
  busy,
  onChange,
  onRemove,
}: {
  rule: DraftRule;
  folders: string[];
  documents: SignOffDocumentView[];
  groups: string[];
  busy: boolean;
  onChange: (rule: SignOffRuleView) => void;
  onRemove: () => void;
}) {
  const current = targetValue(rule);

  // Whatever this rule already points at stays on the list even if the binder
  // no longer holds it, so opening the page to fix one rule cannot silently
  // retarget it at whichever folder happens to sort first.
  const missing =
    rule.scope !== "binder" &&
    !folders.includes(rule.target) &&
    !documents.some((entry) => entry.uid === rule.target);

  return (
    <div className="org-group-add">
      <select
        className="bs-input org-group-select"
        value={current}
        disabled={busy}
        aria-label="What has to be signed off"
        onChange={(event) =>
          onChange({ ...rule, ...parseTargetValue(event.target.value) })
        }
      >
        <option value="binder">Everything in this binder</option>

        {missing ? (
          <option value={current}>{describeTarget(rule, documents)}</option>
        ) : null}

        {folders.length > 0 ? (
          <optgroup label="Folders">
            {folders.map((folder) => (
              <option key={folder} value={`folder:${folder}`}>
                {describeFolder(folder)}
              </option>
            ))}
          </optgroup>
        ) : null}

        {documents.length > 0 ? (
          <optgroup label="Documents">
            {documents.map((entry) => (
              <option key={entry.uid} value={`document:${entry.uid}`}>
                {formatDocumentName(entry.name)}
                {entry.folder === ""
                  ? ""
                  : ` — ${describeFolder(entry.folder)}`}
              </option>
            ))}
          </optgroup>
        ) : null}
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
