/**
 * How far a new customer has got with moving in, read from what exists.
 *
 * **Nothing is stored.** Every step is a fact Gitea already holds: an
 * organization you are in, a binder in it, a change or a version in the
 * binder, a second person or an approval count of none, a published version.
 * So the guide is right on any device, after a week away, and after somebody
 * did a step without it — which a checklist of ticked boxes in a table would
 * get wrong the first time a colleague published on the customer's behalf.
 *
 * Pure. The Gitea calls happen in the request handler.
 */

export interface OnboardingBinder {
  name: string;
  /** A change request or a version exists: something has been added. */
  hasDocuments: boolean;
  /** A version has been published: something is on the record. */
  hasPublished: boolean;
  /** Null when it could not be read. */
  requiredApprovals: number | null;
}

export interface OnboardingOrganization {
  name: string;
  /** More than one person: somebody else can approve. */
  hasColleagues: boolean;
  binders: OnboardingBinder[];
}

export type OnboardingStepId =
  "organization" | "binder" | "documents" | "approvers" | "publish";

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
  /** Where to go to do it; null when there is nowhere yet (a prior step). */
  href: string | null;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  complete: boolean;
  /** The organization and binder the links point into. */
  org: string | null;
  binder: string | null;
}

const enc = encodeURIComponent;

export function onboardingState(
  orgs: readonly OnboardingOrganization[],
  /**
   * `published`: the person can already see a published version somewhere —
   * they are past setting up, whatever the organizations scanned say.
   */
  known: { published?: boolean } = {},
): OnboardingState {
  if (known.published) {
    return {
      steps: (
        ["organization", "binder", "documents", "approvers", "publish"] as const
      ).map((id) => ({ id, done: true, href: null })),
      complete: true,
      org: null,
      binder: null,
    };
  }
  // The organization the customer is furthest along in is the one to guide
  // them through: a person in two organizations is setting one of them up.
  const ranked = [...orgs].sort((left, right) => score(right) - score(left));
  const org = ranked[0] ?? null;
  const binders = org?.binders ?? [];
  const withDocuments = binders.find((binder) => binder.hasDocuments) ?? null;
  const binder = withDocuments ?? binders[0] ?? null;

  const hasBinder = binders.length > 0;
  const hasDocuments = binders.some((entry) => entry.hasDocuments);
  const hasApprovers =
    (org?.hasColleagues ?? false) ||
    binders.some((entry) => entry.requiredApprovals === 0);
  const hasPublished = binders.some((entry) => entry.hasPublished);

  const base = org ? `/${enc(org.name)}` : null;
  const binderBase =
    org && binder ? `/${enc(org.name)}/${enc(binder.name)}` : null;

  const steps: OnboardingStep[] = [
    { id: "organization", done: org !== null, href: "/-/organizations/new" },
    {
      id: "binder",
      done: hasBinder,
      href: base ? `${base}/-/binders/new` : null,
    },
    {
      id: "documents",
      done: hasDocuments,
      href: binderBase ? `${binderBase}?add=1` : null,
    },
    {
      id: "approvers",
      done: hasApprovers,
      href: base ? `${base}/-/people` : null,
    },
    {
      id: "publish",
      done: hasPublished,
      href: binderBase ? `${binderBase}/-/changes` : null,
    },
  ];

  return {
    steps,
    complete: steps.every((step) => step.done),
    org: org?.name ?? null,
    binder: binder?.name ?? null,
  };
}

function score(org: OnboardingOrganization): number {
  return (
    1 +
    (org.binders.length > 0 ? 1 : 0) +
    (org.binders.some((binder) => binder.hasDocuments) ? 1 : 0) +
    (org.hasColleagues ? 1 : 0) +
    (org.binders.some((binder) => binder.hasPublished) ? 1 : 0)
  );
}
