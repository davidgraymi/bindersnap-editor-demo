import { z } from "zod";

export const SessionUserSchema = z.object({
  username: z.string(),
  fullName: z.string().optional(),
  isAdmin: z.boolean().optional(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionAuthStateSchema = z.object({
  user: SessionUserSchema.nullable(),
  token: z.string().nullable(),
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
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});
export type SignupBody = z.infer<typeof SignupBodySchema>;
