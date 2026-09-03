import {
  buildDocumentVersionTag,
  documentSlugPathFromVersionTag,
  versionFromTag,
} from "../../../packages/utils/documentPath";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";

/**
 * Reading the documents out of a binder.
 *
 * ADR 0004's step 2 changes what a document list is. It used to be a repository
 * search — one repository per document, three Gitea calls each. It is now one
 * walk of one repository's tree, which the ADR points out is the direction the
 * binder model makes cheaper: "the documents list drops from roughly three
 * Gitea calls per document to a handful per workspace".
 */

/** A document as the binder holds it: a file at a path. */
export interface WorkspaceDocumentEntry {
  /** `clinical/infection-control.pdf` — where the file is. */
  path: string;
  /** `clinical/infection-control` — the document's identity. */
  slugPath: string;
  /** The last segment, for a heading: `infection-control`. */
  name: string;
  /** `clinical`, or "" at the binder's root. */
  folder: string;
  /** Bytes, as git reports them. */
  size: number;
  /** The blob SHA. Changes whenever the content does. */
  sha: string;
}

interface GitTreeEntry {
  path?: string;
  type?: string;
  size?: number;
  sha?: string;
}

/**
 * Everything git tracks that we do not treat as a document.
 *
 * A binder is a repository, so it carries repository furniture — the
 * CODEOWNERS file that drives per-folder reviewers, and anything else under
 * `.gitea/`. Listing those as policies would put configuration in front of a
 * surveyor.
 */
function isDocumentPath(path: string): boolean {
  if (path.startsWith(".")) return false;
  if (path.split("/").some((segment) => segment.startsWith("."))) return false;
  return true;
}

export function toDocumentEntry(
  entry: GitTreeEntry,
): WorkspaceDocumentEntry | null {
  const path = entry.path ?? "";
  if (entry.type !== "blob" || path === "" || !isDocumentPath(path)) {
    return null;
  }

  const lastSlash = path.lastIndexOf("/");
  const folder = lastSlash === -1 ? "" : path.slice(0, lastSlash);
  const filename = lastSlash === -1 ? path : path.slice(lastSlash + 1);

  // The identity is the path without its extension. A file with no extension
  // is its own identity — `readme` is a document, not a broken one.
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot <= 0 ? filename : filename.slice(0, lastDot);

  return {
    path,
    slugPath: folder === "" ? stem : `${folder}/${stem}`,
    name: stem,
    folder,
    size: entry.size ?? 0,
    sha: entry.sha ?? "",
  };
}

export interface ListWorkspaceDocumentsParams {
  client: GiteaClient;
  org: string;
  workspace: string;
  ref?: string;
}

/**
 * The binder's documents, from one recursive tree read.
 *
 * An empty binder answers with an empty list rather than an error: a workspace
 * somebody just made has no documents yet, and that is the ordinary first
 * state, not a failure.
 */
export async function listWorkspaceDocuments(
  params: ListWorkspaceDocumentsParams,
): Promise<WorkspaceDocumentEntry[]> {
  const { client, org, workspace, ref = "main" } = params;

  let tree: { tree?: GitTreeEntry[] };
  try {
    tree = (await unwrap(
      client.GET("/repos/{owner}/{repo}/git/trees/{sha}", {
        params: {
          path: { owner: org, repo: workspace, sha: ref },
          query: { recursive: true },
        },
      }),
    )) as { tree?: GitTreeEntry[] };
  } catch (err) {
    // A binder whose `main` has no commits yet answers 404 for its tree. That
    // is an empty binder, which is a state, not a problem.
    if (err instanceof GiteaApiError && err.status === 404) {
      return [];
    }
    throw err;
  }

  return (tree.tree ?? [])
    .map(toDocumentEntry)
    .filter((entry): entry is WorkspaceDocumentEntry => entry !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface FindWorkspaceDocumentParams {
  client: GiteaClient;
  org: string;
  workspace: string;
  /** Either the file path or the slug path — a person's URL carries either. */
  documentPath: string;
  ref?: string;
}

/**
 * One document, addressed by file path or by identity.
 *
 * A URL may carry `clinical/infection-control` or
 * `clinical/infection-control.pdf`, and both should resolve. The extension is
 * how we render the document, not how a person refers to it.
 */
export async function findWorkspaceDocument(
  params: FindWorkspaceDocumentParams,
): Promise<WorkspaceDocumentEntry | null> {
  const { documentPath } = params;
  const documents = await listWorkspaceDocuments(params);

  return (
    documents.find(
      (entry) => entry.path === documentPath || entry.slugPath === documentPath,
    ) ?? null
  );
}

export interface DocumentVersion {
  tag: string;
  version: number;
  commitSha: string;
}

interface GitTag {
  name?: string;
  commit?: { sha?: string };
}

/**
 * The published versions of one document.
 *
 * Tags are repository-global and a binder holds many documents, so the tags
 * are filtered by the document's own namespace — `clinical/infection-control`
 * owns `clinical/infection-control/v1`, `…/v2`, and nothing else. Tags this
 * app did not write are ignored rather than counted as versions.
 *
 * The ADR is explicit that this walk is what the `document_versions` derived
 * index will eventually make cheap. Until that index exists, correctness comes
 * first: these tags are the evidence, and reading them is never wrong.
 */
export async function listDocumentVersions(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  slugPath: string;
}): Promise<DocumentVersion[]> {
  const { client, org, workspace, slugPath } = params;

  const tags = (await unwrap(
    client.GET("/repos/{owner}/{repo}/tags", {
      params: { path: { owner: org, repo: workspace } },
    }),
  )) as GitTag[];

  return (tags ?? [])
    .flatMap((tag) => {
      const name = tag.name ?? "";
      if (documentSlugPathFromVersionTag(name) !== slugPath) return [];

      const version = versionFromTag(name);
      if (version === null) return [];

      return [{ tag: name, version, commitSha: tag.commit?.sha ?? "" }];
    })
    .sort((a, b) => b.version - a.version);
}

/** The next version number for a document, starting at 1. */
export function nextVersionFrom(versions: DocumentVersion[]): number {
  return versions.reduce((highest, v) => Math.max(highest, v.version), 0) + 1;
}

/** The tag that would publish this document's next version. */
export function nextVersionTag(
  slugPath: string,
  versions: DocumentVersion[],
): string {
  return buildDocumentVersionTag(slugPath, nextVersionFrom(versions));
}

interface ChangedFile {
  filename?: string;
}

/**
 * The documents a change touches.
 *
 * ADR 0004 §4: the unit of approval is the change, not the document. A pull
 * request that revises three cross-referencing policies together is a feature
 * — they should be revised and approved as one act — so publishing has to know
 * every document it covers, not just one.
 *
 * Repository furniture is filtered out the same way it is in the list: a change
 * that edits CODEOWNERS alongside two policies publishes two versions, not
 * three.
 */
export async function listChangedDocuments(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  pullNumber: number;
}): Promise<WorkspaceDocumentEntry[]> {
  const { client, org, workspace, pullNumber } = params;

  const files = (await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls/{index}/files", {
      params: { path: { owner: org, repo: workspace, index: pullNumber } },
    }),
  )) as ChangedFile[];

  const seen = new Set<string>();
  const documents: WorkspaceDocumentEntry[] = [];

  for (const file of files ?? []) {
    const entry = toDocumentEntry({ path: file.filename ?? "", type: "blob" });
    if (!entry || seen.has(entry.slugPath)) continue;

    seen.add(entry.slugPath);
    documents.push(entry);
  }

  return documents.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Publish one document: a tag naming it, pointing at the merge commit.
 *
 * Several tags on one commit is ordinary git, and it is what lets one approved
 * change publish `infection-control/v4`, `handover/v2` and `medication/v7`
 * together while keeping each document's version its own.
 */
export async function createDocumentVersionTag(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  slugPath: string;
  version: number;
  target: string;
}): Promise<DocumentVersion> {
  const { client, org, workspace, slugPath, version, target } = params;
  const tagName = buildDocumentVersionTag(slugPath, version);

  const tag = (await unwrap(
    client.POST("/repos/{owner}/{repo}/tags", {
      params: { path: { owner: org, repo: workspace } },
      body: {
        tag_name: tagName,
        target,
        message: `Published ${slugPath} v${version}`,
      },
    }),
  )) as GitTag;

  return {
    tag: tagName,
    version,
    commitSha: tag?.commit?.sha ?? "",
  };
}
