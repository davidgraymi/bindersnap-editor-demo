import { z } from "zod";

import { SessionUserSchema } from "./auth";

/** The two halves of a name, joined into the account's one full name. */
export const ProfileNameBodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});
export type ProfileNameBody = z.infer<typeof ProfileNameBodySchema>;

export const AccountUserPayloadSchema = z.object({
  user: SessionUserSchema,
});
export type AccountUserPayload = z.infer<typeof AccountUserPayloadSchema>;
