import { z } from "zod";

/** How far a customer has got with moving in — see `services/api/onboarding.ts`. */
export const OnboardingStepSchema = z.object({
  id: z.enum(["organization", "binder", "documents", "approvers", "publish"]),
  done: z.boolean(),
  /** Where to go to do it; null until an earlier step makes somewhere to go. */
  href: z.string().nullable(),
});
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

export const OnboardingPayloadSchema = z.object({
  steps: z.array(OnboardingStepSchema),
  complete: z.boolean(),
  org: z.string().nullable(),
  binder: z.string().nullable(),
});
export type OnboardingPayload = z.infer<typeof OnboardingPayloadSchema>;
