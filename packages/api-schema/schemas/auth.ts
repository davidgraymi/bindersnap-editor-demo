import { z } from "zod";

export const SessionUserSchema = z.object({
  username: z.string(),
  fullName: z.string().optional(),
  isAdmin: z.boolean().optional(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionAuthStateSchema = z.object({
  user: SessionUserSchema.nullable(),
  /**
   * What the signup form called their company, carried through so the
   * create-organization screen arrives filled rather than blank. Absent on
   * login, and on a signup that did not offer a name.
   */
  suggestedOrganizationName: z.string().nullable().optional(),
});
export type SessionAuthState = z.infer<typeof SessionAuthStateSchema>;

export const LoginBodySchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const SignupBodySchema = z.object({
  /** Joined into the account's one full name, which the record writes. */
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});
export type SignupBody = z.infer<typeof SignupBodySchema>;

/** "Forgot password?": the address a reset link should go to, if it is an account's. */
export const ForgotPasswordBodySchema = z.object({
  email: z.string().min(1),
});
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;

/** The same answer whether or not the address has an account. */
export const ForgotPasswordResultSchema = z.object({ ok: z.boolean() });
export type ForgotPasswordResult = z.infer<typeof ForgotPasswordResultSchema>;

export const ResetLinkStatusSchema = z.object({
  valid: z.boolean(),
  /** The account the link is for, so the page can say whose password it sets. */
  username: z.string().optional(),
});
export type ResetLinkStatus = z.infer<typeof ResetLinkStatusSchema>;

export const ResetPasswordBodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});
export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;
