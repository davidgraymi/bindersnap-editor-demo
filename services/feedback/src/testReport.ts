import type { FeedbackReport } from "../../../packages/utils/feedbackReport";

/** A complete, valid report; tests override what they are about. */
export function testReport(
  overrides: Partial<FeedbackReport> = {},
): FeedbackReport {
  return {
    kind: "bug",
    title: "Publishing does nothing",
    description:
      "I pressed Publish on the hand hygiene change and nothing happened.",
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    trace: {
      capturedAt: "2026-10-09T15:04:05.000Z",
      url: "https://bindersnap.com/acme/policies/-/changes/12",
      route: {
        kind: "binderChange",
        org: "acme",
        binder: "policies",
        change: 12,
      },
      user: {
        username: "alice",
        name: "Alice Doe",
        email: "alice@example.com",
      },
      organization: { name: "acme", displayName: "Acme Health" },
      app: { version: "0.4.75", commit: "a5e86fa3" },
      environment: {
        userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
        language: "en-US",
        timeZone: "America/Chicago",
        viewport: "1440x900",
        devicePixelRatio: 2,
        online: true,
        sinceLoadMs: 754_000,
      },
      apiCalls: [
        {
          at: "2026-10-09T15:04:01.000Z",
          method: "GET",
          path: "/api/app/binders/acme/policies/changes/12",
          status: 200,
          durationMs: 120.4,
          requestId: "0b8c1d5e-0000-4000-8000-000000000001",
        },
        {
          at: "2026-10-09T15:04:03.000Z",
          method: "POST",
          path: "/api/app/documents/acme/policies/pull-requests/12/publish",
          status: 500,
          durationMs: 2310,
          requestId: "0b8c1d5e-0000-4000-8000-000000000002",
        },
      ],
      errors: [
        {
          at: "2026-10-09T15:04:03.100Z",
          source: "rejection",
          message: "Error: Publish failed",
          stack: "Error: Publish failed\n    at publish (app.js:1:2)",
        },
      ],
      navigation: [
        { at: "2026-10-09T15:03:00.000Z", path: "/acme/policies" },
        { at: "2026-10-09T15:03:40.000Z", path: "/acme/policies/-/changes/12" },
      ],
      failingQueries: [],
      state: { unsavedChanges: false },
    },
    ...overrides,
  };
}
