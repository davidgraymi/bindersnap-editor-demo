import { type MouseEvent, useEffect, useState } from "react";

import {
  getAdminSignups,
  type AdminSignupTally,
  type AdminSignupsPayload,
} from "../api";
import {
  BILLING_LABELS,
  billingTone,
  formatAdminDate,
  formatCount,
  signupKeyLabel,
} from "../adminConsole";
import type { AppRoute } from "../routes";
import { SkeletonPanel } from "./Skeleton";
import { StatusChip } from "./StatusChip";

type LinkProps = (route: AppRoute) => {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * Where signups came from, from what the site's signup links carried
 * (`signup_sources`), and how many went on to create an organization and pay
 * for it. Kept by us, never sent to Google: this is the half of the funnel
 * Google Analytics cannot see.
 */
export function AdminSignups({ link }: { link: LinkProps }) {
  const [state, setState] = useState<{
    data: AdminSignupsPayload | null;
    error: string | null;
  }>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    getAdminSignups()
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
                : "Unable to load signups.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, error } = state;
  if (error) return <p className="app-inline-error">{error}</p>;
  if (!data) return <SkeletonPanel label="Loading signups" rows={6} />;

  if (data.recorded === 0) {
    return (
      <section className="bs-panel" aria-label="Signups">
        <div className="bs-empty">
          <p className="bs-empty-lead">No signups recorded yet.</p>
          <p>
            Each new account keeps the page of bindersnap.com its visit began
            on. Accounts made before that started have none.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="admin-console-stack">
      <p className="admin-console-note">
        {formatCount(data.recorded)}{" "}
        {data.recorded === 1 ? "signup" : "signups"} since{" "}
        {formatAdminDate(data.since)}. Paying counts people who created an
        organization that pays now.
      </p>
      <TallyPanel
        label="First page of the visit"
        dimension="entry"
        rows={data.byEntryPage}
      />
      <TallyPanel label="Sent by" dimension="site" rows={data.bySite} />
      {data.byCampaign.length > 0 ? (
        <TallyPanel
          label="Campaign"
          dimension="campaign"
          rows={data.byCampaign}
        />
      ) : null}

      <section className="bs-panel" aria-label="Newest signups">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Newest signups</h2>
        </div>
        <div className="admin-console-table-wrap">
          <table className="admin-console-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">First page</th>
                <th scope="col">Signed up from</th>
                <th scope="col">Sent by</th>
                <th scope="col">Organizations</th>
                <th scope="col">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((row) => (
                <tr key={row.username}>
                  <td>
                    <span className="admin-console-primary">
                      {row.username}
                    </span>
                    {row.campaign ? (
                      <span className="admin-console-secondary">
                        {row.campaign}
                      </span>
                    ) : null}
                  </td>
                  <td>{signupKeyLabel("entry", row.entryPath)}</td>
                  <td>{signupKeyLabel("entry", row.fromPath)}</td>
                  <td>
                    {signupKeyLabel(
                      "site",
                      row.invited ? "invitation" : row.referrerHost,
                    )}
                  </td>
                  <td>
                    {row.organizations.length === 0 ? (
                      <span className="admin-console-secondary">None</span>
                    ) : (
                      <ul className="admin-console-orgs">
                        {row.organizations.map((org) => (
                          <li key={org.name} className="admin-console-org">
                            <a
                              {...link({ kind: "organization", org: org.name })}
                            >
                              {org.name}
                            </a>
                            <StatusChip
                              tone={billingTone(org.billing)}
                              size="sm"
                            >
                              {BILLING_LABELS[org.billing]}
                            </StatusChip>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{formatAdminDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TallyPanel({
  label,
  dimension,
  rows,
}: {
  label: string;
  dimension: "entry" | "site" | "campaign";
  rows: AdminSignupTally[];
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
              <th scope="col">{label}</th>
              <th scope="col">Signups</th>
              <th scope="col">Created an organization</th>
              <th scope="col">Paying</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key ?? ""}>
                <td>{signupKeyLabel(dimension, row.key)}</td>
                <td className="admin-console-number">
                  {formatCount(row.signups)}
                </td>
                <td className="admin-console-number">
                  {formatCount(row.organizations)}
                </td>
                <td className="admin-console-number">
                  {formatCount(row.paying)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
