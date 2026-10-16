import type { OnboardingPayload } from "./api";

/**
 * What each getting-started step says.
 *
 * Written for the person the product is for: a compliance or operations
 * manager who has a shared drive full of `Policy_FINAL_v3(2).docx` and has
 * never used a tool like this. Each step says what it is for, not only what to
 * click — "a binder is one set of rules" is the sentence that makes the next
 * three steps make sense.
 */

export type OnboardingStepId = OnboardingPayload["steps"][number]["id"];

export interface StepCopy {
  title: string;
  why: string;
  action: string;
  /** The help guide that explains it properly. */
  guide: string;
}

export const STEP_COPY: Record<OnboardingStepId, StepCopy> = {
  organization: {
    title: "Name your organization",
    why: "Your binders belong to the organization, not to you — so they stay put when people come and go.",
    action: "Create your organization",
    guide: "getting-started",
  },
  binder: {
    title: "Make your first binder",
    why: "A binder is a set of documents run by the same people under the same rules. Most teams start with one for their policy manual.",
    action: "Make a binder",
    guide: "getting-started",
  },
  documents: {
    title: "Bring in your documents",
    why: "Drop in the Word files and PDFs you already have — a whole folder at once keeps its shape. Or write a new policy right here.",
    action: "Add documents",
    guide: "adding-documents",
  },
  approvers: {
    title: "Decide who approves",
    why: "A new binder needs no approvals, so you can publish straight away. When a colleague should sign things off first, add them and set how many approvals the binder needs.",
    action: "Add a colleague",
    guide: "approvals",
  },
  publish: {
    title: "Publish your first version",
    why: "Open the change request and publish it. That version, who published it and when, and anyone who approved it, are on the record for good.",
    action: "Open your change requests",
    guide: "approvals",
  },
};

/** The next step to do, or null when every one is done. */
export function nextStep(state: OnboardingPayload) {
  return state.steps.find((step) => !step.done) ?? null;
}

export function doneCount(state: OnboardingPayload): number {
  return state.steps.filter((step) => step.done).length;
}
