import type { AdminBillingState, AdminHealthCheck, AdminUserRow } from "./api";
import type { StatusTone } from "./components/StatusChip";
import type { AdminSection } from "./routes";

/** What each section of the site admin console is called on its tab. */
export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  overview: "Overview",
  users: "People",
  organizations: "Organizations",
  binders: "Binders",
  system: "System",
  config: "Configuration",
};

/** Where a commit's changes can be read. */
export const REPOSITORY_URL =
  "https://github.com/davidgraymi/bindersnap-editor-demo";

/** A full commit SHA, which is what a deployed `release` is. */
export function isCommitSha(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{40}$/i.test(value);
}

export function commitUrl(sha: string): string {
  return `${REPOSITORY_URL}/commit/${sha}`;
}

/** "1.4 GB", "312 MB", "18 KB". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown =
    unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);
  return `${shown} ${units[unit]}`;
}

/** "3 days, 4 hours", "12 minutes" — how long since. */
export function formatUptime(
  sinceMs: number,
  now: number = Date.now(),
): string {
  const minutes = Math.max(0, Math.floor((now - sinceMs) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const plural = (count: number, unit: string) =>
    `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (days > 0) return `${plural(days, "day")}, ${plural(hours, "hour")}`;
  if (hours > 0)
    return `${plural(hours, "hour")}, ${plural(minutes % 60, "minute")}`;
  return plural(minutes, "minute");
}

/** `gitea/gitea:28.0.0`: the name and tag, without the digest. */
export function imageReference(image: {
  name: string;
  tag: string | null;
  digest: string | null;
}): string {
  return `${image.name}${image.tag ? `:${image.tag}` : ""}`;
}

/** A setting's value as a person reads it. */
export function formatConfigValue(
  value: string | number | boolean | string[] | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length === 0 ? "None" : value.join(", ");
  return String(value);
}

export function healthTone(status: AdminHealthCheck["status"]): StatusTone {
  return status === "ok"
    ? "approved"
    : status === "warn"
      ? "review"
      : "changes";
}

export function healthLabel(status: AdminHealthCheck["status"]): string {
  return status === "ok"
    ? "Healthy"
    : status === "warn"
      ? "Needs a look"
      : "Down";
}

/** The worst of the checks, which is what the overview leads with. */
export function overallHealth(
  checks: AdminHealthCheck[],
): AdminHealthCheck["status"] {
  if (checks.some((check) => check.status === "down")) return "down";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

export const BILLING_LABELS: Record<AdminBillingState, string> = {
  paying: "Paying",
  past_due: "Past due",
  trial: "In trial",
  trial_ended: "Trial ended",
  comped: "Comped",
  revoked: "Access revoked",
  canceled: "Canceled",
  none: "No plan",
};

export function billingTone(state: AdminBillingState): StatusTone {
  switch (state) {
    case "paying":
    case "comped":
      return "approved";
    case "trial":
      return "waiting";
    case "past_due":
    case "trial_ended":
      return "review";
    case "revoked":
      return "declined";
    case "canceled":
    case "none":
      return "withdrawn";
  }
}

export function emailLabel(state: AdminUserRow["emailConfirmation"]): string {
  return state === "confirmed"
    ? "Confirmed"
    : state === "waiting"
      ? "Not confirmed"
      : "Before confirmation";
}

export function emailTone(
  state: AdminUserRow["emailConfirmation"],
): StatusTone {
  return state === "confirmed"
    ? "approved"
    : state === "waiting"
      ? "review"
      : "withdrawn";
}

/** "Mar 14, 2026", or a dash for never. Epoch milliseconds. */
export function formatAdminDate(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Stripe and the trial column keep Unix seconds; everything Gitea says is
 * milliseconds by the time it reaches the console.
 */
export function formatAdminSeconds(value: number | null): string {
  return value === null ? "—" : formatAdminDate(value * 1000);
}

/** "1–25 of 112", or "26–50" when Gitea did not say how many. */
export function formatRange(params: {
  page: number;
  limit: number;
  shown: number;
  total: number | null;
}): string {
  const { page, limit, shown, total } = params;
  if (shown === 0) return total === null ? "None" : `0 of ${total}`;
  const first = (page - 1) * limit + 1;
  const last = first + shown - 1;
  return total === null ? `${first}–${last}` : `${first}–${last} of ${total}`;
}

/** A repository's size, from the kilobytes Gitea counts it in. */
export function formatSize(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}
