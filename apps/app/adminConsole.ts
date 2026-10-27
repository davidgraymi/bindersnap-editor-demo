import type { AdminBillingState, AdminHealthCheck, AdminUserRow } from "./api";
import type { StatusTone } from "./components/StatusChip";
import type { AdminSection } from "./routes";

/** What each section of the site admin console is called on its tab. */
export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  overview: "Overview",
  users: "People",
  organizations: "Organizations",
  binders: "Binders",
  subscriptions: "Pro access",
};

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
