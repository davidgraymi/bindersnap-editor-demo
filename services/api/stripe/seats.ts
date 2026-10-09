import type Stripe from "stripe";

/**
 * Billing by seat (ADR 0004): an organization pays for each person who can
 * write — Owners, Admins and Editors, counted once — and reviewers and readers
 * are free. The count is derived from Gitea (`listBillableSeats`) and never
 * stored, so the Stripe subscription's quantity is a copy of it that this
 * module keeps current.
 *
 * Two things move it: any request that changes who can write in an
 * organization schedules a sync for that organization, and a sweep every few
 * hours syncs every organization, for changes no request saw (an account
 * deleted, a binder archived, a role changed in Gitea directly).
 */

/**
 * What a subscription is billed for. Never zero: every organization has an
 * owner, and a subscription item cannot be checked out at quantity 0.
 */
export function seatQuantity(seats: number): number {
  return Math.max(1, Math.floor(seats));
}

/** A subscription in one of these states bills nobody, so is left alone. */
const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

export type SeatSyncResult =
  | { changed: true; from: number; to: number; itemId: string }
  | {
      changed: false;
      reason: "unchanged" | "ended" | "no_item";
      quantity: number | null;
    };

/** The slice of the Stripe SDK this needs, so a test can pass a fake. */
export interface SeatSyncStripe {
  subscriptions: Pick<Stripe["subscriptions"], "retrieve">;
  subscriptionItems: Pick<Stripe["subscriptionItems"], "update">;
}

/**
 * Set the subscription's seat line to `seats`. Prorated, so adding a writer
 * mid-month charges for the rest of the month on the next invoice, and
 * removing one credits it. Does nothing when the quantity already matches,
 * which is the common case, so calling it often is cheap.
 */
export async function syncSubscriptionSeats(
  stripe: SeatSyncStripe,
  params: { subscriptionId: string; priceId: string; seats: number },
): Promise<SeatSyncResult> {
  const subscription = await stripe.subscriptions.retrieve(
    params.subscriptionId,
  );
  if (ENDED_STATUSES.has(subscription.status)) {
    return { changed: false, reason: "ended", quantity: null };
  }

  // Only a line on the seat price is ever changed. A subscription made before
  // per-seat billing has one line on an older, flat price, and setting its
  // quantity to the seat count would multiply that price: a price rise the
  // Terms (Section 9) allow only after 30 days' notice. Such a subscription
  // is moved to the seat price by hand, after that notice, and until then it
  // is reported as having no seat line.
  const item = (subscription.items?.data ?? []).find(
    (candidate) => candidate.price?.id === params.priceId,
  );
  if (!item) return { changed: false, reason: "no_item", quantity: null };

  const to = seatQuantity(params.seats);
  const from = item.quantity ?? 1;
  if (from === to) {
    return { changed: false, reason: "unchanged", quantity: from };
  }

  await stripe.subscriptionItems.update(item.id, {
    quantity: to,
    proration_behavior: "create_prorations",
  });
  return { changed: true, from, to, itemId: item.id };
}

/**
 * Coalesce syncs per organization. Adding five people to a binder is five
 * requests and should be one count and at most one Stripe call, made once
 * they have settled. A sync already running is never doubled: a request
 * arriving meanwhile queues one more pass after it, so the last change always
 * gets counted.
 */
export function createSeatSyncScheduler(options: {
  run: (organization: string) => Promise<void>;
  delayMs: number;
  onError?: (organization: string, error: unknown) => void;
}) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();

  const start = (organization: string) => {
    timers.delete(organization);
    if (running.has(organization)) {
      again.add(organization);
      return;
    }
    const pass = options
      .run(organization)
      .catch((error) => options.onError?.(organization, error))
      .finally(() => {
        running.delete(organization);
        if (again.delete(organization)) schedule(organization);
      });
    running.set(organization, pass);
  };

  const schedule = (organization: string) => {
    const key = organization.toLowerCase();
    const pending = timers.get(key);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => start(key), options.delayMs);
    // A pending sync never keeps the process alive; the sweep catches it.
    timer.unref?.();
    timers.set(key, timer);
  };

  /** Resolves once nothing is waiting or running. For tests and shutdown. */
  const idle = async () => {
    while (timers.size > 0 || running.size > 0) {
      await Promise.all(running.values());
      if (timers.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  };

  return { schedule, idle };
}

const ORGANIZATION_SCOPED = [
  // People: added, removed, made an owner or not.
  /^\/api\/app\/orgs\/([^/]+)\/people(?:\/|$)/,
  // Groups: a group's members gain or lose whatever the group grants.
  /^\/api\/app\/orgs\/([^/]+)\/groups(?:\/|$)/,
  // A new binder grants its teams onto a repository for the first time.
  /^\/api\/app\/orgs\/([^/]+)\/binders$/,
  // A binder's people and groups, and archiving it, which can leave a
  // writing team with no repository.
  /^\/api\/app\/binders\/([^/]+)\/[^/]+\/(?:people|groups|archive)(?:\/|$)/,
];

/**
 * The organization whose seat count a request may have changed, or null.
 * Reads only the route, so it errs toward syncing: a sync that finds the
 * count unchanged costs a few Gitea reads and no Stripe write.
 */
export function seatAffectingOrganization(
  method: string,
  pathname: string,
): string | null {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }
  for (const pattern of ORGANIZATION_SCOPED) {
    const match = pathname.match(pattern);
    if (match) return decodeURIComponent(match[1]!);
  }
  return null;
}
