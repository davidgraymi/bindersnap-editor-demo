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

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

export const ChangeUsernameBodySchema = z.object({
  newUsername: z.string().min(1),
  /** The current password, checked again before the account changes. */
  password: z.string().min(1),
});
export type ChangeUsernameBody = z.infer<typeof ChangeUsernameBodySchema>;

export const DeleteAccountBodySchema = z.object({
  password: z.string().min(1),
  /** The username, typed out — the way Gitea confirms anything permanent. */
  confirm: z.string().min(1),
});
export type DeleteAccountBody = z.infer<typeof DeleteAccountBodySchema>;

/** Why an account change was refused, and what is in the way. */
export const AccountRefusalSchema = z.object({
  error: z.string(),
  /** Binders, as `org/binder`, whose sign-off rules name this person. */
  binders: z.array(z.string()).optional(),
  /** Organizations this person is the only owner of. */
  organizations: z.array(z.string()).optional(),
});
export type AccountRefusal = z.infer<typeof AccountRefusalSchema>;
