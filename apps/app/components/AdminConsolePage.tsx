import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { RefreshCw, Search } from "lucide-react";

import {
  clearAdminOrganizationAccess,
  getAdminOverview,
  listAdminBinders,
  listAdminOrganizations,
  listAdminUsers,
  setAdminOrganizationAccess,
  type AdminBillingState,
  type AdminBinderListPayload,
  type AdminOrganizationListPayload,
  type AdminOverviewPayload,
  type AdminUserListPayload,
  type AdminUserOrganization,
} from "../api";
import {
  ADMIN_SECTION_LABELS,
  BILLING_LABELS,
  billingTone,
  emailLabel,
  emailTone,
  formatAdminDate,
  formatAdminSeconds,
  formatCount,
  formatRange,
  formatSize,
  healthLabel,
  healthTone,
  overallHealth,
} from "../adminConsole";
import { followInApp } from "../appLink";
import {
  ADMIN_SECTIONS,
  routeToPath,
  type AdminSection,
  type AppRoute,
} from "../routes";
import {
  AdminConfig,
  AdminSystem,
  NewAccountPanel,
} from "./AdminSystemSections";
import { SkeletonPanel } from "./Skeleton";
import { StatusChip } from "./StatusChip";

const PAGE_SIZE = 25;

interface AdminConsolePageProps {
  section: AdminSection;
  currentUsername: string;
  onNavigate: (route: AppRoute) => void;
}

/**
 * The site admin's console (issue 840): everybody, every organization, every
 * binder, and whether the deployment is well — what Gitea's own site
 * administration shows, in this product's words. Only a Gitea site admin
 * reaches it; the API checks that on every request.
 */
export function AdminConsolePage({
  section,
  currentUsername,
  onNavigate,
}: AdminConsolePageProps) {
  const link = (route: AppRoute) => ({
    href: routeToPath(route),
    onClick: (event: MouseEvent<HTMLAnchorElement>) =>
      followInApp(event, () => onNavigate(route)),
  });

  return (
    <section className="docw-page admin-console" data-testid="admin-console">
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-identity">
            <h1 className="doc-header-title">Site admin</h1>
          </div>
          <span className="admin-console-who">
            Signed in as {currentUsername}
          </span>
        </div>

        <nav className="doc-tabs" aria-label="Site admin">
          {ADMIN_SECTIONS.map((entry) => (
            <a
              key={entry}
              className={`doc-tab${section === entry ? " doc-tab--active" : ""}`}
              aria-current={section === entry ? "page" : undefined}
              {...link({ kind: "admin", section: entry })}
            >
              {ADMIN_SECTION_LABELS[entry]}
            </a>
          ))}
        </nav>
      </header>

      {section === "overview" ? (
        <AdminOverview
          onOpen={(next) => onNavigate({ kind: "admin", section: next })}
        />
      ) : section === "users" ? (
        <AdminUsers link={link} />
      ) : section === "organizations" ? (
        <AdminOrganizations link={link} />
      ) : section === "binders" ? (
        <AdminBinders link={link} />
      ) : section === "system" ? (
        <AdminSystem />
      ) : (
        <AdminConfig />
      )}
    </section>
  );
}

type LinkProps = (route: AppRoute) => {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : fallback;
}

/**
 * One page of a list the console reads, refetched whenever what it asks for
 * changes. A slow answer to an old question never replaces a newer one.
 */
function useAdminList<T>(
  load: () => Promise<T>,
  key: string,
): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
  }>({ key: "", data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            key,
            data: null,
            error: errorMessage(error, "Unable to load this list."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // `key` names everything `load` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    loading: state.key !== key,
  };
}

// ─── Overview ────────────────────────────────────────────────────────────

function AdminOverview({
  onOpen,
}: {
  onOpen: (section: AdminSection) => void;
}) {
  const [refreshes, setRefreshes] = useState(0);
  const [last, setLast] = useState<AdminOverviewPayload | null>(null);
  const { data, error, loading } = useAdminList(
    getAdminOverview,
    `overview:${refreshes}`,
  );
  useEffect(() => {
    if (data) setLast(data);
  }, [data]);

  const overview = data ?? last;
  if (error && !overview) {
    return <p className="app-inline-error">{error}</p>;
  }
  if (!overview) {
    return <SkeletonPanel label="Checking the deployment" rows={6} bar />;
  }

  const overall = overallHealth(overview.checks);
  const { counts, billing } = overview;

  return (
    <div className="admin-console-stack">
      <section className="bs-panel" aria-label="Health checks">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Health</h2>
          <StatusChip tone={healthTone(overall)} size="sm">
            {overall === "ok"
              ? "Everything is answering"
              : overall === "warn"
                ? "Something needs a look"
                : "Something is down"}
          </StatusChip>
          <span className="bs-panel-bar-spacer" />
          <span className="admin-console-muted">
            Checked {new Date(overview.checkedAt).toLocaleTimeString()}
          </span>
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            disabled={loading}
            onClick={() => setRefreshes((count) => count + 1)}
          >
            <RefreshCw size={14} strokeWidth={1.6} aria-hidden="true" />
            {loading ? "Checking…" : "Check again"}
          </button>
        </div>
        {error ? <p className="app-inline-error">{error}</p> : null}
        <ul className="bs-row-list">
          {overview.checks.map((check) => (
            <li key={check.id}>
              <div className="bs-row">
                <span className="bs-row-body">
                  <span className="bs-row-name">{check.label}</span>
                  <span className="bs-row-meta">{check.detail}</span>
                </span>
                <span className="bs-row-right">
                  <StatusChip tone={healthTone(check.status)} size="sm">
                    {healthLabel(check.status)}
                  </StatusChip>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="admin-console-tiles">
        <Tile
          label="People"
          value={formatCount(counts.users)}
          note={
            counts.unconfirmedEmails
              ? `${formatCount(counts.unconfirmedEmails)} have not confirmed their email`
              : "Every address is confirmed"
          }
          onOpen={() => onOpen("users")}
        />
        <Tile
          label="Organizations"
          value={formatCount(counts.organizations)}
          note={`${billing.paying} paying, ${billing.trial} in trial`}
          onOpen={() => onOpen("organizations")}
        />
        <Tile
          label="Binders"
          value={formatCount(counts.binders)}
          note="Across every organization"
          onOpen={() => onOpen("binders")}
        />
      </div>

      <section className="bs-panel" aria-label="Billing">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Who pays</h2>
          <span className="bs-panel-bar-spacer" />
          <a
            className="admin-console-link"
            href={routeToPath({ kind: "admin", section: "organizations" })}
            onClick={(event) =>
              followInApp(event, () => onOpen("organizations"))
            }
          >
            Every organization
          </a>
        </div>
        <dl className="admin-console-billing">
          {(
            [
              ["paying", billing.paying],
              ["trial", billing.trial],
              ["past_due", billing.pastDue],
              ["trial_ended", billing.trialEnded],
              ["comped", billing.comped],
              ["canceled", billing.canceled],
              ["revoked", billing.revoked],
            ] as const
          ).map(([state, value]) => (
            <div key={state}>
              <dt>
                <StatusChip tone={billingTone(state)} size="sm">
                  {BILLING_LABELS[state]}
                </StatusChip>
              </dt>
              <dd>{formatCount(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  onOpen,
}: {
  label: string;
  value: string;
  note: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="admin-console-tile" onClick={onOpen}>
      <span className="admin-console-tile-label">{label}</span>
      <span className="admin-console-tile-value">{value}</span>
      <span className="admin-console-tile-note">{note}</span>
    </button>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────

function ListPanel({
  label,
  search,
  page,
  limit,
  shown,
  total,
  hasMore,
  onPage,
  children,
}: {
  label: string;
  search?: { placeholder: string; onSearch: (query: string) => void };
  page: number;
  limit: number;
  shown: number;
  total: number | null;
  hasMore: boolean;
  onPage: (page: number) => void;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search?.onSearch(draft.trim());
  };

  return (
    <section className="bs-panel" aria-label={label}>
      <div className="bs-panel-bar">
        {search ? (
          <form
            className="admin-console-search"
            onSubmit={submit}
            role="search"
          >
            <Search
              className="admin-console-search-icon"
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <input
              className="bs-input bs-input--sm"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        ) : (
          <h2 className="bs-panel-bar-title">{label}</h2>
        )}
        <span className="bs-panel-bar-spacer" />
        <span className="admin-console-muted">
          {formatRange({ page, limit, shown, total })}
        </span>
        <button
          type="button"
          className="bs-btn bs-btn-secondary bs-btn--sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="bs-btn bs-btn-secondary bs-btn--sm"
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
      <div className="admin-console-table-wrap">{children}</div>
    </section>
  );
}

function useListQuery() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useCallback((next: string) => {
    setQuery(next);
    setPage(1);
  }, []);
  return { query, page, setPage, search };
}

function AdminUsers({ link }: { link: LinkProps }) {
  const { query, page, setPage, search } = useListQuery();
  // A new account lands on the first page: the list is newest first.
  const [created, setCreated] = useState(0);
  const { data, error, loading } = useAdminList<AdminUserListPayload>(
    () => listAdminUsers(query, page, PAGE_SIZE),
    `users:${query}:${page}:${created}`,
  );
  // What a free-access button changed, by organization: it shows on every
  // row that organization's people are on, without reading the page again.
  const [billing, setBilling] = useState<Record<string, AdminBillingState>>({});

  return (
    <div className="admin-console-stack">
      <NewAccountPanel
        onCreated={() => {
          setPage(1);
          setCreated((count) => count + 1);
        }}
      />
      <ListPanel
        label="People"
        search={{
          placeholder: "Search by name, username or email",
          onSearch: search,
        }}
        page={page}
        limit={PAGE_SIZE}
        shown={data?.users.length ?? 0}
        total={data?.total ?? null}
        hasMore={data?.hasMore ?? false}
        onPage={setPage}
      >
        {error ? (
          <p className="app-inline-error">{error}</p>
        ) : loading || !data ? (
          <SkeletonPanel label="Loading people" rows={6} />
        ) : data.users.length === 0 ? (
          <div className="bs-empty">
            <p className="bs-empty-lead">Nobody matches that.</p>
          </div>
        ) : (
          <table className="admin-console-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Email</th>
                <th scope="col">Organizations</th>
                <th scope="col">Last signed in</th>
                <th scope="col">Joined</th>
                <th scope="col">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.username}>
                  <td>
                    <span className="admin-console-primary">
                      {user.username}
                    </span>
                    {user.fullName ? (
                      <span className="admin-console-secondary">
                        {user.fullName}
                      </span>
                    ) : null}
                    <span className="admin-console-flags">
                      {user.isSiteAdmin ? (
                        <StatusChip tone="waiting" size="sm">
                          Site admin
                        </StatusChip>
                      ) : null}
                      {!user.active || user.prohibitLogin ? (
                        <StatusChip tone="declined" size="sm">
                          Cannot sign in
                        </StatusChip>
                      ) : null}
                    </span>
                  </td>
                  <td>
                    <span className="admin-console-primary">
                      {user.email || "—"}
                    </span>
                    <StatusChip
                      tone={emailTone(user.emailConfirmation)}
                      size="sm"
                    >
                      {emailLabel(user.emailConfirmation)}
                    </StatusChip>
                  </td>
                  <td>
                    {user.organizations.length === 0 ? (
                      <span className="admin-console-secondary">None</span>
                    ) : (
                      <ul className="admin-console-orgs">
                        {user.organizations.map((org) => (
                          <OrganizationAccess
                            key={org.name}
                            org={org}
                            billing={billing[org.name] ?? org.billing}
                            link={link}
                            onChanged={(next) =>
                              setBilling((current) => ({
                                ...current,
                                [org.name]: next,
                              }))
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{formatAdminDate(user.lastLoginAt)}</td>
                  <td>{formatAdminDate(user.createdAt)}</td>
                  <td className="admin-console-number">{user.liveSessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPanel>
    </div>
  );
}

/**
 * One of a person's organizations: what it pays, and the one switch a site
 * admin has over that. Free access is the organization's (ADR 0004), so
 * giving it here gives it to everybody in the organization, which the label
 * says.
 */
function OrganizationAccess({
  org,
  billing,
  link,
  onChanged,
}: {
  org: AdminUserOrganization;
  billing: AdminBillingState;
  link: LinkProps;
  onChanged: (billing: AdminBillingState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An override is in force: ending it puts them back on what they pay.
  const overridden = billing === "comped" || billing === "revoked";

  const change = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = overridden
        ? await clearAdminOrganizationAccess(org.name)
        : await setAdminOrganizationAccess(org.name, "grant");
      onChanged(result.billing);
    } catch (caught) {
      setError(errorMessage(caught, "Unable to change this organization."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="admin-console-org">
      <a {...link({ kind: "organization", org: org.name })}>{org.name}</a>
      <StatusChip tone={billingTone(billing)} size="sm">
        {BILLING_LABELS[billing]}
      </StatusChip>
      <button
        type="button"
        className="bs-btn bs-btn-secondary bs-btn--sm"
        disabled={busy}
        aria-label={`${
          billing === "comped"
            ? "End free access for"
            : billing === "revoked"
              ? "Restore access for"
              : "Give free access to"
        } ${org.name}`}
        onClick={() => void change()}
      >
        {busy
          ? "Saving…"
          : billing === "comped"
            ? "End free access"
            : billing === "revoked"
              ? "Restore access"
              : "Give free access"}
      </button>
      {error ? <span className="app-inline-error">{error}</span> : null}
    </li>
  );
}

function AdminOrganizations({ link }: { link: LinkProps }) {
  const { page, setPage } = useListQuery();
  const { data, error, loading } = useAdminList<AdminOrganizationListPayload>(
    () => listAdminOrganizations(page, PAGE_SIZE),
    `organizations:${page}`,
  );

  return (
    <ListPanel
      label="Organizations"
      page={page}
      limit={PAGE_SIZE}
      shown={data?.organizations.length ?? 0}
      total={data?.total ?? null}
      hasMore={data?.hasMore ?? false}
      onPage={setPage}
    >
      {error ? (
        <p className="app-inline-error">{error}</p>
      ) : loading || !data ? (
        <SkeletonPanel label="Loading organizations" rows={6} />
      ) : data.organizations.length === 0 ? (
        <div className="bs-empty">
          <p className="bs-empty-lead">No organizations yet.</p>
        </div>
      ) : (
        <table className="admin-console-table">
          <thead>
            <tr>
              <th scope="col">Organization</th>
              <th scope="col">Plan</th>
              <th scope="col">Owners</th>
              <th scope="col">Writers</th>
              <th scope="col">Binders</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.organizations.map((org) => (
              <tr key={org.id}>
                <td>
                  <a
                    className="admin-console-primary"
                    {...link({ kind: "organization", org: org.name })}
                  >
                    {org.fullName || org.name}
                  </a>
                  <span className="admin-console-secondary">
                    {org.name}
                    {org.email ? ` · ${org.email}` : ""}
                  </span>
                  {!org.known ? (
                    <span className="admin-console-flags">
                      <StatusChip tone="withdrawn" size="sm">
                        Made outside Bindersnap
                      </StatusChip>
                    </span>
                  ) : null}
                </td>
                <td>
                  <StatusChip tone={billingTone(org.billing)} size="sm">
                    {BILLING_LABELS[org.billing]}
                  </StatusChip>
                  <span className="admin-console-secondary">
                    {planDetail(org)}
                  </span>
                </td>
                <td>{org.owners.length === 0 ? "—" : org.owners.join(", ")}</td>
                <td className="admin-console-number">
                  {formatCount(org.seats)}
                </td>
                <td className="admin-console-number">
                  {formatCount(org.binders)}
                </td>
                <td>
                  {formatAdminDate(org.createdAt)}
                  {org.createdBy ? (
                    <span className="admin-console-secondary">
                      by {org.createdBy}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ListPanel>
  );
}

/** The one date that matters for where an organization stands. */
function planDetail(
  org: AdminOrganizationListPayload["organizations"][number],
): string {
  if (org.billing === "trial" || org.billing === "trial_ended") {
    return `Trial ${org.billing === "trial" ? "ends" : "ended"} ${formatAdminSeconds(org.trialEndsAt)}`;
  }
  if (org.currentPeriodEnd !== null) {
    return `${org.cancelAtPeriodEnd ? "Ends" : "Renews"} ${formatAdminSeconds(org.currentPeriodEnd)}`;
  }
  return org.stripeStatus ? `Stripe: ${org.stripeStatus}` : "";
}

function AdminBinders({ link }: { link: LinkProps }) {
  const { query, page, setPage, search } = useListQuery();
  const { data, error, loading } = useAdminList<AdminBinderListPayload>(
    () => listAdminBinders(query, page, PAGE_SIZE),
    `binders:${query}:${page}`,
  );

  return (
    <ListPanel
      label="Binders"
      search={{ placeholder: "Search binders", onSearch: search }}
      page={page}
      limit={PAGE_SIZE}
      shown={data?.binders.length ?? 0}
      total={data?.total ?? null}
      hasMore={data?.hasMore ?? false}
      onPage={setPage}
    >
      {error ? (
        <p className="app-inline-error">{error}</p>
      ) : loading || !data ? (
        <SkeletonPanel label="Loading binders" rows={6} />
      ) : data.binders.length === 0 ? (
        <div className="bs-empty">
          <p className="bs-empty-lead">No binders match that.</p>
        </div>
      ) : (
        <table className="admin-console-table">
          <thead>
            <tr>
              <th scope="col">Binder</th>
              <th scope="col">Open changes</th>
              <th scope="col">Size</th>
              <th scope="col">Last changed</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.binders.map((binder) => (
              <tr key={binder.id}>
                <td>
                  <a
                    className="admin-console-primary"
                    {...link({
                      kind: "binder",
                      org: binder.org,
                      binder: binder.name,
                    })}
                  >
                    {binder.org}/{binder.name}
                  </a>
                  {binder.description ? (
                    <span className="admin-console-secondary">
                      {binder.description}
                    </span>
                  ) : null}
                  <span className="admin-console-flags">
                    {binder.archived ? (
                      <StatusChip tone="withdrawn" size="sm">
                        Archived
                      </StatusChip>
                    ) : null}
                    {binder.empty ? (
                      <StatusChip tone="working" size="sm">
                        Empty
                      </StatusChip>
                    ) : null}
                  </span>
                </td>
                <td className="admin-console-number">{binder.openChanges}</td>
                <td className="admin-console-number">
                  {formatSize(binder.sizeKb)}
                </td>
                <td>{formatAdminDate(binder.updatedAt)}</td>
                <td>{formatAdminDate(binder.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ListPanel>
  );
}
