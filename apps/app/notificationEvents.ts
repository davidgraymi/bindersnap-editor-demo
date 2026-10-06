/**
 * "The unread count may have changed" — said by whatever marked something
 * read, heard by the bell, so the number drops without waiting for its next
 * minute.
 */
export const NOTIFICATIONS_CHANGED = "bindersnap:notifications-changed";

export function announceNotificationsChanged(unread?: number): void {
  window.dispatchEvent(
    new CustomEvent(NOTIFICATIONS_CHANGED, { detail: { unread } }),
  );
}
