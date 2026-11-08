import type { GiteaClient } from "./gitea-client/client";
import {
  listBinderDrafts,
  readDraftActs,
  type DraftAct,
} from "./gitea-client/drafts";
import { countDraftDocuments } from "../../packages/utils/documentPath";
import {
  listOrganizationWorkspaces,
  type WorkspaceSummary,
} from "./gitea-client/workspaces";
import {
  describeUnnamedDraft,
  type DraftNameBackend,
  type DraftNameRecord,
} from "./draft-names";
import { listSessionOrganizations } from "./session-organization";

/** One of a person's drafts, with the binder it is in. */
export interface MyDraft {
  organization: string;
  workspace: string;
  branch: string;
  name: string;
  updatedAt: string | null;
  actCount: number;
  documentCount: number;
  lastAct: string | null;
  changeNumber: number | null;
}

/** What the read leans on, given so a test can answer without Gitea. */
export interface MyDraftsDeps {
  listOrganizations: (client: GiteaClient) => Promise<string[]>;
  listBinders: (
    client: GiteaClient,
    org: string,
  ) => Promise<WorkspaceSummary[]>;
  listDrafts: typeof listBinderDrafts;
  readActs: typeof readDraftActs;
  names: Pick<DraftNameBackend, "forBranches">;
}

export const defaultMyDraftsDeps = (
  names: Pick<DraftNameBackend, "forBranches">,
): MyDraftsDeps => ({
  listOrganizations: async (client) =>
    (await listSessionOrganizations(client)).map((org) => org.name),
  listBinders: (client, org) => listOrganizationWorkspaces({ client, org }),
  listDrafts: listBinderDrafts,
  readActs: readDraftActs,
  names,
});

/**
 * **Every draft of a person's, across the binders they can write in** —
 * the Drafts page under Your work, an organization and a binder.
 *
 * A draft is private, so this is only ever the reader's own: read with
 * their own token, and narrowed to branches named for them. Proposed drafts
 * are included, with their change request's number — saving into one still
 * changes what its reviewers see, so it is still work in hand.
 *
 * Three reads per binder (its branches, its open changes, the names) and one
 * per draft (what is in it). A binder that cannot be read is left out rather
 * than failing the list: one restricted binder should not blank the page.
 */
export async function readMyDrafts(params: {
  client: GiteaClient;
  username: string;
  /** One organization; absent, every one the reader is in. */
  org?: string | null;
  /** One binder in `org`; ignored without it. */
  binder?: string | null;
  deps: MyDraftsDeps;
}): Promise<MyDraft[]> {
  const { client, username, org, binder, deps } = params;

  const orgs = org ? [org] : await deps.listOrganizations(client);
  const binders = (
    await Promise.all(
      orgs.map(async (name) =>
        (await deps.listBinders(client, name).catch(() => []))
          // Only where they can write: a draft is somewhere to write, and a
          // binder read-only to them holds none they can carry on with.
          .filter((entry) => entry.access.push)
          .filter((entry) => !org || !binder || entry.name === binder)
          .map((entry) => ({ org: name, entry })),
      ),
    )
  ).flat();

  const perBinder = await Promise.all(
    binders.map(async ({ org: owner, entry }) => {
      const drafts = await deps
        .listDrafts({
          client,
          org: owner,
          workspace: entry.name,
          owner: username,
          proposed: true,
        })
        .catch(() => []);
      if (drafts.length === 0) return [];

      const [names, acts] = await Promise.all([
        deps.names
          .forBranches(
            entry.id,
            drafts.map((draft) => draft.branch),
          )
          .catch(() => new Map<string, DraftNameRecord>()),
        Promise.all(
          drafts.map((draft) =>
            deps
              .readActs({
                client,
                org: owner,
                workspace: entry.name,
                branch: draft.branch,
              })
              .catch((): DraftAct[] => []),
          ),
        ),
      ]);

      return drafts.map((draft, index): MyDraft => ({
        organization: owner,
        workspace: entry.name,
        branch: draft.branch,
        name:
          names.get(draft.branch)?.name ??
          describeUnnamedDraft(draft.updatedAt),
        updatedAt: draft.updatedAt,
        actCount: acts[index]?.length ?? 0,
        documentCount: countDraftDocuments(acts[index] ?? []),
        lastAct: draft.lastAct,
        changeNumber: draft.changeNumber,
      }));
    }),
  );

  return perBinder
    .flat()
    .sort(
      (left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
        right.branch.localeCompare(left.branch),
    );
}
