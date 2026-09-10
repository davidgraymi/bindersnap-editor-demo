import {
  buildDocumentVersionTag,
  documentUidFromVersionTag,
  parseDocumentFilename,
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
  /** `clinical/infection-control.01J8XZ4K7M….pdf` — where the file is. */
  path: string;
  /**
   * `clinical/infection-control` — the document's **address**: where it is
   * filed and what it is called, with neither the identity nor the extension.
   *
   * This is what a URL carries and what a person reads. Under ADR 0004 it was
   * also the identity; ADR 0005 separates them, so this may change over a
   * document's life and {@link uid} may not.
   */
  slugPath: string;
  /** The last segment, for a heading: `infection-control`. */
  name: string;
  /**
   * The document's identity, or null for a file this product did not write.
   *
   * Null is a real state in a tree — somebody committed a `NOTES.md` outside
   * Bindersnap — and it is described rather than hidden, so the publish guard
   * can refuse it by name instead of the version series quietly going wrong.
   */
  uid: string | null;
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

  // Three things out of one filename: what it is called, which document it is,
  // and how to render it. The address drops the last two — `hand-hygiene`, not
  // `hand-hygiene.01J8XZ4K7M….md` — because that is what a link carries and
  // what a heading says.
  const { name, uid } = parseDocumentFilename(filename);

  return {
    path,
    slugPath: folder === "" ? name : `${folder}/${name}`,
    name,
    uid,
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
 * One document, addressed by file path or by address.
 *
 * A URL carries `clinical/infection-control`; a link out of a commit or a
 * change carries the full `clinical/infection-control.01J8XZ4K7M….pdf`. Both
 * resolve, because neither the identity segment nor the extension is how a
 * person refers to a policy.
 */
export async function findWorkspaceDocument(
  params: FindWorkspaceDocumentParams,
): Promise<WorkspaceDocumentEntry | null> {
  const { documentPath } = params;
  const documents = await listWorkspaceDocuments(params);

  // An exact file path wins over an address match, so that a link carrying the
  // whole filename always resolves to that exact file. Uploads refuse to create
  // two documents at one address, but a binder edited outside Bindersnap could
  // still hold two — and resolving that deterministically beats resolving it
  // alphabetically.
  return (
    documents.find((entry) => entry.path === documentPath) ??
    documents.find((entry) => entry.slugPath === documentPath) ??
    null
  );
}

export interface DocumentVersion {
  tag: string;
  version: number;
  commitSha: string;
  /**
   * When the commit this tag points at was made — which is when the change
   * that published it was merged.
   *
   * On the tag Gitea already returns, so a binder's whole history is one call.
   * Empty when Gitea did not say, which a reader is told rather than shown a
   * date we invented.
   */
  publishedAt: string;
}

export interface GitTag {
  name?: string;
  commit?: { sha?: string; created?: string };
}

/**
 * The published versions of one document.
 *
 * Tags are repository-global and a binder holds many documents, so the tags are
 * filtered by the document's own namespace — `01J8XZ4K7M…` owns
 * `01J8XZ4K7M…/v1`, `…/v2`, and nothing else. Tags this app did not write are
 * ignored rather than counted as versions.
 *
 * One call per document, so it is for the pages that are about one document.
 * {@link listVersionsByDocument} answers the same question for a whole binder
 * in a single read, and is what every list uses.
 */
export async function listDocumentVersions(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  /**
   * The document's identity. A path would restart at v1 on a rename.
   *
   * Null for a file with no identity segment, which has published nothing and
   * answers with nothing — a caller listing a binder should not have to branch
   * on it, and the refusal belongs at publish, where it can be a sentence.
   */
  uid: string | null;
}): Promise<DocumentVersion[]> {
  const { client, org, workspace, uid } = params;
  if (uid === null) return [];

  const tags = (await unwrap(
    client.GET("/repos/{owner}/{repo}/tags", {
      params: { path: { owner: org, repo: workspace } },
    }),
  )) as GitTag[];

  return (tags ?? [])
    .flatMap((tag) => {
      const name = tag.name ?? "";
      if (documentUidFromVersionTag(name) !== uid) return [];

      const version = versionFromTag(name);
      if (version === null) return [];

      return [
        {
          tag: name,
          version,
          commitSha: tag.commit?.sha ?? "",
          publishedAt: tag.commit?.created ?? "",
        },
      ];
    })
    .sort((a, b) => b.version - a.version);
}

/** The next version number for a document, starting at 1. */
export function nextVersionFrom(versions: DocumentVersion[]): number {
  return versions.reduce((highest, v) => Math.max(highest, v.version), 0) + 1;
}

/** The tag that would publish this document's next version. */
export function nextVersionTag(
  uid: string,
  versions: DocumentVersion[],
): string {
  return buildDocumentVersionTag(uid, nextVersionFrom(versions));
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
 * change publish v4 of one policy, v2 of another and v7 of a third together
 * while keeping each document's version its own.
 *
 * **Two changes publishing one document at once both compute the same version
 * and both try to create this ref. Git refuses the second**, atomically, and
 * the caller gets a conflict instead of two v4s. That guarantee is the reason
 * the tag is the counter rather than a column somewhere.
 */
export async function createDocumentVersionTag(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  /** The document's identity, which is what the tag is named after. */
  uid: string;
  /** Where it was filed at the publish. For the fallback message only. */
  slugPath: string;
  version: number;
  target: string;
  /**
   * The approval policy in force, written into the annotated tag.
   *
   * ADR 0004: when configuration shapes what happened, do not version the
   * configuration — stamp it onto the event. The tag is immutable, attached to
   * the exact publish, and readable from a bare clone with no application
   * running, which is what makes it better evidence than a settings row a
   * surveyor would have to be told to trust.
   *
   * Optional so a caller with nothing to say still writes a usable tag rather
   * than a misleading one.
   */
  message?: string;
}): Promise<DocumentVersion> {
  const { client, org, workspace, uid, slugPath, version, target } = params;
  const tagName = buildDocumentVersionTag(uid, version);

  const tag = (await unwrap(
    client.POST("/repos/{owner}/{repo}/tags", {
      params: { path: { owner: org, repo: workspace } },
      body: {
        tag_name: tagName,
        target,
        message: params.message ?? `Published ${slugPath} v${version}`,
      },
    }),
  )) as GitTag;

  return {
    tag: tagName,
    version,
    commitSha: tag?.commit?.sha ?? "",
    publishedAt: tag?.commit?.created ?? "",
  };
}

interface GitBranch {
  name?: string;
}

/**
 * A document proposed at this address but not yet published, if there is one.
 *
 * `main` holds only published documents, so checking the tree alone lets two
 * uploads race for one address: both are accepted, and they collide later as
 * two files answering to a single URL. The upload branch carries the identity
 * (`upload/<slugPath>/…`), which is what makes pending work visible here.
 *
 * Answers with the branch name so the caller can say which change already
 * claims the address, rather than only that something does.
 */
export async function findPendingDocumentBranch(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  slugPath: string;
}): Promise<string | null> {
  const { client, org, workspace, slugPath } = params;

  try {
    const branches = (await unwrap(
      client.GET("/repos/{owner}/{repo}/branches", {
        params: {
          path: { owner: org, repo: workspace },
          query: { limit: 100 },
        },
      }),
    )) as GitBranch[];

    const prefix = `upload/${slugPath}/`;
    return (
      (branches ?? []).find((branch) => (branch.name ?? "").startsWith(prefix))
        ?.name ?? null
    );
  } catch (err) {
    // A binder with no branches yet is not a conflict.
    if (err instanceof GiteaApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Every tag in a repository, following Gitea's pagination to the end.
 *
 * **Gitea's tag list is paged and the defaults are small**, which this code
 * used to ignore in two different ways — verified against a running Gitea on
 * 2026-09-08 by making a repository with sixty tags:
 *
 * | Request      | Tags returned |
 * | ------------ | ------------- |
 * | no params    | 30            |
 * | `limit=100`  | **50**        |
 * | `limit=50`   | 50            |
 *
 * So an unparameterised read saw thirty, and asking for a hundred silently got
 * fifty — `MaxResponseItems` caps it. Neither said anything about the rest.
 *
 * A binder's tags are its **version history**, so truncating them is not a
 * display bug. Thirty versions is ten documents at v3: past that, the binder's
 * History tab — the compliance record, the thing a surveyor is shown — would
 * quietly stop listing versions that exist, and `nextVersionFrom` would compute
 * a next version that has already been used.
 *
 * This is the same defect the implementation notes already record once, about
 * the document list: "The unpaged read asked Gitea for a hardcoded 100 and
 * silently dropped anything past it, so a workspace's 101st document simply did
 * not exist as far as this list was concerned." Same shape, different endpoint.
 *
 * A binder that has published nothing costs one call, as before. The pages are
 * fetched in sequence rather than in parallel because the total is not known
 * until a short page arrives — and a mature binder is the rare case, not the
 * page-load one.
 */
export async function listAllTags(params: {
  client: GiteaClient;
  owner: string;
  repo: string;
}): Promise<GitTag[]> {
  const { client, owner, repo } = params;

  // Gitea's ceiling. Asking for more is not an error, it is silently this.
  const PAGE_SIZE = 50;
  // A stop that cannot be reached by any real binder — 500 pages is 25,000
  // versions — but that turns a Gitea that ignored `page` from an infinite
  // loop into a bounded read.
  const MAX_PAGES = 500;

  const all: GitTag[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = (await unwrap(
      client.GET("/repos/{owner}/{repo}/tags", {
        params: {
          path: { owner, repo },
          query: { page, limit: PAGE_SIZE },
        },
      }),
    )) as GitTag[];

    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return all;
}

/**
 * Every document's versions, from one read of the binder's tags.
 *
 * {@link listDocumentVersions} asks per document, which is one call each; a
 * binder's tags are repository-global, so asking once and grouping is the same
 * answer for the cost of a single call. That difference is the whole reason
 * ADR 0004 expects the documents list to get cheaper rather than dearer.
 *
 * **Keyed by address, from tags named after identities.** The tags say
 * `01J8XZ4K7M…/v4`; every caller wants `clinical/infection-control`, because
 * that is what its rows and its URLs are keyed on. The tree is what joins the
 * two, and it is a read most callers have already made — hence `documents`.
 * Pass it and this costs exactly what it did before; omit it and it reads the
 * tree itself rather than making the caller thread one through.
 *
 * **A tag whose identity names no document in the tree is left out**, which is
 * the one behaviour worth stating plainly. It cannot happen through the
 * product: nothing deletes a document and nothing strips an identity segment.
 * It can happen to a binder somebody edited directly in Gitea — the assumption
 * ADR 0005 records that it rests on — and to tags written under ADR 0004's
 * `<slugPath>/vN` shape, which are not versions of anything now and which the
 * seed replaces. Reporting them is the orphan check the ADR describes, and it
 * is a set difference over exactly these two inputs on the day it is wanted.
 */
export async function listVersionsByDocument(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  /**
   * The binder's tree, if the caller has already read it.
   *
   * Most callers have — a list needs both — and passing it keeps this at one
   * call. A caller that has not gets the tree read for it rather than being
   * made to thread one through.
   */
  documents?: WorkspaceDocumentEntry[];
}): Promise<Map<string, DocumentVersion[]>> {
  const { client, org, workspace } = params;

  const [tags, documents] = await Promise.all([
    listAllTags({ client, owner: org, repo: workspace }),
    params.documents ?? listWorkspaceDocuments({ client, org, workspace }),
  ]);

  return groupVersionsByDocument(tags, documents);
}

/**
 * The joining rule on its own, for a caller that already holds both reads.
 *
 * Separate from the call above so that `readBinderDocuments` can fetch the
 * tree, the open changes and the tags in one `Promise.all` and still be three
 * calls for a whole binder — which is the property ADR 0004 exists to buy and
 * the one this must not quietly spend.
 */
export function groupVersionsByDocument(
  tags: readonly GitTag[],
  documents: readonly WorkspaceDocumentEntry[],
): Map<string, DocumentVersion[]> {
  const addressOf = new Map<string, string>();
  for (const document of documents) {
    if (document.uid !== null) addressOf.set(document.uid, document.slugPath);
  }

  const byDocument = new Map<string, DocumentVersion[]>();

  for (const tag of tags ?? []) {
    const name = tag.name ?? "";
    const uid = documentUidFromVersionTag(name);
    const version = versionFromTag(name);
    if (uid === null || version === null) continue;

    const slugPath = addressOf.get(uid);
    if (slugPath === undefined) continue;

    const entry = {
      tag: name,
      version,
      commitSha: tag.commit?.sha ?? "",
      publishedAt: tag.commit?.created ?? "",
    };
    const existing = byDocument.get(slugPath);
    if (existing) {
      existing.push(entry);
    } else {
      byDocument.set(slugPath, [entry]);
    }
  }

  for (const versions of byDocument.values()) {
    versions.sort((a, b) => b.version - a.version);
  }

  return byDocument;
}
