import { z } from "zod";
import { RepoUserSummarySchema } from "./common";

export const SearchUsersPayloadSchema = z.object({
  users: z.array(RepoUserSummarySchema),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
});
export type SearchUsersPayload = z.infer<typeof SearchUsersPayloadSchema>;
