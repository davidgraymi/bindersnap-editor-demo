/**
 * What the binder's document page shows, decided away from the rendering.
 *
 * ADR 0004 made a document a file at a path inside a binder, so everything the
 * old per-document page derived from `owner/repo` now comes from a path and a
 * set of version tags. Kept out of the component so the wording of a version,
 * a trail, or an address is settled in one place and can be tested without
 * rendering anything.
 */

import type {
  DocumentVersion,
  WorkspaceDocumentEntry,
  WorkspaceDocumentState,
} from "../../packages/api-schema/schemas/workspaces";
import { formatDocumentName } from "./documentDisplay";

/** One step of the trail from the organization down to the document. */
export interface BinderCrumb {
  label: string;
  /** Where clicking it goes, or null for the step you are already on. */
  href: string | null;
}

/**
 * `Riverside Health / Clinical Policies / nursing / Hand Hygiene`.
 *
 * The folders are steps rather than a single joined label because a folder is
 * a directory a customer made to find things in, and the way you use it is by
 * going back to it. They have no page of their own yet, so they are shown
 * without a link rather than as a link that would go nowhere.
 */
export function buildDocumentCrumbs(params: {
  org: string;
  binder: string;
  document: Pick<WorkspaceDocumentEntry, "folder" | "name">;
}): BinderCrumb[] {
  const { org, binder, document } = params;

  const folders = document.folder === "" ? [] : document.folder.split("/");

  return [
    { label: org, href: `/${org}` },
    { label: binder, href: `/${org}/${binder}` },
    ...folders.map((segment) => ({ label: segment, href: null })),
    { label: formatDocumentName(document.name), href: null },
  ];
}

/**
 * Which git ref the page is reading, given the version asked for in the URL.
 *
 * `main` is the version on record rather than a tag, deliberately: it is what
 * a reader wants by default, and it stays right when a new version is
 * published while the page is open. An older version is read at its own tag,
 * which is the evidence rather than a copy of it.
 */
export function resolveDocumentRef(params: {
  versions: DocumentVersion[];
  /** The version the URL asks for, or null for the one on record. */
  requestedVersion: number | null;
  /**
   * Where the document's file is when nothing is published: the change's own
   * branch, from the server. `main` has nothing to give a proposed document,
   * so without this the page would render "not found" over a file that is
   * right there in the change somebody just opened.
   */
  recordRef?: string;
}): { ref: string; version: DocumentVersion | null; missing: boolean } {
  const { versions, requestedVersion, recordRef = "main" } = params;
  const latest = versions[0] ?? null;

  if (requestedVersion === null || requestedVersion === latest?.version) {
    return { ref: recordRef, version: latest, missing: false };
  }

  const asked = versions.find((entry) => entry.version === requestedVersion);
  if (!asked) {
    return { ref: recordRef, version: latest, missing: true };
  }

  return { ref: asked.tag, version: asked, missing: false };
}

/**
 * "Version 4 on record", or what is true of it so far.
 *
 * A document with no published version is not broken — it is one somebody has
 * uploaded and nobody has approved yet, which is the ordinary state of every
 * document for a while.
 */
export function describeVersionState(
  latestVersion: DocumentVersion | null,
  state: WorkspaceDocumentState = "published",
): string {
  if (latestVersion) return `Version ${latestVersion.version} on record`;
  // A document that has never reached `main` is waiting on a decision, not
  // missing one. "No published version" reads like a fault; this does not.
  return state === "proposed" ? "In review" : "No published version yet";
}

/** The file name a download should land under: `hand-hygiene.pdf`. */
export function downloadFileName(document: WorkspaceDocumentEntry): string {
  const lastSlash = document.path.lastIndexOf("/");
  return lastSlash === -1 ? document.path : document.path.slice(lastSlash + 1);
}

/**
 * Which version the address bar is asking for, or null for the record.
 *
 * The version rides in the query rather than in the path because the path is
 * already the document — a `/version/2` suffix would be indistinguishable from
 * a policy filed in a folder called `version`. It is in the URL at all because
 * an earlier version is a thing people link to, quote in a ticket, and send to
 * a surveyor.
 */
export function parseRequestedVersion(search: string): number | null {
  return parsePositiveIntParam(search, "version");
}

/**
 * One positive whole number out of the query string, or null.
 *
 * Shared with the change page, which reads `?change=` the same way and for the
 * same reason. Anything that is not a counting number is treated as absent
 * rather than as an error: a mangled link should show the page, not a fault.
 */
export function parsePositiveIntParam(
  search: string,
  key: string,
): number | null {
  const raw = new URLSearchParams(search).get(key);
  if (raw === null) return null;

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** `/{org}/{binder}/{path}`, with the version only when one is being read. */
export function buildDocumentUrl(params: {
  org: string;
  binder: string;
  documentPath: string;
  version: number | null;
}): string {
  const { org, binder, documentPath, version } = params;
  const base = `/${org}/${binder}/${documentPath}`;
  return version === null ? base : `${base}?version=${version}`;
}
