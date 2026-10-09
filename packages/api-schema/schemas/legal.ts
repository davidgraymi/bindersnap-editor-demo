import { z } from "zod";

/** What the signed-in person still has to accept before going on. */
export const LegalStatusPayloadSchema = z.object({
  /** The version of the Terms as they stand: what to send back to accept. */
  version: z.string(),
  /** Whether they have yet to agree to this version for themselves. */
  person: z.boolean(),
  /** Organizations they own that have not accepted this version. */
  organizations: z.array(
    z.object({ name: z.string(), displayName: z.string() }),
  ),
});
export type LegalStatusPayload = z.infer<typeof LegalStatusPayloadSchema>;

export const AcceptLegalBodySchema = z.object({
  /** The version the form showed. Anything but the current one is refused. */
  acceptedTerms: z.string().min(1),
  /** Agree for oneself. */
  person: z.boolean().optional(),
  /** Accept for these organizations, each of which the caller must own. */
  organizations: z.array(z.string()).optional(),
});
export type AcceptLegalBody = z.infer<typeof AcceptLegalBodySchema>;
