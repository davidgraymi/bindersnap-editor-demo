/**
 * Which stack a Stripe object belongs to, when several share one account.
 *
 * CI runs every integration job against the same Stripe test account, and
 * each job's `stripe listen` receives every event on that account — not only
 * the ones its own stack caused. Each job's fresh database also numbers its
 * organizations from one, so a checkout for organization 3 in one job, when
 * delivered to another, marks *that* job's organization 3 as paid. A brand-new
 * organization then reads "Active, renews …" and a test about trials fails for
 * a reason nothing in its own run did.
 *
 * So a stack that is told its run tag (`STRIPE_RUN_TAG`) stamps it onto every
 * Stripe object it creates, and ignores any event whose object does not carry
 * it. Production sets no tag and handles every event exactly as before.
 */

export const STRIPE_RUN_TAG_METADATA_KEY = "bindersnap_run";

type Metadata = Record<string, unknown> | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function tagIn(metadata: Metadata): string | null {
  const value = metadata?.[STRIPE_RUN_TAG_METADATA_KEY];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The run tag an event's object carries, or null when it carries none.
 *
 * A Checkout Session and a Subscription carry it on their own metadata. An
 * invoice has no metadata of its own worth reading; it copies its
 * subscription's, under `parent.subscription_details` on current API versions
 * and `subscription_details` on older ones.
 */
export function stripeObjectRunTag(object: unknown): string | null {
  const data = asRecord(object);
  if (!data) return null;

  const own = tagIn(asRecord(data.metadata));
  if (own) return own;

  const parent = asRecord(data.parent);
  const fromParent = tagIn(
    asRecord(asRecord(parent?.subscription_details)?.metadata),
  );
  if (fromParent) return fromParent;

  return tagIn(asRecord(asRecord(data.subscription_details)?.metadata));
}

/**
 * Whether this stack should act on an event.
 *
 * With no run tag configured, every event is ours. With one, only an event
 * whose object carries the same tag is — an untagged object was made by
 * somebody else sharing the account, and acting on it is how organizations in
 * one run got paid for by another.
 */
export function isStripeEventForThisRun(
  object: unknown,
  runTag: string,
): boolean {
  if (runTag === "") return true;
  return stripeObjectRunTag(object) === runTag;
}

/** The metadata entry to stamp onto an object, or nothing when untagged. */
export function stripeRunTagMetadata(runTag: string): Record<string, string> {
  return runTag === "" ? {} : { [STRIPE_RUN_TAG_METADATA_KEY]: runTag };
}
