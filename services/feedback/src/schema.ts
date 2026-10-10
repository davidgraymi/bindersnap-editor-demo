/**
 * The Worker's check of a {@link FeedbackReport}. Typed against the shared
 * interfaces, so a field added on one side and not the other fails to compile.
 */

import { z } from "zod";

import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  type FeedbackReport,
} from "../../../packages/utils/feedbackReport";

const text = (max: number) => z.string().max(max);
/** A short machine value: a username, a version, a method. */
const word = text(200);
const at = z.string().max(40);

const facts = z
  .record(word, z.union([text(500), z.number(), z.boolean(), z.null()]))
  .refine(
    (record) => Object.keys(record).length <= FEEDBACK_LIMITS.facts,
    "Too many fields",
  );

export const feedbackReportSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(1).max(FEEDBACK_LIMITS.title),
  description: z.string().trim().min(1).max(FEEDBACK_LIMITS.description),
  turnstileToken: z.string().min(1).max(2048),
  trace: z.object({
    capturedAt: at,
    url: text(FEEDBACK_LIMITS.url),
    route: facts,
    user: z
      .object({
        username: word,
        name: word.optional(),
        email: word.optional(),
      })
      .nullable(),
    organization: z
      .object({ name: word, displayName: word.optional() })
      .nullable(),
    app: z.object({ version: word, commit: word }),
    environment: z.object({
      userAgent: text(500),
      language: word,
      timeZone: word,
      viewport: word,
      devicePixelRatio: z.number(),
      online: z.boolean(),
      sinceLoadMs: z.number(),
    }),
    apiCalls: z
      .array(
        z.object({
          at,
          method: word,
          path: text(FEEDBACK_LIMITS.url),
          status: z.number().int(),
          durationMs: z.number(),
          requestId: word.optional(),
        }),
      )
      .max(FEEDBACK_LIMITS.apiCalls),
    errors: z
      .array(
        z.object({
          at,
          source: z.enum([
            "console.error",
            "console.warn",
            "uncaught",
            "rejection",
          ]),
          message: text(FEEDBACK_LIMITS.message),
          stack: text(FEEDBACK_LIMITS.stack).optional(),
        }),
      )
      .max(FEEDBACK_LIMITS.errors),
    navigation: z
      .array(z.object({ at, path: text(FEEDBACK_LIMITS.url) }))
      .max(FEEDBACK_LIMITS.navigation),
    failingQueries: z
      .array(z.object({ key: text(500), error: text(FEEDBACK_LIMITS.message) }))
      .max(FEEDBACK_LIMITS.failingQueries),
    state: facts,
  }),
}) satisfies z.ZodType<FeedbackReport>;
