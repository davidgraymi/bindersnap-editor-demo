import { useEffect, useState } from "react";

import { fetchBinderSettings } from "../api";
import type { WorkspaceSettingsPayload } from "../../../packages/api-schema/schemas/workspaces";
import { describeBinderRules } from "../binderSettings";
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
}

export function BinderSettings({ org, binder }: BinderSettingsProps) {
  const [settings, setSettings] = useState<WorkspaceSettingsPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">The rules</h2>
        <ul className="binder-rule-list">
          {describeBinderRules(settings.rules).map((rule) => (
            <li className="binder-rule" key={rule}>
              {rule}
            </li>
          ))}
        </ul>
      </section>

      {/* Said plainly rather than by drawing controls that do nothing. The
          people half of this page has moved to People and is editable there;
          the rules are not, yet, and pretending otherwise is worse than
          saying where the editing happens. */}
      <p className="doc-rail-note">
        {settings.canManage
          ? "Who can act in this binder is on the People tab. Changing these rules is not in Bindersnap yet — it is done in Gitea for now."
          : "Who can act in this binder is on the People tab. Only a binder administrator can change these rules."}
      </p>
    </div>
  );
}
