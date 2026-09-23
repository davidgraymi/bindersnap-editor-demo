/**
 * The declarative seed format.
 *
 * Local seed data is described in `tests/seed-data/dev.yaml`, not in code. A
 * developer who wants a document that is stuck in review, or one more reviewer
 * on an existing change, edits that file — they never have to read the ordering
 * of API calls in `seed.ts` to work out what the stack will contain.
 *
 * This module owns the contract between the two: the types, the parser, and the
 * validation that turns a typo into a readable error instead of a Gitea 422 in
 * the middle of a `docker compose up`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

import { documentUidFrom } from "../packages/utils/documentUid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A person. Every seeded account shares the scenario's `password`. */
export interface SeedUser {
  username: string;
  fullName: string;
  email: string;
  /** Shown in the YAML to explain why the account exists. Not sent to Gitea. */
  role?: string;
  /**
   * A Gitea site administrator — whoever runs Bindersnap itself.
   *
   * A level above owning an organization, and worth having one of in the seed:
   * the admin screens are otherwise unreachable without promoting an account by
   * hand. The install's first account is one whether or not this says so, so
   * this exists to make the *second* one, and to say out loud which account is
   * which.
   */
  siteAdmin: boolean;
  /**
   * Whether this account belongs to the scenario's organization.
   *
   * False is the state nothing else in the seed could produce: somebody who has
   * signed up and belongs nowhere. Every screen behind an organization has to
   * do something sensible for them, and the only way to find out what it does
   * today is to have an account in that state to sign in as.
   */
  organizationMember: boolean;
}

/** One paragraph-and-heading block of a document body. */
export interface SeedSection {
  heading?: string;
  paragraphs: string[];
}

/** A document's contents, written as prose rather than as TipTap JSON. */
export interface SeedDocument {
  title: string;
  sections: SeedSection[];
}

/**
 * What the document is stored as.
 *
 * A regulated team's policy manual is not one file type. Some policies are
 * Word files somebody has been editing since 2019, some are PDFs exported for
 * a surveyor, and some live in Markdown on an intranet. The seed carries one
 * of each so the review screens — the preview and the comparison especially —
 * can be looked at against every kind of file the app actually meets.
 *
 * The prose in the YAML is the same either way; only the rendering differs.
 */
export type SeedDocumentFormat = "prosemirror" | "markdown" | "pdf" | "docx";

export const SEED_DOCUMENT_FORMATS = [
  "prosemirror",
  "markdown",
  "pdf",
  "docx",
] as const satisfies readonly SeedDocumentFormat[];

/**
 * The file every version of a document is committed to.
 *
 * The BFF finds a document's file by looking for `document.<ext>`
 * (`inferStoredDocumentFileName`), so the seed has to agree with it — a
 * mismatch produces a repo the app cannot read a single version out of.
 */
/**
 * The instant every seeded identity is stamped with.
 *
 * The same one `seed-documents.ts` freezes its generated files at, and for the
 * same reason: a seed that produced different bytes on every run would make
 * every `bun run up` a change to every document.
 */
const SEED_INSTANT = Date.parse("2026-01-05T09:00:00Z");

/**
 * A seeded document's identity — derived, not minted.
 *
 * Every document Bindersnap creates gets a ULID minted at upload (ADR 0005),
 * and the seed cannot: it runs again on every `bun run up` and only rewrites
 * what changed, so a fresh identity each time would file the same policy under
 * a new name, orphan its tags, and restart it at v1 — which is precisely the
 * bug ADR 0005 exists to prevent, reproduced by the tool meant to demonstrate
 * the fix.
 *
 * Derived from where the document is filed and what the binder is, so two
 * policies with the same name in different binders are different documents and
 * the same policy is the same document on every run. A hash rather than a
 * counter because the YAML is edited: inserting a document at the top of the
 * list must not renumber everything below it.
 */
export function seedDocumentUid(
  organization: string,
  binder: string,
  slugPath: string,
): string {
  const digest = createHash("sha256")
    .update(`${organization}/${binder}/${slugPath}`)
    .digest();

  return documentUidFrom(SEED_INSTANT, new Uint8Array(digest));
}

export function canonicalFileNameFor(format: SeedDocumentFormat): string {
  switch (format) {
    case "markdown":
      return "document.md";
    case "pdf":
      return "document.pdf";
    case "docx":
      return "document.docx";
    case "prosemirror":
      return "document.json";
  }
}

export interface SeedReview {
  by: string;
  state: "approved" | "changes_requested" | "commented";
  body: string;
}

export interface SeedThread {
  /** Stable id so re-seeding updates the same thread instead of adding one. */
  id: string;
  by: string;
  body: string;
  replies: { by: string; body: string }[];
  resolved: boolean;
  /** Who resolved it. Defaults to the thread author. */
  resolvedBy?: string;
}

/**
 * Who a change is waiting on, as against who has already spoken.
 *
 * A requested reviewer is a review Gitea is holding the change for; a
 * {@link SeedReview} is one that has been given. They are separate fields
 * because they are separate facts, and a change routinely has both — four
 * people asked, one of whom has answered.
 */
export interface SeedAssignment {
  /** Who is expected to act on the change. One person, the way Gitea models it. */
  assignee?: string;
  /** Whose review has been asked for and not yet given. */
  reviewers: string[];
}

/** A proposed new version of a document — a branch plus its pull request. */
export interface SeedChange extends SeedAssignment {
  branch: string;
  title: string;
  summary: string;
  /** Who opens the change. Defaults to the document owner. */
  author?: string;
  document: SeedDocument;
  reviews: SeedReview[];
  threads: SeedThread[];
  /**
   * Merge the change and tag the result as the next published version.
   * A published change leaves no open pull request behind.
   */
  publish: boolean;
  /**
   * Close the change without publishing it.
   *
   * How it *reads* is not declared here, because the product does not store it:
   * a closed change with somebody's request for work standing against it is
   * **declined**, and one without is **withdrawn**. Say what happened and the
   * label falls out, the same way it does for a real change.
   */
  closed: boolean;
}

// ---------------------------------------------------------------------------
// Acts — what a change does that is not "here is a new version of one document"
// ---------------------------------------------------------------------------

/**
 * One thing a binder-level change does to the binder's shape or its rules.
 *
 * **Why these are not {@link SeedChange}.** A document's `changes` say "this
 * policy has a new version", which is the one act the seed could express and is
 * the minority of what a binder's change list actually holds. A folder gets
 * made, a policy gets refiled, three cross-referencing policies get revised in
 * one change, the sign-off rules get rewritten — none of those is about one
 * document and some are about none, so none could be written down.
 *
 * Each act is a mapping with exactly one key, named for the act. That reads in
 * YAML the way somebody would say it (`- newFolder: nursing/wards`) and makes a
 * misspelt act a parse error rather than a silently ignored line.
 */
export type SeedAct =
  /** Make a folder, empty. Becomes a committed `.gitkeep`. */
  | { kind: "newFolder"; folder: string }
  /** Rename a folder, or move it under another one. Everything beneath it goes. */
  | { kind: "renameFolder"; from: string; to: string }
  /**
   * Refile or rename a document — its address changes and its identity does
   * not, which is the whole of ADR 0005 in one act.
   */
  | { kind: "move"; from: string; to: string }
  /** A new version of a document already in the binder. */
  | { kind: "revise"; document: string; contents: SeedDocument }
  /** Take a document off the record. Its version tags stay where they are. */
  | { kind: "archive"; document: string }
  /** Rewrite `.gitea/CODEOWNERS` — who has to sign off on what. */
  | { kind: "signOff"; rules: SeedSignOffRule[] };

/**
 * A sign-off rule, said the way the settings screen says it.
 *
 * Mirrors `SignOffRule` in `packages/utils/codeowners.ts` with one deliberate
 * difference: a document is named by its **address** — `nursing/hand-hygiene` —
 * rather than by its identity, because a seed author knows where they filed a
 * policy and does not know the ULID the seed is about to derive for it. The
 * engine resolves the one into the other.
 */
export interface SeedSignOffRule {
  scope: "binder" | "folder" | "document" | "rules";
  /**
   * The folder, or the document's address. Empty for `binder` and `rules`,
   * which each name the only one there is.
   */
  target?: string;
  /** Organization groups, by handle. The preferred form — see ADR 0004. */
  teams: string[];
  /** Individual logins. Supported, rarely the right answer. */
  users: string[];
}

/**
 * A change about the binder rather than about one document.
 *
 * Same pull request, same reviews, same threads, same publish — a change is a
 * change. What differs is that it carries a list of {@link SeedAct}s instead of
 * one document's new contents, so it can touch several documents, none, or the
 * rules themselves.
 */
export interface SeedBinderChange extends SeedAssignment {
  branch: string;
  title: string;
  summary: string;
  /** Who opens the change. Defaults to the organization's owner. */
  author?: string;
  acts: SeedAct[];
  reviews: SeedReview[];
  threads: SeedThread[];
  publish: boolean;
  /** Close it without publishing. See {@link SeedChange.closed}. */
  closed: boolean;
}

export interface SeedCollaborator {
  user: string;
  permission: "read" | "write" | "admin";
}

/**
 * A document: a file inside a binder, at a path.
 *
 * ADR 0004's fourth level. It used to be a repository of its own, which is why
 * this once carried an `owner` — a document belonged to whoever made it. It
 * belongs to the organization now, and the binder decides who may act on it.
 */
export interface SeedBinderDocument {
  /** Becomes the file's name inside the binder. */
  name: string;
  /** A directory inside the binder. Omit for a document at its root. */
  folder?: string;
  description: string;
  /** How every version of this document is stored. Defaults to the editor's JSON. */
  format: SeedDocumentFormat;
  /** Applied in order. Published ones become `<slugPath>/vN` tags. */
  changes: SeedChange[];
}

/** Which of the binder's three role teams somebody is in. */
export type SeedBinderRole = "admins" | "authors" | "reviewers";

export interface SeedBinderMember {
  user: string;
  role: SeedBinderRole;
}

/**
 * A binder: one Gitea repository owned by the organization.
 *
 * "If you need different rules or different people, make a workspace. If you
 * just need to find things, make a folder." Members are the binder's, because
 * access is uniform within one — that is the whole reason the level exists.
 */
export interface SeedBinder {
  name: string;
  description: string;
  members: SeedBinderMember[];
  /**
   * Organization groups granted onto this binder, by handle.
   *
   * The reason the level exists: a Quality Committee that reviews three binders
   * is one membership list adopted three times. A group also has to be granted
   * here before a sign-off rule can name it — a rule naming a group with no
   * access is a gate nobody can open.
   */
  groups: string[];
  /**
   * Whether the whole organization can read this binder.
   *
   * Grants the org's `staff` team, which is the product's "open to the
   * organization" switch rather than Gitea's repository visibility. Left off,
   * a binder is readable only by the people in its own teams — which is what
   * makes an HR investigation binder possible at all.
   */
  openToOrganization: boolean;
  /** How many approvals a change here needs. Defaults to one. */
  requiredApprovals: number;
  /**
   * The sign-off rules already in force on `main`.
   *
   * Committed before `main` is protected, so they are the rules governing every
   * change the seed then opens — including, if the binder has one, the change
   * that proposes changing them. A binder with none of these is as real a state
   * as a binder with a dozen and is worth having one of.
   */
  signOff: SeedSignOffRule[];
  documents: SeedBinderDocument[];
  /**
   * Changes about the binder rather than about one document, applied after
   * every document's own — so a folder rename has folders to rename and a move
   * has a document to move.
   */
  changes: SeedBinderChange[];
}

/** One of the customer's own reusable groups. A Gitea team, at one level. */
export interface SeedGroup {
  /** The handle, which is the Gitea team name and what CODEOWNERS writes. */
  name: string;
  /**
   * What the group may do wherever it is granted.
   *
   * A Gitea team carries one unit map, so the level travels with the name: a
   * group cannot be an editor in one binder and a reviewer in another.
   */
  level: "admin" | "editor" | "reviewer";
  description: string;
  members: string[];
}

/** The organization that owns every binder, and is who we bill. */
export interface SeedOrganization {
  /** The Gitea org username — a URL segment. */
  name: string;
  /** What its owner calls it. */
  displayName: string;
  /** The account that creates it, and therefore owns it. */
  owner: string;
  /**
   * Further members of the built-in Owners team.
   *
   * An organization owner who is *not* the site administrator is the persona
   * the seed had no way to express, and it is the one most of the billing and
   * people screens are written for. Gitea puts the creating account in Owners
   * by itself; everyone here is added to it afterwards.
   */
  owners: string[];
  groups: SeedGroup[];
}

export interface SeedScenario {
  /** The password every seeded account is created with. */
  password: string;
  users: SeedUser[];
  organization: SeedOrganization;
  binders: SeedBinder[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

class SeedScenarioError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SeedScenarioError";
  }
}

function fail(path: string, message: string): never {
  throw new SeedScenarioError(path, message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected a mapping");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(path, "expected a list");
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "expected a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, path);
}

function asBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") fail(path, "expected true or false");
  return value;
}

function asPositiveInt(value: unknown, path: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(path, "expected a whole number of one or more");
  }
  return value;
}

/** A list of names — reviewers, group members, the users on a rule. */
function asStringList(value: unknown, path: string): string[] {
  return asArray(value, path).map((entry, index) =>
    asString(entry, `${path}[${index}]`),
  );
}

function asEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  if ((value === undefined || value === null) && fallback !== undefined) {
    return fallback;
  }
  const text = asString(value, path);
  if (!allowed.includes(text as T)) {
    fail(path, `expected one of ${allowed.join(", ")} (got "${text}")`);
  }
  return text as T;
}

function parseDocument(value: unknown, path: string): SeedDocument {
  const raw = asRecord(value, path);
  const sections = asArray(raw.sections, `${path}.sections`).map(
    (section, index) => {
      const sectionPath = `${path}.sections[${index}]`;
      const rawSection = asRecord(section, sectionPath);
      const paragraphs = asArray(
        rawSection.paragraphs,
        `${sectionPath}.paragraphs`,
      ).map((paragraph, pIndex) =>
        asString(paragraph, `${sectionPath}.paragraphs[${pIndex}]`),
      );
      if (paragraphs.length === 0) {
        fail(`${sectionPath}.paragraphs`, "needs at least one paragraph");
      }
      return {
        heading: optionalString(rawSection.heading, `${sectionPath}.heading`),
        paragraphs,
      };
    },
  );

  if (sections.length === 0) {
    fail(`${path}.sections`, "a document needs at least one section");
  }

  return { title: asString(raw.title, `${path}.title`), sections };
}

/** The reviews already given on a change. Shared by both kinds of change. */
function parseReviews(value: unknown, path: string): SeedReview[] {
  return asArray(value, path).map((review, index) => {
    const reviewPath = `${path}[${index}]`;
    const rawReview = asRecord(review, reviewPath);
    return {
      by: asString(rawReview.by, `${reviewPath}.by`),
      state: asEnum(rawReview.state, `${reviewPath}.state`, [
        "approved",
        "changes_requested",
        "commented",
      ] as const),
      body: asString(rawReview.body, `${reviewPath}.body`),
    };
  });
}

/** The discussion on a change. Shared by both kinds of change. */
function parseThreads(value: unknown, path: string): SeedThread[] {
  return asArray(value, path).map((thread, index) => {
    const threadPath = `${path}[${index}]`;
    const rawThread = asRecord(thread, threadPath);
    return {
      id: asString(rawThread.id, `${threadPath}.id`),
      by: asString(rawThread.by, `${threadPath}.by`),
      body: asString(rawThread.body, `${threadPath}.body`),
      replies: asArray(rawThread.replies, `${threadPath}.replies`).map(
        (reply, rIndex) => {
          const replyPath = `${threadPath}.replies[${rIndex}]`;
          const rawReply = asRecord(reply, replyPath);
          return {
            by: asString(rawReply.by, `${replyPath}.by`),
            body: asString(rawReply.body, `${replyPath}.body`),
          };
        },
      ),
      resolved: asBoolean(rawThread.resolved, `${threadPath}.resolved`, false),
      resolvedBy: optionalString(
        rawThread.resolvedBy,
        `${threadPath}.resolvedBy`,
      ),
    };
  });
}

function parseChange(value: unknown, path: string): SeedChange {
  const raw = asRecord(value, path);

  const reviews = parseReviews(raw.reviews, `${path}.reviews`);
  const threads = parseThreads(raw.threads, `${path}.threads`);

  const branch = asString(raw.branch, `${path}.branch`);
  if (!branch.startsWith("upload/")) {
    fail(
      `${path}.branch`,
      `"${branch}" must start with "upload/" — the workspace only counts ` +
        "pull requests on upload branches, so any other name produces a " +
        "document that silently looks like a draft",
    );
  }

  const publish = asBoolean(raw.publish, `${path}.publish`, false);
  if (publish && !reviews.some((review) => review.state === "approved")) {
    fail(
      `${path}.publish`,
      "a published change needs an approving review — main requires one approval",
    );
  }
  const closed = parseClosed(raw, path, publish);

  return {
    branch,
    title: asString(raw.title, `${path}.title`),
    summary: asString(raw.summary, `${path}.summary`),
    author: optionalString(raw.author, `${path}.author`),
    document: parseDocument(raw.document, `${path}.document`),
    reviews,
    threads,
    publish,
    closed,
    ...parseAssignment(raw, path),
  };
}

/** Closed and published are two different endings, not two names for one. */
function parseClosed(
  raw: Record<string, unknown>,
  path: string,
  publish: boolean,
): boolean {
  const closed = asBoolean(raw.closed, `${path}.closed`, false);
  if (closed && publish) {
    fail(
      `${path}.closed`,
      "a change is published or closed, not both — publishing already closes it",
    );
  }
  return closed;
}

/** Who the change is waiting on: one assignee, any number of reviewers. */
function parseAssignment(
  raw: Record<string, unknown>,
  path: string,
): SeedAssignment {
  return {
    assignee: optionalString(raw.assignee, `${path}.assignee`),
    reviewers: asStringList(raw.reviewers, `${path}.reviewers`),
  };
}

function parseSignOffRule(value: unknown, path: string): SeedSignOffRule {
  const raw = asRecord(value, path);
  const scope = asEnum(raw.scope, `${path}.scope`, [
    "binder",
    "folder",
    "document",
    "rules",
  ] as const);
  const target = optionalString(raw.target, `${path}.target`);

  // The two scopes that name the only one there is take no target, and the two
  // that name something take one. A rule with the wrong pair would compile into
  // a pattern that matches nothing, which is the failure this module exists to
  // refuse rather than commit — Gitea drops a rule it cannot use and says so
  // only in a log.
  if ((scope === "folder" || scope === "document") && target === undefined) {
    fail(`${path}.target`, `a ${scope} rule has to say which ${scope}`);
  }
  if ((scope === "binder" || scope === "rules") && target !== undefined) {
    fail(
      `${path}.target`,
      `a ${scope} rule covers the only one there is, so it takes no target`,
    );
  }

  const teams = asStringList(raw.teams, `${path}.teams`);
  const users = asStringList(raw.users, `${path}.users`);
  if (teams.length === 0 && users.length === 0) {
    fail(path, "a rule with nobody to sign it off requires nothing");
  }

  return { scope, target, teams, users };
}

/**
 * One act, read from the single key it is written under.
 *
 * Exactly one key, so `- move: {…}` with a stray `revise:` beside it is an
 * error rather than a silent choice between them.
 */
function parseAct(value: unknown, path: string): SeedAct {
  const raw = asRecord(value, path);
  const keys = Object.keys(raw);

  if (keys.length !== 1) {
    fail(
      path,
      `an act is one key naming what it does (got ${
        keys.length === 0 ? "none" : keys.map((key) => `"${key}"`).join(", ")
      })`,
    );
  }

  const [key] = keys as [string];
  const body = raw[key];
  const at = `${path}.${key}`;

  switch (key) {
    case "newFolder":
      return { kind: "newFolder", folder: asString(body, at) };
    case "renameFolder": {
      const fields = asRecord(body, at);
      return {
        kind: "renameFolder",
        from: asString(fields.from, `${at}.from`),
        to: asString(fields.to, `${at}.to`),
      };
    }
    case "move": {
      const fields = asRecord(body, at);
      return {
        kind: "move",
        from: asString(fields.from, `${at}.from`),
        to: asString(fields.to, `${at}.to`),
      };
    }
    case "revise": {
      const fields = asRecord(body, at);
      return {
        kind: "revise",
        document: asString(fields.document, `${at}.document`),
        contents: parseDocument(fields, at),
      };
    }
    case "archive":
      return { kind: "archive", document: asString(body, at) };
    case "signOff":
      return {
        kind: "signOff",
        rules: asArray(body, at).map((rule, index) =>
          parseSignOffRule(rule, `${at}[${index}]`),
        ),
      };
    default:
      fail(
        at,
        "unknown act — expected one of newFolder, renameFolder, move, revise, archive, signOff",
      );
  }
}

function parseBinderChange(value: unknown, path: string): SeedBinderChange {
  const raw = asRecord(value, path);
  const acts = asArray(raw.acts, `${path}.acts`).map((act, index) =>
    parseAct(act, `${path}.acts[${index}]`),
  );

  if (acts.length === 0) {
    fail(
      `${path}.acts`,
      "a change has to do something — one that changes no file merges cleanly and publishes nothing",
    );
  }

  const publish = asBoolean(raw.publish, `${path}.publish`, false);
  const reviews = parseReviews(raw.reviews, `${path}.reviews`);
  if (publish && !reviews.some((review) => review.state === "approved")) {
    fail(
      `${path}.publish`,
      "a published change needs an approving review — main requires one approval",
    );
  }

  return {
    branch: asString(raw.branch, `${path}.branch`),
    title: asString(raw.title, `${path}.title`),
    summary: asString(raw.summary, `${path}.summary`),
    author: optionalString(raw.author, `${path}.author`),
    acts,
    reviews,
    threads: parseThreads(raw.threads, `${path}.threads`),
    publish,
    closed: parseClosed(raw, path, publish),
    ...parseAssignment(raw, path),
  };
}

function parseBinderDocument(value: unknown, path: string): SeedBinderDocument {
  const raw = asRecord(value, path);

  return {
    name: asString(raw.name, `${path}.name`),
    folder: optionalString(raw.folder, `${path}.folder`),
    description: asString(raw.description, `${path}.description`),
    format: asEnum(
      raw.format,
      `${path}.format`,
      SEED_DOCUMENT_FORMATS,
      "prosemirror",
    ),
    changes: asArray(raw.changes, `${path}.changes`).map((change, index) =>
      parseChange(change, `${path}.changes[${index}]`),
    ),
  };
}

function parseBinder(value: unknown, path: string): SeedBinder {
  const raw = asRecord(value, path);

  const members = asArray(raw.members, `${path}.members`).map(
    (member, index) => {
      const memberPath = `${path}.members[${index}]`;
      const rawMember = asRecord(member, memberPath);
      return {
        user: asString(rawMember.user, `${memberPath}.user`),
        role: asEnum(
          rawMember.role,
          `${memberPath}.role`,
          ["admins", "authors", "reviewers"] as const,
          "authors",
        ),
      };
    },
  );

  return {
    name: asString(raw.name, `${path}.name`),
    description: asString(raw.description, `${path}.description`),
    members,
    groups: asStringList(raw.groups, `${path}.groups`),
    openToOrganization: asBoolean(
      raw.openToOrganization,
      `${path}.openToOrganization`,
      false,
    ),
    requiredApprovals: asPositiveInt(
      raw.requiredApprovals,
      `${path}.requiredApprovals`,
      1,
    ),
    signOff: asArray(raw.signOff, `${path}.signOff`).map((rule, index) =>
      parseSignOffRule(rule, `${path}.signOff[${index}]`),
    ),
    documents: asArray(raw.documents, `${path}.documents`).map(
      (document, index) =>
        parseBinderDocument(document, `${path}.documents[${index}]`),
    ),
    changes: asArray(raw.changes, `${path}.changes`).map((change, index) =>
      parseBinderChange(change, `${path}.changes[${index}]`),
    ),
  };
}

function parseGroup(value: unknown, path: string): SeedGroup {
  const raw = asRecord(value, path);
  return {
    name: asString(raw.name, `${path}.name`),
    level: asEnum(raw.level, `${path}.level`, [
      "admin",
      "editor",
      "reviewer",
    ] as const),
    description: asString(raw.description, `${path}.description`),
    members: asStringList(raw.members, `${path}.members`),
  };
}

/** `nursing/hand-hygiene` — folder and name, which is a document's address. */
export function binderDocumentSlugPath(document: {
  folder?: string;
  name: string;
}): string {
  return document.folder
    ? `${document.folder}/${document.name}`
    : document.name;
}

// ---------------------------------------------------------------------------
// Cross-checks
//
// Everything below is about a mistake that seeds *successfully* and produces a
// stack that is quietly wrong: a branch naming the wrong document, a rule
// Gitea drops without a word, a publish that waits on an approval nobody gave.
// Each is cheaper to catch here than to find in a browser an hour later.
// ---------------------------------------------------------------------------

type RequireUser = (username: string, path: string) => void;

/** No two changes in one binder may share a branch: one repository, one ref. */
function requireBranch(branch: string, path: string, seen: Set<string>): void {
  if (seen.has(branch)) {
    fail(`${path}.branch`, `duplicate branch "${branch}"`);
  }
  seen.add(branch);
}

/** Everybody a change names has to be somebody the scenario declared. */
function checkChangePeople(
  change: SeedChange | SeedBinderChange,
  path: string,
  requireMember: RequireUser,
): void {
  if (change.author) requireMember(change.author, `${path}.author`);
  if (change.assignee) requireMember(change.assignee, `${path}.assignee`);
  change.reviewers.forEach((reviewer, index) =>
    requireMember(reviewer, `${path}.reviewers[${index}]`),
  );
  change.reviews.forEach((review, index) =>
    requireMember(review.by, `${path}.reviews[${index}].by`),
  );
  change.threads.forEach((thread, index) => {
    const threadPath = `${path}.threads[${index}]`;
    requireMember(thread.by, `${threadPath}.by`);
    if (thread.resolvedBy) {
      requireMember(thread.resolvedBy, `${threadPath}.resolvedBy`);
    }
    thread.replies.forEach((reply, rIndex) =>
      requireMember(reply.by, `${threadPath}.replies[${rIndex}].by`),
    );
  });
}

/**
 * Whether Gitea would count this person's approval in this binder.
 *
 * **Not everyone who can approve is someone whose approval counts.** With the
 * approvals whitelist off — which is how the seed leaves every binder — Gitea
 * resolves "official reviewer" as write or better on `repo.code`. A reviewer's
 * approval is recorded, shown, and satisfies nothing. So an approval from the
 * wrong person is not a rejected seed but a merge that waits forever.
 */
function approvalCounts(
  binder: SeedBinder,
  organization: SeedOrganization,
  username: string,
): boolean {
  // The Owners team holds owner access on every repository the org has, which
  // is above admin. ADR 0004 warns about exactly the count that misses them.
  if (username === organization.owner) return true;
  if (organization.owners.includes(username)) return true;

  if (
    binder.members.some(
      (member) =>
        member.user === username &&
        (member.role === "admins" || member.role === "authors"),
    )
  ) {
    return true;
  }

  return organization.groups.some(
    (group) =>
      binder.groups.includes(group.name) &&
      group.level !== "reviewer" &&
      group.members.includes(username),
  );
}

/**
 * A published change needs as many approvals as the binder asks for, from
 * people whose approval Gitea will count, and none of them its own author.
 *
 * Without this the seed writes the change, waits on a merge Gitea will never
 * allow, retries ten times over ten seconds and then fails with Gitea's
 * wording rather than with the line of YAML that is wrong. All three of these
 * produce that same silent wait, and each of them reads perfectly well.
 *
 * Gitea counts one approval per person, latest review wins, so this counts
 * distinct approvers rather than approving reviews.
 */
function checkApprovals(
  change: SeedChange | SeedBinderChange,
  path: string,
  binder: SeedBinder,
  organization: SeedOrganization,
  defaultAuthor: string,
): void {
  if (!change.publish) return;

  const author = change.author ?? defaultAuthor;
  const approvers = new Set(
    change.reviews
      .filter((review) => review.state === "approved")
      .map((review) => review.by),
  );

  if (approvers.has(author)) {
    fail(
      `${path}.reviews`,
      `"${author}" wrote this change, and Gitea refuses an approval of your own`,
    );
  }

  for (const approver of approvers) {
    if (approvalCounts(binder, organization, approver)) continue;
    fail(
      `${path}.reviews`,
      `"${approver}" may review here but not publish, so Gitea records the ` +
        "approval and counts nothing — give the change an approval from an " +
        "editor, an admin or an organization owner",
    );
  }

  const counted = [...approvers].filter((approver) =>
    approvalCounts(binder, organization, approver),
  );

  if (counted.length < binder.requiredApprovals) {
    fail(
      `${path}.publish`,
      `this binder requires ${binder.requiredApprovals} approvals and the ` +
        `change has ${counted.length} — it would never merge`,
    );
  }
}

function requireFolder(
  folders: Set<string>,
  folder: string,
  path: string,
): void {
  if (!folders.has(folder)) {
    fail(path, `this binder has no folder "${folder}"`);
  }
}

function requireDocument(
  addresses: Set<string>,
  address: string,
  path: string,
): void {
  if (!addresses.has(address)) {
    fail(path, `this binder has no document filed at "${address}"`);
  }
}

/**
 * Only a document that has reached `main` has a file to act on.
 *
 * A document is declared in the YAML long before anything publishes it, so
 * "the binder has one of those" and "there is a file there" are different
 * questions. Asking only the first produced a rename of a path that does not
 * exist — which Gitea refuses in the middle of the seed, several binders after
 * the line that is actually wrong.
 */
function requirePublished(
  onMain: Set<string>,
  address: string,
  path: string,
  act: string,
): void {
  if (!onMain.has(address)) {
    fail(
      path,
      `"${address}" has never been published, so there is no file to be ${act} — ` +
        "give it a published change first",
    );
  }
}

/**
 * A sign-off rule has to name something that is there and somebody who can act
 * on it.
 *
 * **A group that is not granted onto the binder is the trap.** Gitea will
 * write the review request and then hold the merge for an approval from people
 * who cannot open the change to give one — a binder that can never publish
 * again, produced by a line that looks right.
 */
function checkSignOffRule(
  rule: SeedSignOffRule,
  path: string,
  context: {
    binder: SeedBinder;
    groupNames: Set<string>;
    addresses: Set<string>;
    folders: Set<string>;
    requireMember: RequireUser;
  },
): void {
  const { binder, groupNames, addresses, folders, requireMember } = context;

  if (rule.scope === "folder") {
    requireFolder(folders, rule.target!, `${path}.target`);
  }
  if (rule.scope === "document") {
    requireDocument(addresses, rule.target!, `${path}.target`);
  }

  rule.teams.forEach((team, index) => {
    const at = `${path}.teams[${index}]`;
    if (!groupNames.has(team)) {
      fail(
        at,
        `unknown group "${team}" — add it under scenario.organization.groups`,
      );
    }
    if (!binder.groups.includes(team)) {
      fail(
        at,
        `"${team}" signs off here but is not granted on this binder — Gitea ` +
          "would hold every merge for an approval its members cannot give",
      );
    }
  });

  rule.users.forEach((user, index) => {
    const at = `${path}.users[${index}]`;
    requireMember(user, at);
    const onBinder =
      binder.members.some((member) => member.user === user) ||
      binder.openToOrganization;
    if (!onBinder) {
      fail(
        at,
        `"${user}" signs off here but is not a member of this binder — Gitea ` +
          "would hold every merge for an approval they cannot give",
      );
    }
  });
}

/**
 * Parse and validate a scenario, cross-checking that every name it mentions is
 * an account it also declares. A misspelt reviewer is the single easiest
 * mistake to make in this file, and the cheapest one to catch here.
 */
export function parseSeedScenario(source: string): SeedScenario {
  const raw = asRecord(parseYaml(source), "scenario");

  const password = asString(raw.password, "scenario.password");
  const users = asArray(raw.users, "scenario.users").map((user, index) => {
    const userPath = `scenario.users[${index}]`;
    const rawUser = asRecord(user, userPath);
    return {
      username: asString(rawUser.username, `${userPath}.username`),
      fullName: asString(rawUser.fullName, `${userPath}.fullName`),
      email: asString(rawUser.email, `${userPath}.email`),
      role: optionalString(rawUser.role, `${userPath}.role`),
      siteAdmin: asBoolean(rawUser.siteAdmin, `${userPath}.siteAdmin`, false),
      organizationMember: asBoolean(
        rawUser.organizationMember,
        `${userPath}.organizationMember`,
        true,
      ),
    };
  });

  if (users.length === 0) {
    fail("scenario.users", "a scenario needs at least one user");
  }

  const organizationRaw = asRecord(raw.organization, "scenario.organization");
  const organization: SeedOrganization = {
    name: asString(organizationRaw.name, "scenario.organization.name"),
    displayName: asString(
      organizationRaw.displayName,
      "scenario.organization.displayName",
    ),
    owner: asString(organizationRaw.owner, "scenario.organization.owner"),
    owners: asStringList(
      organizationRaw.owners,
      "scenario.organization.owners",
    ),
    groups: asArray(organizationRaw.groups, "scenario.organization.groups").map(
      (group, index) =>
        parseGroup(group, `scenario.organization.groups[${index}]`),
    ),
  };

  const binders = asArray(raw.binders, "scenario.binders").map(
    (binder, index) => parseBinder(binder, `scenario.binders[${index}]`),
  );

  const known = new Set(users.map((user) => user.username));
  const requireKnown = (username: string, path: string): void => {
    if (!known.has(username)) {
      fail(path, `unknown user "${username}" — add them under scenario.users`);
    }
  };

  // Somebody outside the organization cannot hold anything inside it: adding an
  // account to any of the org's teams makes it a member, so a scenario that
  // named an outsider on a binder would quietly contradict the very thing it
  // declared them for.
  const outsiders = new Set(
    users
      .filter((user) => !user.organizationMember)
      .map((user) => user.username),
  );
  const requireMember = (username: string, path: string): void => {
    requireKnown(username, path);
    if (outsiders.has(username)) {
      fail(
        path,
        `"${username}" is declared outside the organization, and joining any ` +
          "of its teams would put them back in it",
      );
    }
  };

  requireMember(organization.owner, "scenario.organization.owner");
  organization.owners.forEach((owner, index) => {
    requireMember(owner, `scenario.organization.owners[${index}]`);
    if (owner === organization.owner) {
      fail(
        `scenario.organization.owners[${index}]`,
        "the creating owner is already in the Owners team",
      );
    }
  });

  const groupNames = new Set<string>();
  organization.groups.forEach((group, index) => {
    const path = `scenario.organization.groups[${index}]`;
    if (groupNames.has(group.name)) {
      fail(`${path}.name`, `duplicate group "${group.name}"`);
    }
    groupNames.add(group.name);
    group.members.forEach((member, mIndex) =>
      requireMember(member, `${path}.members[${mIndex}]`),
    );
  });

  const seenBinders = new Set<string>();

  binders.forEach((binder, binderIndex) => {
    const binderPath = `scenario.binders[${binderIndex}]`;
    // A binder is one repository, so its branch names are shared by every
    // document in it — two documents proposing the same branch would be one
    // change wearing two names.
    const seenBranches = new Set<string>();

    if (seenBinders.has(binder.name)) {
      fail(`${binderPath}.name`, `duplicate binder "${binder.name}"`);
    }
    seenBinders.add(binder.name);

    binder.members.forEach((member, mIndex) => {
      requireMember(member.user, `${binderPath}.members[${mIndex}].user`);
    });

    binder.groups.forEach((group, gIndex) => {
      if (!groupNames.has(group)) {
        fail(
          `${binderPath}.groups[${gIndex}]`,
          `unknown group "${group}" — add it under scenario.organization.groups`,
        );
      }
    });

    /**
     * Where everything in this binder is, as the seed walks it.
     *
     * Mutable on purpose: an act moves a document or makes a folder, and the
     * act after it is written against the binder as it then stands. Validating
     * against the starting shape would reject the second half of every rename.
     */
    const addresses = new Set<string>();
    const folders = new Set<string>();
    /**
     * The documents that are actually on `main`.
     *
     * Narrower than `addresses`, and the difference is the one that produces a
     * broken seed rather than a refused one: a document is declared in the YAML
     * long before anything publishes it, and moving or archiving a file that is
     * not there is a rename of a path that does not exist.
     */
    const onMain = new Set<string>();

    const noteFolders = (slugPath: string): void => {
      const parts = slugPath.split("/");
      for (let depth = 1; depth < parts.length; depth += 1) {
        folders.add(parts.slice(0, depth).join("/"));
      }
    };

    binder.documents.forEach((document, index) => {
      const path = `${binderPath}.documents[${index}]`;
      const slugPath = binderDocumentSlugPath(document);

      // Two documents at one address are one document — the seed derives an
      // identity from the address, so a duplicate would be a single document
      // seeded twice rather than two. Caught here rather than discovered as a
      // silent overwrite halfway through seeding.
      if (addresses.has(slugPath)) {
        fail(`${path}.name`, `duplicate document path "${slugPath}"`);
      }
      addresses.add(slugPath);
      noteFolders(slugPath);
      if (document.changes.some((change) => change.publish)) {
        onMain.add(slugPath);
      }

      document.changes.forEach((change, cIndex) => {
        const changePath = `${path}.changes[${cIndex}]`;
        requireBranch(change.branch, changePath, seenBranches);

        // The branch name is how the app knows which document a change is
        // about — `upload/<slugPath>/…`, written by the upload path and read
        // back by the binder's list. A branch that omits the document's folder
        // still seeds and still looks right in Gitea, but the app reads it as
        // a change about a different document at the binder's root: the real
        // document loses its open-change count, and a policy that does not
        // exist appears beside it.
        if (!change.branch.startsWith(`upload/${slugPath}/`)) {
          fail(
            `${changePath}.branch`,
            `"${change.branch}" must start with "upload/${slugPath}/" — the ` +
              "app reads the document's identity out of the branch name, so a " +
              "branch naming anything else describes a different document",
          );
        }

        checkChangePeople(change, changePath, requireMember);
        checkApprovals(
          change,
          changePath,
          binder,
          organization,
          organization.owner,
        );
      });
    });

    binder.changes.forEach((change, index) => {
      const changePath = `${binderPath}.changes[${index}]`;
      requireBranch(change.branch, changePath, seenBranches);
      checkChangePeople(change, changePath, requireMember);
      checkApprovals(
        change,
        changePath,
        binder,
        organization,
        organization.owner,
      );

      const touched = new Set<string>();
      const changesRules = change.acts.some((act) => act.kind === "signOff");

      // A change that is not published has not happened, so it is checked
      // against the binder as it stands and leaves it as it stands. Letting an
      // open proposal move things here would make the change after it look
      // wrong — or, worse, make a genuinely wrong one look right.
      const before = {
        addresses: new Set(addresses),
        folders: new Set(folders),
        onMain: new Set(onMain),
      };

      change.acts.forEach((act, actIndex) => {
        const actPath = `${changePath}.acts[${actIndex}]`;

        switch (act.kind) {
          case "newFolder":
            if (folders.has(act.folder)) {
              fail(actPath, `the binder already has a folder "${act.folder}"`);
            }
            folders.add(act.folder);
            break;
          case "renameFolder":
            requireFolder(folders, act.from, `${actPath}.from`);
            for (const folder of [...folders]) {
              if (folder === act.from || folder.startsWith(`${act.from}/`)) {
                folders.delete(folder);
                folders.add(act.to + folder.slice(act.from.length));
              }
            }
            for (const address of [...addresses]) {
              if (!address.startsWith(`${act.from}/`)) continue;
              addresses.delete(address);
              const moved = act.to + address.slice(act.from.length);
              addresses.add(moved);
              // Only a document that is on `main` gets a version out of the
              // folder moving under it — there is no file to move otherwise.
              if (onMain.delete(address)) {
                onMain.add(moved);
                touched.add(moved);
              }
            }
            break;
          case "move":
            requireDocument(addresses, act.from, `${actPath}.from`);
            requirePublished(onMain, act.from, `${actPath}.from`, "moved");
            addresses.delete(act.from);
            addresses.add(act.to);
            onMain.delete(act.from);
            onMain.add(act.to);
            noteFolders(act.to);
            touched.add(act.to);
            break;
          case "revise":
            requireDocument(addresses, act.document, `${actPath}.document`);
            onMain.add(act.document);
            touched.add(act.document);
            break;
          case "archive":
            requireDocument(addresses, act.document, `${actPath}.document`);
            requirePublished(
              onMain,
              act.document,
              `${actPath}.document`,
              "taken off the record",
            );
            addresses.delete(act.document);
            onMain.delete(act.document);
            break;
          case "signOff":
            act.rules.forEach((rule, rIndex) =>
              checkSignOffRule(rule, `${actPath}.rules[${rIndex}]`, {
                binder,
                groupNames,
                addresses,
                folders,
                requireMember,
              }),
            );
            break;
        }
      });

      if (!change.publish) {
        addresses.clear();
        for (const address of before.addresses) addresses.add(address);
        folders.clear();
        for (const folder of before.folders) folders.add(folder);
        onMain.clear();
        for (const address of before.onMain) onMain.add(address);
      }

      // The same rule the document changes are held to, asked of what the
      // change turns out to touch rather than of where it was written down. A
      // change about one document belongs on that document's upload branch so
      // the binder can say it is in review; a change about several, or none,
      // has no document to be named after and says so with its prefix.
      const only = touched.size === 1 ? [...touched][0]! : null;
      const wanted = changesRules
        ? ['"sign-off/"']
        : only
          ? [`"upload/${only}/"`, '"shape/"']
          : ['"shape/"'];

      const ok = changesRules
        ? change.branch.startsWith("sign-off/")
        : change.branch.startsWith("shape/") ||
          (only !== null && change.branch.startsWith(`upload/${only}/`));

      if (!ok) {
        fail(
          `${changePath}.branch`,
          `"${change.branch}" must start with ${wanted.join(" or ")} — the ` +
            "app reads the prefix to work out which document a change is " +
            "about, and publishing a change that versions nothing is allowed " +
            "only under the prefixes that say so",
        );
      }
    });

    binder.signOff.forEach((rule, index) =>
      checkSignOffRule(rule, `${binderPath}.signOff[${index}]`, {
        binder,
        groupNames,
        // The rules on `main` are committed before anything else exists, so
        // they are checked against the binder's finished shape — which is what
        // a seed author has in front of them when they write one.
        addresses: new Set([
          ...addresses,
          ...binder.documents.map(binderDocumentSlugPath),
        ]),
        folders,
        requireMember,
      }),
    );
  });

  return { password, users, organization, binders };
}

export function loadSeedScenario(path: string | URL): SeedScenario {
  return parseSeedScenario(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Turn a declared document into the TipTap JSON the editor stores.
 *
 * Keeping this here means the YAML stays prose: a seed author writes headings
 * and paragraphs, not `{ "type": "paragraph", "content": [...] }`.
 */
export function renderSeedDocument(document: SeedDocument): string {
  const content: unknown[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: document.title }],
    },
  ];

  for (const section of document.sections) {
    if (section.heading) {
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: section.heading }],
      });
    }
    for (const paragraph of section.paragraphs) {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: paragraph }],
      });
    }
  }

  return `${JSON.stringify({ type: "doc", content }, null, 2)}\n`;
}
