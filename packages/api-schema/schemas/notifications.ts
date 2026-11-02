import { z } from "zod";

/**
 * A notification: something happened on a change request you are part of.
 *
 * Gitea's own notification thread, with the reason it is yours worked out —
 * see `services/api/notifications.ts`.
 */
export const AppNotificationSchema = z.object({
  id: z.number(),
  unread: z.boolean(),
  org: z.string(),
  binder: z.string(),
  changeNumber: z.number(),
  title: z.string(),
  reason: z.enum([
    "review_requested",
    "your_change",
    "published",
    "closed",
    "activity",
  ]),
  actor: z.string().nullable(),
  /** Their name as the product shows it. */
  actorName: z.string().nullable(),
  updatedAt: z.string(),
});
export type AppNotification = z.infer<typeof AppNotificationSchema>;

export const NotificationListPayloadSchema = z.object({
  notifications: z.array(AppNotificationSchema),
});
export type NotificationListPayload = z.infer<
  typeof NotificationListPayloadSchema
>;

export const NotificationCountPayloadSchema = z.object({ unread: z.number() });
export type NotificationCountPayload = z.infer<
  typeof NotificationCountPayloadSchema
>;

/** One thread, every thread about one change, or — with neither — all. */
export const ReadNotificationsBodySchema = z.object({
  id: z.number().optional(),
  change: z
    .object({ org: z.string(), binder: z.string(), number: z.number() })
    .optional(),
});
export type ReadNotificationsBody = z.infer<typeof ReadNotificationsBodySchema>;

/**
 * One thing that happened in a binder you can see, for Home's feed.
 *
 * Gitea's own activity feed, kept to what a person reading Home cares about
 * and said the way the product does — see `services/api/home-feed.ts`.
 */
export const FeedEventSchema = z.object({
  id: z.number(),
  kind: z.enum([
    "opened",
    "approved",
    "changes_requested",
    "commented",
    "started_discussion",
    "replied",
    "resolved",
    "reopened_discussion",
    "published",
    "closed",
    "reopened",
    "binder_created",
  ]),
  actor: z.string(),
  actorName: z.string(),
  org: z.string(),
  binder: z.string(),
  changeNumber: z.number().nullable(),
  title: z.string().nullable(),
  excerpt: z.string().nullable(),
  createdAt: z.string(),
});
export type FeedEvent = z.infer<typeof FeedEventSchema>;

export const HomeFeedPayloadSchema = z.object({
  events: z.array(FeedEventSchema),
  /** The page to ask for next, or null at the end of the feed. */
  nextPage: z.number().nullable(),
});
export type HomeFeedPayload = z.infer<typeof HomeFeedPayloadSchema>;
