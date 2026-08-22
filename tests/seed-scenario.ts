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

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

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

/** A proposed new version of a document — a branch plus its pull request. */
export interface SeedChange {
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
}

export interface SeedCollaborator {
  user: string;
  permission: "read" | "write" | "admin";
}

export interface SeedDocumentRepo {
  owner: string;
  repo: string;
  description: string;
  collaborators: SeedCollaborator[];
  /** Applied to `main` in order. Published ones become doc/vNNNN tags. */
  changes: SeedChange[];
}

export interface SeedScenario {
  /** The password every seeded account is created with. */
  password: string;
  users: SeedUser[];
  documents: SeedDocumentRepo[];
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

function parseChange(value: unknown, path: string): SeedChange {
  const raw = asRecord(value, path);

  const reviews = asArray(raw.reviews, `${path}.reviews`).map(
    (review, index) => {
      const reviewPath = `${path}.reviews[${index}]`;
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
    },
  );

  const threads = asArray(raw.threads, `${path}.threads`).map(
    (thread, index) => {
      const threadPath = `${path}.threads[${index}]`;
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
        resolved: asBoolean(
          rawThread.resolved,
          `${threadPath}.resolved`,
          false,
        ),
        resolvedBy: optionalString(
          rawThread.resolvedBy,
          `${threadPath}.resolvedBy`,
        ),
      };
    },
  );

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

  return {
    branch,
    title: asString(raw.title, `${path}.title`),
    summary: asString(raw.summary, `${path}.summary`),
    author: optionalString(raw.author, `${path}.author`),
    document: parseDocument(raw.document, `${path}.document`),
    reviews,
    threads,
    publish,
  };
}

function parseDocumentRepo(value: unknown, path: string): SeedDocumentRepo {
  const raw = asRecord(value, path);

  const collaborators = asArray(raw.collaborators, `${path}.collaborators`).map(
    (collaborator, index) => {
      const collaboratorPath = `${path}.collaborators[${index}]`;
      const rawCollaborator = asRecord(collaborator, collaboratorPath);
      return {
        user: asString(rawCollaborator.user, `${collaboratorPath}.user`),
        permission: asEnum(
          rawCollaborator.permission,
          `${collaboratorPath}.permission`,
          ["read", "write", "admin"] as const,
          "write",
        ),
      };
    },
  );

  return {
    owner: asString(raw.owner, `${path}.owner`),
    repo: asString(raw.repo, `${path}.repo`),
    description: asString(raw.description, `${path}.description`),
    collaborators,
    changes: asArray(raw.changes, `${path}.changes`).map((change, index) =>
      parseChange(change, `${path}.changes[${index}]`),
    ),
  };
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
    };
  });

  if (users.length === 0) {
    fail("scenario.users", "a scenario needs at least one user");
  }

  const documents = asArray(raw.documents, "scenario.documents").map(
    (document, index) =>
      parseDocumentRepo(document, `scenario.documents[${index}]`),
  );

  const known = new Set(users.map((user) => user.username));
  const requireKnown = (username: string, path: string): void => {
    if (!known.has(username)) {
      fail(path, `unknown user "${username}" — add them under scenario.users`);
    }
  };

  const seenRepos = new Set<string>();
  documents.forEach((document, index) => {
    const path = `scenario.documents[${index}]`;
    requireKnown(document.owner, `${path}.owner`);

    const fullName = `${document.owner}/${document.repo}`;
    if (seenRepos.has(fullName)) {
      fail(`${path}.repo`, `duplicate document "${fullName}"`);
    }
    seenRepos.add(fullName);

    document.collaborators.forEach((collaborator, cIndex) => {
      requireKnown(collaborator.user, `${path}.collaborators[${cIndex}].user`);
      if (collaborator.user === document.owner) {
        fail(
          `${path}.collaborators[${cIndex}].user`,
          "the owner is already a collaborator",
        );
      }
    });

    const seenBranches = new Set<string>();
    document.changes.forEach((change, cIndex) => {
      const changePath = `${path}.changes[${cIndex}]`;
      if (seenBranches.has(change.branch)) {
        fail(`${changePath}.branch`, `duplicate branch "${change.branch}"`);
      }
      seenBranches.add(change.branch);

      if (change.author) requireKnown(change.author, `${changePath}.author`);
      change.reviews.forEach((review, rIndex) =>
        requireKnown(review.by, `${changePath}.reviews[${rIndex}].by`),
      );
      change.threads.forEach((thread, tIndex) => {
        const threadPath = `${changePath}.threads[${tIndex}]`;
        requireKnown(thread.by, `${threadPath}.by`);
        if (thread.resolvedBy) {
          requireKnown(thread.resolvedBy, `${threadPath}.resolvedBy`);
        }
        thread.replies.forEach((reply, rIndex) =>
          requireKnown(reply.by, `${threadPath}.replies[${rIndex}].by`),
        );
      });
    });
  });

  return { password, users, documents };
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
