import { type MouseEvent, useEffect, useState } from "react";

import {
  getAdminGrowth,
  type AdminGrowthPayload,
  type AdminGrowthReached,
} from "../api";
import {
  BILLING_LABELS,
  GROWTH_STEP_LABELS,
  billingTone,
  formatAdminDate,
  formatCount,
  formatDays,
  formatShare,
  formatAdminSeconds,
  signupKeyLabel,
  trialProgress,
  trialTimeLeft,
} from "../adminConsole";
import type { AppRoute } from "../routes";
import { ActivityExportButton } from "./AdminActivityExport";
import { SkeletonPanel } from "./Skeleton";
import { StatusChip } from "./StatusChip";

type LinkProps = (route: AppRoute) => {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/** The steps the week and first-page tables have room for. */
const SHORT_STEPS = [
  ["organization", "Organization"],
  ["proposed", "Proposed"],
  ["published", "Published"],
  ["paying", "Pays now"],
] as const satisfies readonly (readonly [keyof AdminGrowthReached, string])[];

/**
 * How signups get from an account to a published version and paying, and
 * how far each trial has got, from the activity dataset the API rebuilds
 * every six hours. Our own records, by id: nothing here came from tracking
 * anybody in the app.
 */
export function AdminGrowth({ link }: { link: LinkProps }) {
  const [state, setState] = useState<{
    data: AdminGrowthPayload | null;
    error: string | null;
  }>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    getAdminGrowth()
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error:
              error instanceof Error && error.message.trim() !== ""
                ? error.message
                : "Unable to load growth.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, error } = state;
  if (error) return <p className="app-inline-error">{error}</p>;
  if (!data) return <SkeletonPanel label="Loading growth" rows={8} />;

  if (data.builtAt === null) {
    return (
      <section className="bs-panel" aria-label="Growth">
        <div className="bs-empty">
          <p className="bs-empty-lead">Nothing to count yet.</p>
          <p>
            The activity dataset builds three minutes after the API starts, then
            every six hours. To build it now, open System and rebuild it under
            Maintenance.
          </p>
        </div>
      </section>
    );
  }

  const signups = data.total.signedUp;

  return (
    <div className="admin-console-stack">
      <p className="admin-console-note">
        Counted from the activity dataset, built{" "}
        {new Date(data.builtAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        .{" "}
        {signups === 0
          ? "No signups yet."
          : `${formatCount(signups)} ${signups === 1 ? "signup" : "signups"} since ${formatAdminDate(data.since)}.`}{" "}
        {data.invited > 0
          ? `${formatCount(data.invited)} who came by invitation joined somebody else's organization and aren't counted. `
          : ""}
        A step counts once an organization the person created reaches it.
      </p>

      <section className="bs-panel" aria-label="From signup to paying">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">From signup to paying</h2>
          <span className="bs-panel-bar-spacer" />
          <ActivityExportButton />
        </div>
        <div className="admin-console-table-wrap">
          <table className="admin-console-table">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">People</th>
                <th scope="col">Of signups</th>
                <th scope="col">Typical time from signup</th>
              </tr>
            </thead>
            <tbody>
              {(
                Object.keys(GROWTH_STEP_LABELS) as (keyof AdminGrowthReached)[]
              ).map((step) => {
                const days =
                  step === "organization" ||
                  step === "proposed" ||
                  step === "published"
                    ? formatDays(data.medianDays[step])
                    : "";
                return (
                  <tr key={step}>
                    <td>{GROWTH_STEP_LABELS[step]}</td>
                    <td className="admin-console-number">
                      {formatCount(data.total[step])}
                    </td>
                    <td className="admin-console-number">
                      {formatShare(data.total[step], signups)}
                    </td>
                    <td>{days}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {data.byWeek.length > 0 ? (
        <StepTable
          label="By week signed up"
          keyHeading="Week of"
          rows={data.byWeek.map((week) => ({
            key: String(week.weekStart),
            label: formatAdminDate(week.weekStart),
            reached: week.reached,
          }))}
        />
      ) : null}

      {data.byEntryPage.length > 0 ? (
        <StepTable
          label="By first page of the visit"
          keyHeading="First page"
          rows={data.byEntryPage.map((row) => ({
            key: row.key ?? "",
            label: signupKeyLabel("entry", row.key),
            reached: row.reached,
          }))}
        />
      ) : null}

      <section className="bs-panel" aria-label="Trials">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Trials</h2>
        </div>
        {data.trials.length === 0 ? (
          <div className="bs-empty">
            <p>No trials running, and none ended in the last two weeks.</p>
          </div>
        ) : (
          <div className="admin-console-table-wrap">
            <table className="admin-console-table">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Trial</th>
                  <th scope="col">Changes</th>
                  <th scope="col">Approvals</th>
                  <th scope="col">Versions</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">Progress</th>
                </tr>
              </thead>
              <tbody>
                {data.trials.map((trial) => {
                  const progress = trialProgress(trial);
                  return (
                    <tr key={trial.name}>
                      <td>
                        <a
                          className="admin-console-primary"
                          {...link({ kind: "organization", org: trial.name })}
                        >
                          {trial.name}
                        </a>
                        <span className="admin-console-secondary">
                          Created by {trial.createdBy}
                        </span>
                      </td>
                      <td>
                        <span className="admin-console-nowrap">
                          {trialTimeLeft(trial.trialEndsAt)}
                        </span>
                        <span className="admin-console-secondary">
                          {formatAdminSeconds(trial.trialEndsAt)}
                        </span>
                      </td>
                      <td className="admin-console-number">
                        {formatCount(trial.proposed)}
                      </td>
                      <td className="admin-console-number">
                        {formatCount(trial.approved)}
                      </td>
                      <td className="admin-console-number">
                        {formatCount(trial.published)}
                      </td>
                      <td className="admin-console-number">
                        {formatCount(trial.joined)}
                      </td>
                      <td>{formatAdminDate(trial.lastActivityAt)}</td>
                      <td>
                        <span className="admin-console-chips">
                          <StatusChip tone={progress.tone} size="sm">
                            {progress.label}
                          </StatusChip>
                          {trial.billing === "trial" ? null : (
                            <StatusChip
                              tone={billingTone(trial.billing)}
                              size="sm"
                            >
                              {BILLING_LABELS[trial.billing]}
                            </StatusChip>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StepTable({
  label,
  keyHeading,
  rows,
}: {
  label: string;
  keyHeading: string;
  rows: { key: string; label: string; reached: AdminGrowthReached }[];
}) {
  return (
    <section className="bs-panel" aria-label={label}>
      <div className="bs-panel-bar">
        <h2 className="bs-panel-bar-title">{label}</h2>
      </div>
      <div className="admin-console-table-wrap">
        <table className="admin-console-table">
          <thead>
            <tr>
              <th scope="col">{keyHeading}</th>
              <th scope="col">Signups</th>
              {SHORT_STEPS.map(([step, heading]) => (
                <th key={step} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className="admin-console-number">
                  {formatCount(row.reached.signedUp)}
                </td>
                {SHORT_STEPS.map(([step]) => (
                  <td key={step} className="admin-console-number">
                    {formatCount(row.reached[step])}
                    <span className="admin-console-secondary">
                      {formatShare(row.reached[step], row.reached.signedUp)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
