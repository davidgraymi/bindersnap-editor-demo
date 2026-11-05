/**
 * The job that keeps the document index in step with `main` (ADR 0007, §4).
 *
 * A job, never a request handler. For each binder:
 *
 * 1. Compare `main`'s commit with the one last indexed. Equal is nothing to do.
 * 2. Otherwise read the tree at that commit and compare blob SHAs. Read only
 *    the files whose blob changed; drop the rows of files that left `main`.
 * 3. Record the commit.
 *
 * Two things start a pass: a publish, which asks for its binder at once, and
 * a slow sweep of every binder that catches anything a publish missed — a
 * binder made since, a rename, a change merged outside Bindersnap. A full
 * rebuild is the same loop over an empty file.
 *
 * Reads with the service account's read access, one file at a time, so a
 * rebuild cannot starve the API of the host's two cores.
 */

import { logger } from "../logger";
import {
  GiteaApiError,
  unwrap,
  type GiteaClient,
} from "../gitea-client/client";
import { readWorkspaceTree } from "../gitea-client/workspaceDocuments";
import { listOrganizationWorkspaces } from "../gitea-client/workspaces";
import { extractPassages, readableFormat } from "./extract";
import type { DocumentInput, SearchStore } from "./store";

export interface SearchPassError {
  binder: string;
  /** Set when one file could not be read; the binder was still indexed. */
  path?: string;
  error: string;
}

export interface SearchPass {
  startedAt: number;
  finishedAt: number;
  /** Binders looked at. */
  binders: number;
  /** Binders whose `main` had moved, and were read again. */
  changed: number;
  /** Files whose words were read. */
  files: number;
  errors: SearchPassError[];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The commit `main` is at, or null for a binder with no commits yet. */
async function readMainSha(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const branch = await unwrap(
      client.GET("/repos/{owner}/{repo}/branches/{branch}", {
        params: { path: { owner, repo, branch: "main" } },
      }),
    );
    return branch.commit?.id ?? null;
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) return null;
    throw err;
  }
}

/** One file's bytes at a commit. A commit never changes, so neither do they. */
async function readFileAt(
  client: GiteaClient,
  owner: string,
  repo: string,
  path: string,
  sha: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await client.GET("/repos/{owner}/{repo}/raw/{filepath}", {
    params: { path: { owner, repo, filepath: path }, query: { ref: sha } },
    parseAs: "arrayBuffer",
  });
  if (response.error !== undefined || response.data === undefined) {
    throw new GiteaApiError(
      response.response.status,
      `Gitea did not return ${path} at ${sha.slice(0, 12)}.`,
    );
  }
  return new Uint8Array(response.data as ArrayBuffer);
}

/**
 * One binder, brought up to `main`. Returns whether `main` had moved and how
 * many files were read; a file that will not open is indexed by its title and
 * named in `errors`.
 */
export async function indexBinder(params: {
  client: GiteaClient;
  store: SearchStore;
  repoId: number;
  orgId: number;
  owner: string;
  name: string;
  errors: SearchPassError[];
}): Promise<{ changed: boolean; files: number }> {
  const { client, store, repoId, orgId, owner, name, errors } = params;
  const known = store.binder(repoId);
  const mainSha = await readMainSha(client, owner, name);

  if (known && known.mainSha === (mainSha ?? "")) {
    store.renameBinder(repoId, owner, name);
    return { changed: false, files: 0 };
  }

  const tree = mainSha
    ? await readWorkspaceTree({
        client,
        org: owner,
        workspace: name,
        ref: mainSha,
      })
    : { documents: [] };
  const previous = new Map(
    store.documentsOf(repoId).map((document) => [document.blobSha, document]),
  );

  let files = 0;
  const documents: DocumentInput[] = [];
  for (const entry of tree.documents) {
    const input: DocumentInput = {
      path: entry.path,
      uid: entry.uid,
      slugPath: entry.slugPath,
      name: entry.name,
      folder: entry.folder,
      blobSha: entry.sha,
      passages: null,
    };
    // The same blob is the same words: moved or renamed, it is not read again.
    const unchanged = previous.get(entry.sha);
    if (
      unchanged &&
      (unchanged.uid === entry.uid || unchanged.path === entry.path)
    ) {
      documents.push({ ...input, unchanged: true });
      continue;
    }
    if (readableFormat(entry.path) !== null && mainSha) {
      try {
        const bytes = await readFileAt(
          client,
          owner,
          name,
          entry.path,
          mainSha,
        );
        input.passages = await extractPassages(entry.path, bytes);
        files += 1;
      } catch (err) {
        errors.push({
          binder: `${owner}/${name}`,
          path: entry.path,
          error: errorText(err),
        });
      }
    }
    documents.push(input);
  }

  store.writeBinder({
    repoId,
    orgId,
    owner,
    name,
    mainSha: mainSha ?? "",
    documents,
  });
  return { changed: true, files };
}

/**
 * Every binder of every organization, brought up to `main`.
 *
 * A binder Gitea could not read keeps its rows: stale beats missing. A binder
 * no longer listed under an organization that was listed is dropped, and so
 * is every binder of an organization Gitea no longer has.
 */
export async function sweepSearchIndex(params: {
  client: GiteaClient;
  store: SearchStore;
  organizations: readonly { giteaOrgId: number; name: string }[];
  now?: () => number;
}): Promise<SearchPass> {
  const { client, store, organizations } = params;
  const now = params.now ?? Date.now;
  const pass: SearchPass = {
    startedAt: now(),
    finishedAt: 0,
    binders: 0,
    changed: 0,
    files: 0,
    errors: [],
  };

  // An organization the index holds but the API's list does not — one made
  // outside Bindersnap, whose binder a search asked for — is swept under the
  // name its binders were filed with, and dropped only once Gitea says it is
  // gone (404, below).
  const live = new Set(
    organizations.map((organization) => organization.giteaOrgId),
  );
  const swept = [...organizations];
  for (const orgId of store.organizationIds()) {
    if (live.has(orgId)) continue;
    const owner = store.bindersOf(orgId)[0]?.owner;
    if (owner) swept.push({ giteaOrgId: orgId, name: owner });
  }

  for (const organization of swept) {
    let binders;
    try {
      binders = await listOrganizationWorkspaces({
        client,
        org: organization.name,
      });
    } catch (err) {
      if (err instanceof GiteaApiError && err.status === 404) {
        for (const binder of store.bindersOf(organization.giteaOrgId)) {
          store.removeBinder(binder.repoId);
        }
        continue;
      }
      pass.errors.push({
        binder: `${organization.name}/*`,
        error: errorText(err),
      });
      continue;
    }

    const listed = new Set(binders.map((binder) => binder.id));
    for (const binder of store.bindersOf(organization.giteaOrgId)) {
      if (!listed.has(binder.repoId)) store.removeBinder(binder.repoId);
    }

    for (const binder of binders) {
      pass.binders += 1;
      try {
        const result = await indexBinder({
          client,
          store,
          repoId: binder.id,
          orgId: organization.giteaOrgId,
          owner: binder.owner || organization.name,
          name: binder.name,
          errors: pass.errors,
        });
        if (result.changed) pass.changed += 1;
        pass.files += result.files;
      } catch (err) {
        pass.errors.push({
          binder: `${organization.name}/${binder.name}`,
          error: errorText(err),
        });
      }
    }
  }

  pass.finishedAt = now();
  return pass;
}

/**
 * Runs passes one at a time: a sweep and a publish's binder never write the
 * index at once, and a second request for a sweep already queued is the same
 * sweep.
 */
export class SearchIndexer {
  private queue: Promise<unknown> = Promise.resolve();
  private sweepQueued: Promise<SearchPass | null> | null = null;
  private refreshQueued = new Map<string, Promise<void>>();
  lastSweep: SearchPass | null = null;

  constructor(
    private readonly deps: {
      client: () => GiteaClient | null;
      store: () => SearchStore;
      organizations: () => Promise<{ giteaOrgId: number; name: string }[]>;
    },
  ) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Every binder. Null with no client to read with. */
  sweep(): Promise<SearchPass | null> {
    this.sweepQueued ??= this.enqueue(async () => {
      this.sweepQueued = null;
      const client = this.deps.client();
      if (!client) return null;
      const pass = await sweepSearchIndex({
        client,
        store: this.deps.store(),
        organizations: await this.deps.organizations(),
      });
      this.lastSweep = pass;
      for (const error of pass.errors) {
        logger.warn("Search index could not read", { ...error });
      }
      logger.info("Search index pass finished", {
        binders: pass.binders,
        changed: pass.changed,
        files: pass.files,
        errors: pass.errors.length,
        ms: pass.finishedAt - pass.startedAt,
      });
      return pass;
    });
    return this.sweepQueued;
  }

  /**
   * One binder, now: after a publish, so what was published is found, or
   * the first time a search meets a binder the index has not read. Asked
   * twice before it runs, it runs once.
   */
  refresh(owner: string, repo: string): Promise<void> {
    const key = `${owner}/${repo}`.toLowerCase();
    const queued = this.refreshQueued.get(key);
    if (queued) return queued;
    const work = this.enqueue(async () => {
      this.refreshQueued.delete(key);
      const client = this.deps.client();
      if (!client) return;
      const found = await unwrap(
        client.GET("/repos/{owner}/{repo}", {
          params: { path: { owner, repo } },
        }),
      );
      const errors: SearchPassError[] = [];
      await indexBinder({
        client,
        store: this.deps.store(),
        repoId: found.id ?? 0,
        orgId: found.owner?.id ?? 0,
        owner: found.owner?.login ?? owner,
        name: found.name ?? repo,
        errors,
      });
      for (const error of errors) {
        logger.warn("Search index could not read", { ...error });
      }
    });
    this.refreshQueued.set(key, work);
    return work;
  }
}
