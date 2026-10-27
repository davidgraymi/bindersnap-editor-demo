import { type FormEvent, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, UserPlus } from "lucide-react";

import {
  createAdminUser,
  getAdminConfig,
  getAdminSystem,
  runAdminReconciler,
  type AdminConfigPayload,
  type AdminCreatedUser,
  type AdminSystemPayload,
} from "../api";
import {
  commitUrl,
  formatBytes,
  formatConfigValue,
  formatUptime,
  imageReference,
  isCommitSha,
} from "../adminConsole";
import { appBuild } from "../feedbackTrace";
import { SkeletonPanel } from "./Skeleton";
import { StatusChip } from "./StatusChip";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : fallback;
}

/** Label and value pairs, the way Gitea's dashboard lists system status. */
function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="admin-console-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Commit({ sha }: { sha: string | null }) {
  if (!sha) return <>Not reported</>;
  if (!isCommitSha(sha)) return <code>{sha}</code>;
  return (
    <a href={commitUrl(sha)} target="_blank" rel="noreferrer">
      <code>{sha.slice(0, 12)}</code>
    </a>
  );
}

// ─── System ──────────────────────────────────────────────────────────────

/**
 * Which build is running, on what, with how much room — Gitea's Dashboard
 * "System Status", plus the versions a person asks for first when something
 * looks wrong.
 */
export function AdminSystem() {
  const [system, setSystem] = useState<AdminSystemPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getAdminSystem()
      .then((payload) => {
        if (!cancelled) {
          setSystem(payload);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(errorMessage(err, "Unable to read the system."));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshes]);

  if (error && !system) return <p className="app-inline-error">{error}</p>;
  if (!system) return <SkeletonPanel label="Reading the system" rows={8} bar />;

  const app = appBuild();
  const { runtime, storage, bindersnap } = system;
  const diskUsed =
    storage.diskTotalBytes !== null && storage.diskFreeBytes !== null
      ? storage.diskTotalBytes - storage.diskFreeBytes
      : null;

  return (
    <div className="admin-console-stack">
      <section className="bs-panel" aria-label="Versions">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Versions</h2>
          <span className="bs-panel-bar-spacer" />
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={() => setRefreshes((count) => count + 1)}
          >
            <RefreshCw size={14} strokeWidth={1.6} aria-hidden="true" />
            Read again
          </button>
        </div>
        <Facts
          rows={[
            [
              "API",
              <>
                {bindersnap.version ? `${bindersnap.version} · ` : ""}
                <Commit sha={bindersnap.commit} />
              </>,
            ],
            [
              "App (this page)",
              <>
                {app.version} · <code>{app.commit}</code>
              </>,
            ],
            ["Gitea", system.gitea.version ?? "Did not answer"],
            ["Bun", `${runtime.bunVersion} (${runtime.bunRevision})`],
            ["Environment", bindersnap.environment],
          ]}
        />
        <p className="admin-console-note">
          The version is the one in <code>package.json</code> when the image was
          built. The release workflow raises it in a commit of its own after
          each merge, so a deployed commit names the release before it. The
          commit is exact.
        </p>
      </section>

      <section className="bs-panel" aria-label="Images">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Images this release deploys</h2>
        </div>
        {system.images === null ? (
          <p className="admin-console-note">
            This API was not built with the production Compose file, so it
            cannot say. A local stack runs the images in{" "}
            <code>docker-compose.yml</code>.
          </p>
        ) : (
          <div className="admin-console-table-wrap">
            <table className="admin-console-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Image</th>
                  <th scope="col">Digest</th>
                </tr>
              </thead>
              <tbody>
                {system.images.map((image) => (
                  <tr key={image.service}>
                    <td>
                      <span className="admin-console-primary admin-console-nowrap">
                        {image.service}
                      </span>
                    </td>
                    <td>
                      <code>{imageReference(image)}</code>
                    </td>
                    <td>
                      {image.digest ? (
                        <code title={image.digest}>
                          {image.digest.slice(0, 19)}…
                        </code>
                      ) : (
                        <span className="admin-console-secondary">By tag</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bs-panel" aria-label="Runtime">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">The API process</h2>
        </div>
        <Facts
          rows={[
            ["Up for", formatUptime(runtime.startedAt)],
            ["Started", new Date(runtime.startedAt).toLocaleString("en-US")],
            ["Memory in use", formatBytes(runtime.memory.rss)],
            [
              "JavaScript heap",
              `${formatBytes(runtime.memory.heapUsed)} of ${formatBytes(runtime.memory.heapTotal)}`,
            ],
            ["Outside the heap", formatBytes(runtime.memory.external)],
            [
              "CPU time",
              `${runtime.cpuUserSeconds}s user, ${runtime.cpuSystemSeconds}s system`,
            ],
            [
              "Host memory free",
              `${formatBytes(runtime.memory.hostFree)} of ${formatBytes(runtime.memory.hostTotal)}`,
            ],
            [
              "Load average",
              `${runtime.loadAverage.join(", ")} on ${runtime.cpuCount} CPUs`,
            ],
            ["Platform", `${runtime.platform}/${runtime.arch}`],
            ["Container", `${runtime.hostname} (pid ${runtime.pid})`],
          ]}
        />
      </section>

      <section className="bs-panel" aria-label="Storage">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Storage</h2>
        </div>
        <Facts
          rows={[
            ["Database", <code key="path">{storage.databasePath}</code>],
            ["Database size", formatBytes(storage.databaseBytes)],
            ["Write-ahead log", formatBytes(storage.walBytes)],
            [
              "Volume",
              diskUsed === null
                ? "Not reported"
                : `${formatBytes(diskUsed)} used of ${formatBytes(storage.diskTotalBytes)}, ${formatBytes(storage.diskFreeBytes)} free`,
            ],
          ]}
        />
      </section>

      <Maintenance />
    </div>
  );
}

/** The jobs an admin can start by hand, as Gitea's Maintenance Operations. */
function Maintenance() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const { report } = await runAdminReconciler();
      setResult(
        report
          ? `Read ${report.binders} binders: ${report.findings.length} findings, ${report.errors.length} errors.`
          : "The reconciler has nothing to read with on this API.",
      );
    } catch (err) {
      setError(errorMessage(err, "The reconciler did not run."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="bs-panel" aria-label="Maintenance">
      <div className="bs-panel-bar">
        <h2 className="bs-panel-bar-title">Maintenance</h2>
      </div>
      <div className="bs-row">
        <span className="bs-row-body">
          <span className="bs-row-name">Check every binder now</span>
          <span className="bs-row-meta">
            Looks for a binder whose record is unprotected, and a change
            published without its versions. It repairs nothing. It runs a minute
            after the API starts and every six hours; this runs it now. Findings
            go to the log.
          </span>
          {result ? (
            <span className="admin-console-done" role="status">
              <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden="true" />
              {result}
            </span>
          ) : null}
          {error ? <span className="app-inline-error">{error}</span> : null}
        </span>
        <span className="bs-row-right">
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            disabled={running}
            onClick={() => void run()}
          >
            {running ? "Checking…" : "Run"}
          </button>
        </span>
      </div>
    </section>
  );
}

// ─── Configuration ───────────────────────────────────────────────────────

/**
 * Every setting the API runs with, as Gitea's Configuration Summary shows
 * its own. A secret is only ever "Set" or "Not set": the API never sends one.
 */
export function AdminConfig() {
  const [config, setConfig] = useState<AdminConfigPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminConfig()
      .then((payload) => {
        if (!cancelled) setConfig(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err, "Unable to read the configuration."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="app-inline-error">{error}</p>;
  if (!config) {
    return <SkeletonPanel label="Reading the configuration" rows={8} bar />;
  }

  return (
    <div className="admin-console-stack">
      {config.sections.map((section) => (
        <section
          key={section.title}
          className="bs-panel"
          aria-label={section.title}
        >
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">{section.title}</h2>
          </div>
          <dl className="admin-console-facts">
            {section.entries.map((entry) => (
              <div key={entry.key}>
                <dt>
                  {entry.label}
                  <code className="admin-console-key">{entry.key}</code>
                </dt>
                <dd>
                  {entry.secret ? (
                    <StatusChip
                      tone={entry.isSet ? "approved" : "review"}
                      size="sm"
                    >
                      {entry.isSet ? "Set" : "Not set"}
                    </StatusChip>
                  ) : (
                    formatConfigValue(entry.value)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

// ─── A new account ───────────────────────────────────────────────────────

/**
 * Gitea's "Create User Account", in this product's terms. Leave the password
 * empty and the person is emailed a link to choose their own — which also
 * confirms their address. Set one, and they still confirm it by email.
 */
export function NewAccountPanel({
  onCreated,
}: {
  onCreated: (created: AdminCreatedUser) => void;
}) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AdminCreatedUser | null>(null);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setUsername("");
    setPassword("");
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const account = await createAdminUser({
        firstName,
        lastName,
        email,
        ...(username.trim() ? { username: username.trim() } : {}),
        ...(password ? { password } : {}),
      });
      setCreated(account);
      reset();
      setOpen(false);
      onCreated(account);
    } catch (err) {
      setError(errorMessage(err, "Unable to create the account."));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="admin-console-actions">
        {created ? (
          <span className="admin-console-done" role="status">
            <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden="true" />
            {created.username} was created.{" "}
            {created.emailed === "welcome"
              ? `A link to choose a password went to ${created.email}.`
              : `A link to confirm ${created.email} went to it.`}
          </span>
        ) : null}
        <span className="bs-panel-bar-spacer" />
        <button
          type="button"
          className="bs-btn bs-btn-primary bs-btn--sm"
          onClick={() => {
            setCreated(null);
            setOpen(true);
          }}
        >
          <UserPlus size={14} strokeWidth={1.6} aria-hidden="true" />
          New account
        </button>
      </div>
    );
  }

  return (
    <section className="bs-panel" aria-label="New account">
      <div className="bs-panel-bar">
        <h2 className="bs-panel-bar-title">New account</h2>
      </div>
      <form className="admin-console-form" onSubmit={(e) => void submit(e)}>
        <label className="app-field">
          <span className="bs-field-label">First name</span>
          <input
            className="bs-input"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label className="app-field">
          <span className="bs-field-label">Last name</span>
          <input
            className="bs-input"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label className="app-field admin-console-form-wide">
          <span className="bs-field-label">Email address</span>
          <input
            className="bs-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label className="app-field">
          <span className="bs-field-label">Username (optional)</span>
          <input
            className="bs-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Made from their name"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="app-field">
          <span className="bs-field-label">Password (optional)</span>
          <input
            className="bs-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Email them a link instead"
            autoComplete="new-password"
          />
        </label>
        <p className="admin-console-note admin-console-form-wide">
          {password
            ? "You give them this password. They still confirm their address from an email, and accept the Terms when they first sign in."
            : "They get an email to choose their own password, which also confirms their address. They accept the Terms when they first sign in."}{" "}
          The account joins no organization: invite them from one.
        </p>
        {error ? (
          <p className="app-inline-error admin-console-form-wide">{error}</p>
        ) : null}
        <div className="admin-console-actions admin-console-form-wide">
          <button
            type="button"
            className="bs-btn bs-btn-secondary"
            disabled={saving}
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bs-btn bs-btn-primary"
            disabled={saving}
          >
            {saving ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </section>
  );
}
