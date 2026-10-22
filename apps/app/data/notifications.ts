/**
 * Marking notifications read, and what it changes on screen.
 *
 * The answer carries the new unread count, so the bell's number is set from it
 * rather than asked for again; the lists are re-read, since which ones are
 * still unread is the server's to say.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { markNotificationsRead } from "../api";
import { queryKeys } from "./queries";

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.notificationCount(), result.unread);
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.notifications(), "list"],
      });
    },
  });
}
