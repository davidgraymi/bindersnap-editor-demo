/**
 * The Worker's check of an {@link ErrorReport}. Typed against the shared
 * interface, so a field added on one side and not the other fails to compile.
 */

import { z } from "zod";

import {
  ERROR_REPORT_LIMITS,
  ERROR_SOURCES,
  type ErrorReport,
} from "../../../packages/utils/errorReport";

const word = z.string().max(200);

export const errorReportSchema = z.object({
  source: z.enum(ERROR_SOURCES),
  kind: z.string().trim().min(1).max(ERROR_REPORT_LIMITS.kind),
  message: z.string().max(ERROR_REPORT_LIMITS.message),
  stack: z.string().max(ERROR_REPORT_LIMITS.stack).optional(),
  where: z.string().trim().min(1).max(ERROR_REPORT_LIMITS.where),
  app: z.object({ version: word, commit: word }),
  occurredAt: z.string().max(40),
  requestIds: z.array(word).max(ERROR_REPORT_LIMITS.requestIds),
  browser: z.string().max(ERROR_REPORT_LIMITS.browser).optional(),
  sinceLoadMs: z.number().nonnegative().optional(),
}) satisfies z.ZodType<ErrorReport>;
