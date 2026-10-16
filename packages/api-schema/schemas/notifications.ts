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
