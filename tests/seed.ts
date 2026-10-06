/**
 * Applies the declarative seed scenario to a running stack — through the API.
 *
 * There is no seed data in this file. What gets created lives in
 * `tests/seed-data/dev.yaml`; this module replays it as the people in it,
 * signed in, calling the same API routes the app calls: an organization is
 * created by its owner, a document is uploaded into a draft and proposed, a
 * review is given by the reviewer, a change is published by somebody allowed
 * to publish it.
 *
 * **Why through the API.** The seed used to write to Gitea directly, which
 * meant a second copy of how Bindersnap models everything — team roles,
 * version tags and their stamps, discussion markers, CODEOWNERS — kept in step
 * with the real one by hand. When the two drifted, the stack showed states the
 * product could never produce, and nothing the API keeps for itself (an
 * organization's record, a publish job) existed at all. Replaying through the
 * API means a seeded stack is one the product made.
 *
 * **Idempotent by title.** A change is found again by its title in its binder,
 * a document by where it is filed, a discussion by its opening words. Re-running
 * against a warm stack reads and writes nothing new.
 *
 * Accounts are the one thing made beside the API rather than through it — see
 * `seed-accounts.ts` — and {@link THE_PRODUCT_CANNOT} lists the rest.
 */

import { pathToFileURL } from "node:url";

import * as Orgs from "../packages/api-client/organizations/organizations";
import * as Binders from "../packages/api-client/workspaces/workspaces";
import type { ListBinderChanges200ChangesItem } from "../packages/api-client/model/listBinderChanges200ChangesItem";
import type { ListBinderDocuments200DocumentsItem } from "../packages/api-client/model/listBinderDocuments200DocumentsItem";
import type { ProposeBinderSignOffRulesBodyRulesItem } from "../packages/api-client/model/proposeBinderSignOffRulesBodyRulesItem";
import { ReviewBinderChangeBodyEvent } from "../packages/api-client/model/reviewBinderChangeBodyEvent";
import { ApiRequestError } from "../packages/api-client/mutator";
import { Sessions } from "./bff-session";
import {
  giteaRequest,
  repoPath,
  seedAccounts,
  sleep,
  type BasicAuth,
} from "./seed-accounts";
import { renderSeedDocumentFile } from "./seed-documents";
import {
  binderDocumentSlugPath,
  canonicalFileNameFor,
  loadSeedScenario,
  type SeedAct,
  type SeedAssignment,
  type SeedBinder,
  type SeedBinderChange,
  type SeedBinderDocument,
  type SeedBinderRole,
  type SeedChange,
  type SeedDocument,
  type SeedDocumentFormat,
  type SeedReview,
  type SeedScenario,
  type SeedSignOffRule,
  type SeedThread,
} from "./seed-scenario";

const SCENARIO_URL = new URL("seed-data/dev.yaml", import.meta.url);

/**
 * What the scenario asks for that no screen in the product can do, and so is
 * the one thing still written to Gitea directly.
 *
 * Kept as a list on purpose: every line here is a state a developer can look
 * at that no customer could reach the same way, and the list should only get
 * shorter.
 */
export const THE_PRODUCT_CANNOT = [
  "close a change without publishing it — the app has no 'close' button, so a declined or withdrawn change is closed in Gitea as its author",
] as const;

/** The title of the change that puts a binder's starting sign-off rules in force. */
export const STARTING_SIGN_OFF_TITLE = "Who signs off on this binder";

type SeedOptions = {
  /** Gitea, for the accounts and for {@link THE_PRODUCT_CANNOT}. */
  baseUrl?: string;
  adminUser?: string;
  /**
   * Password for every seeded account, not just the admin. The accounts share
   * one password by design — see `password` in the scenario file.
   */
  adminPass?: string;
  createToken?: boolean;
  tokenNamePrefix?: string;
  /** Override the scenario file. Defaults to `tests/seed-data/dev.yaml`. */
  scenario?: SeedScenario;
  log?: (message: string) => void;
};

type SeedResult = {
  token?: string;
  tokenName?: string;
  /** Change numbers keyed by `org/binder#<branch as the scenario names it>`. */
  pullRequests: Record<string, number>;
  oauthClientId?: string;
};

type Change = ListBinderChanges200ChangesItem;
type BinderDocument = ListBinderDocuments200DocumentsItem;

/** Everything a step in one binder needs. */
interface BinderRun {
  org: string;
  binder: SeedBinder;
  sessions: Sessions;
  /** The organization's owner: reads everything, and publishes by default. */
  owner: string;
  roles: Map<string, SeedBinderRole>;
  /** The binder's changes as they stood when the run started, by title. */
  changes: Map<string, Change>;
  gitea: { baseUrl: string; password: string };
  log: (message: string) => void;
}

const LEVEL_FOR_ROLE = {
  admins: "admin",
  authors: "editor",
  reviewers: "reviewer",
} as const satisfies Record<SeedBinderRole, string>;

const REVIEW_EVENT = {
  approved: ReviewBinderChangeBodyEvent.APPROVE,
  changes_requested: ReviewBinderChangeBodyEvent.REQUEST_CHANGES,
  commented: ReviewBinderChangeBodyEvent.COMMENT,
} as const satisfies Record<SeedReview["state"], string>;

const MIME_FOR_FORMAT = {
  prosemirror: "application/json",
  markdown: "text/markdown",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const satisfies Record<SeedDocumentFormat, string>;

function isStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof ApiRequestError && statuses.includes(error.status);
}

// ---------------------------------------------------------------------------
// The organization
// ---------------------------------------------------------------------------

/**
 * Created by its owner from the app's own "new organization" route, so it has
 * everything one made by a customer has — its record, its trial, its staff
 * team — and not only the Gitea half.
 */
async function ensureOrganization(
  scenario: SeedScenario,
  sessions: Sessions,
  log: (message: string) => void,
): Promise<string> {
  const { name, displayName, owner } = scenario.organization;
  const as = await sessions.options(owner);

  const existing = (await Orgs.listOrganizations(as)).data.organizations.find(
    (organization) => organization.name === name,
  );
  if (existing) {
    log(`Organization already exists: ${name}`);
    return name;
  }

  const created = (await Orgs.createOrganization({ name: displayName }, as))
    .data.organization.name;
  if (created !== name) {
    throw new Error(
      `The scenario names its organization "${name}", but creating "${displayName}" made "${created}". Make the two agree.`,
    );
  }
  log(`Created organization: ${name}`);
  return name;
}

/**
 * Everyone in the organization, its other owners, and its groups.
 *
 * Reconciled rather than only added to: moving a person out of a group in the
 * YAML has to take them out on the next run, or a warm stack only ever gains.
 */
async function ensurePeopleAndGroups(
  org: string,
  scenario: SeedScenario,
  sessions: Sessions,
  log: (message: string) => void,
): Promise<void> {
  const as = await sessions.options(scenario.organization.owner);
  let people = (await Orgs.getOrganizationPeople(org, as)).data;

  for (const user of scenario.users) {
    if (!user.organizationMember) continue;
    const wantsOwner =
      user.username === scenario.organization.owner ||
      scenario.organization.owners.includes(user.username);
    const current = people.people.find(
      (person) => person.login === user.username,
    );

    if (!current) {
      people = (
        await Orgs.addOrganizationPerson(
          org,
          { username: user.username, owner: wantsOwner },
          as,
        )
      ).data;
      log(
        `Added ${user.username} to ${org}${wantsOwner ? " as an owner" : ""}`,
      );
    } else if (current.isOwner !== wantsOwner) {
      people = (
        await Orgs.setOrganizationPersonRole(
          org,
          user.username,
          { owner: wantsOwner },
          as,
        )
      ).data;
      log(`Made ${user.username} ${wantsOwner ? "an owner" : "a member"}`);
    }
  }

  for (const group of scenario.organization.groups) {
    const current = people.groups.find(
      (candidate) => candidate.name === group.name,
    );
    if (!current) {
      await Orgs.createOrganizationGroup(
        org,
        { name: group.name, level: group.level },
        as,
      );
      log(`Created group: ${group.name} (${group.level})`);
    }

    const have = new Set(current?.members.map((member) => member.login));
    for (const member of group.members) {
      if (have.has(member)) continue;
      await Orgs.addOrganizationGroupMember(
        org,
        group.name,
        { username: member },
        as,
      );
    }
    for (const member of have) {
      if (group.members.includes(member)) continue;
      await Orgs.removeOrganizationGroupMember(org, group.name, member, as);
      log(`Removed ${member} from ${group.name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// A binder, and who is in it
// ---------------------------------------------------------------------------

async function ensureBinderShell(run: BinderRun): Promise<void> {
  const { org, binder, log } = run;
  const as = await run.sessions.options(run.owner);

  const binders = (await Binders.listOrganizationBinders(org, as)).data;
  if (!binders.workspaces.some((candidate) => candidate.name === binder.name)) {
    await Binders.createBinder(
      org,
      {
        name: binder.name,
        description: binder.description,
        openToOrganization: binder.openToOrganization,
      },
      as,
    );
    log(`Created binder: ${org}/${binder.name}`);
  }

  let people = (await Binders.getBinderPeople(org, binder.name, as)).data;

  for (const member of binder.members) {
    const level = LEVEL_FOR_ROLE[member.role];
    const current = people.people.find(
      (person) => person.login === member.user && person.individual,
    );
    if (!current) {
      people = (
        await Binders.addBinderPerson(
          org,
          binder.name,
          { username: member.user, level },
          as,
        )
      ).data;
    } else if (!current.through.endsWith(`-${member.role}`)) {
      people = (
        await Binders.setBinderPersonLevel(
          org,
          binder.name,
          member.user,
          { username: member.user, level },
          as,
        )
      ).data;
      log(`Moved ${member.user} to ${member.role}`);
    }
  }
  for (const person of people.people) {
    if (!person.individual) continue;
    if (binder.members.some((member) => member.user === person.login)) continue;
    await Binders.removeBinderPerson(org, binder.name, person.login, as);
    log(`Removed ${person.login} from ${binder.name}`);
  }

  const granted = new Set(people.groups.map((group) => group.name));
  for (const group of binder.groups) {
    if (granted.has(group)) continue;
    await Binders.grantBinderGroup(org, binder.name, { group }, as);
    log(`Granted group ${group} on ${binder.name}`);
  }

  if (people.openToOrganization !== binder.openToOrganization) {
    await Binders.setBinderVisibility(
      org,
      binder.name,
      { openToOrganization: binder.openToOrganization },
      as,
    );
    log(
      binder.openToOrganization
        ? `Opened ${binder.name} to the whole organization`
        : `Closed ${binder.name} to all but its members`,
    );
  }

  const settings = (await Binders.getBinderSettings(org, binder.name, as)).data;
  if ((settings.rules.requiredApprovals ?? 1) !== binder.requiredApprovals) {
    await Binders.setBinderRules(
      org,
      binder.name,
      { requiredApprovals: binder.requiredApprovals },
      as,
    );
    log(`${binder.name} now needs ${binder.requiredApprovals} approvals`);
  }
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

async function listChanges(
  org: string,
  binder: string,
  as: RequestInit,
): Promise<Map<string, Change>> {
  const byTitle = new Map<string, Change>();
  for (const state of ["open", "closed"] as const) {
    const { changes } = (
      await Binders.listBinderChanges(org, binder, { state }, as)
    ).data;
    for (const change of changes) byTitle.set(change.title, change);
  }
  return byTitle;
}

async function documentsIn(
  run: BinderRun,
  as: RequestInit,
  draft?: string,
): Promise<BinderDocument[]> {
  return (
    await Binders.listBinderDocuments(
      run.org,
      run.binder.name,
      draft ? { draft } : undefined,
      as,
    )
  ).data.documents;
}

/** A document's file, as somebody would pick it from their disk. */
async function seedFile(
  contents: SeedDocument,
  format: SeedDocumentFormat,
  name: string,
): Promise<File> {
  // The renderer names its own path for the old direct-to-Gitea commit; only
  // the bytes are wanted here. The API mints the identity.
  const rendered = await renderSeedDocumentFile(contents, format, name, "seed");
  const extension = canonicalFileNameFor(format).replace(/^document/, "");
  return new File(
    [Buffer.from(rendered.content, "base64")],
    `${name}${extension}`,
    { type: MIME_FOR_FORMAT[format] },
  );
}

/**
 * Open a draft, do what `fill` does in it, and propose it in the author's words.
 *
 * A draft left over from a run that stopped halfway is discarded first rather
 * than resumed: what is in it is whatever got done before the stop, and doing
 * the whole change again from a fresh draft is simpler than working out which.
 */
async function proposeChange(
  run: BinderRun,
  author: string,
  title: string,
  summary: string,
  fill: (draft: string, as: RequestInit) => Promise<void>,
): Promise<number> {
  const { org, binder } = run;
  const as = await run.sessions.options(author);

  const { drafts } = (await Binders.getBinderDraft(org, binder.name, {}, as))
    .data;
  for (const stale of drafts.filter(
    (draft) => draft.name === title && draft.changeNumber === null,
  )) {
    await Binders.discardBinderDraft(
      org,
      binder.name,
      { draft: stale.branch },
      as,
    );
  }

  const opened = (
    await Binders.openBinderDraft(org, binder.name, { name: title }, as)
  ).data;
  const branch = opened.draft?.branch;
  if (!branch) {
    throw new Error(`Opening a draft for "${title}" returned no branch.`);
  }

  await fill(branch, as);

  const proposed = (
    await Binders.proposeBinderDraft(
      org,
      binder.name,
      { title, description: summary, draft: branch },
      as,
    )
  ).data;
  run.log(`Proposed #${proposed.changeNumber}: ${title}`);
  return proposed.changeNumber;
}

/** A document's own change: its first version, or its next one. */
async function proposeDocumentChange(
  run: BinderRun,
  document: SeedBinderDocument,
  change: SeedChange,
): Promise<number> {
  const slugPath = binderDocumentSlugPath(document);
  const author = change.author ?? run.owner;

  return proposeChange(
    run,
    author,
    change.title,
    change.summary,
    async (draft, as) => {
      const file = await seedFile(
        change.document,
        document.format,
        document.name,
      );
      const filed = (await documentsIn(run, as)).find(
        (candidate) => candidate.slugPath === slugPath,
      );

      if (filed) {
        await Binders.reviseBinderDocument(
          run.org,
          run.binder.name,
          { file, documentPath: filed.path, draft },
          as,
        );
      } else {
        await Binders.createBinderDocument(
          run.org,
          run.binder.name,
          {
            file,
            name: document.name,
            ...(document.folder ? { folder: document.folder } : {}),
            draft,
          },
          as,
        );
      }
    },
  );
}

/** Where a document is filed in the draft, by the address the YAML uses. */
async function pathOf(
  run: BinderRun,
  as: RequestInit,
  draft: string,
  address: string,
): Promise<string> {
  const found = (await documentsIn(run, as, draft)).find(
    (candidate) => candidate.slugPath === address,
  );
  if (!found) {
    throw new Error(
      `${run.binder.name}: no document is filed at ${address} in this draft.`,
    );
  }
  return found.path;
}

async function applyAct(
  run: BinderRun,
  act: SeedAct,
  draft: string,
  as: RequestInit,
): Promise<void> {
  const { org } = run;
  const binder = run.binder.name;

  switch (act.kind) {
    case "newFolder":
      await Binders.createBinderFolder(
        org,
        binder,
        { folder: act.folder, draft },
        as,
      );
      return;
    case "renameFolder":
      await Binders.renameBinderFolder(
        org,
        binder,
        { from: act.from, to: act.to, draft },
        as,
      );
      return;
    case "move": {
      const slash = act.to.lastIndexOf("/");
      await Binders.renameBinderDocument(
        org,
        binder,
        {
          documentPath: await pathOf(run, as, draft, act.from),
          name: act.to.slice(slash + 1),
          folder: slash === -1 ? "" : act.to.slice(0, slash),
          draft,
        },
        as,
      );
      return;
    }
    case "revise": {
      const documentPath = await pathOf(run, as, draft, act.document);
      await Binders.reviseBinderDocument(
        org,
        binder,
        {
          file: await seedFile(
            act.contents,
            formatOf(documentPath),
            act.document.split("/").pop()!,
          ),
          documentPath,
          draft,
        },
        as,
      );
      return;
    }
    case "archive":
      await Binders.archiveBinderDocument(
        org,
        binder,
        { documentPath: await pathOf(run, as, draft, act.document), draft },
        as,
      );
      return;
    case "signOff":
      throw new Error(
        `${binder}: a sign-off change is proposed on its own — the product has no way to put one in a draft with other acts.`,
      );
  }
}

/** Revised in the format it is already stored as. */
function formatOf(path: string): SeedDocumentFormat {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".docx")) return "docx";
  return "prosemirror";
}

/** A rule as the app takes it: a document named by identity, not by address. */
async function resolveRules(
  run: BinderRun,
  rules: readonly SeedSignOffRule[],
): Promise<ProposeBinderSignOffRulesBodyRulesItem[]> {
  const documents = await documentsIn(
    run,
    await run.sessions.options(run.owner),
  );
  return rules.map((rule) => {
    let target = "";
    if (rule.scope === "folder") target = rule.target!;
    if (rule.scope === "document") {
      const uid = documents.find(
        (document) => document.slugPath === rule.target,
      )?.uid;
      if (!uid) {
        throw new Error(
          `${run.binder.name}: a sign-off rule names ${rule.target}, which is not published.`,
        );
      }
      target = uid;
    }
    return { scope: rule.scope, target, teams: rule.teams, users: rule.users };
  });
}

/**
 * A sign-off change. The app proposes these from the settings screen with a
 * title of its own; the scenario's words are put on it afterwards, the way an
 * author edits a change's title.
 */
async function proposeSignOffChange(
  run: BinderRun,
  author: string,
  title: string,
  summary: string,
  rules: readonly SeedSignOffRule[],
): Promise<number> {
  const as = await run.sessions.options(author);
  const proposed = (
    await Binders.proposeBinderSignOffRules(
      run.org,
      run.binder.name,
      { rules: await resolveRules(run, rules) },
      as,
    )
  ).data;
  await Binders.editBinderChange(
    run.org,
    run.binder.name,
    String(proposed.changeNumber),
    { title, body: summary },
    as,
  );
  run.log(`Proposed #${proposed.changeNumber}: ${title}`);
  return proposed.changeNumber;
}

/**
 * An open change as the binder's change list shows it — the one read that
 * carries every review with its words, alongside who is asked and assigned.
 */
async function readOpenChange(run: BinderRun, number: number): Promise<Change> {
  const { changes } = (
    await Binders.listBinderChanges(
      run.org,
      run.binder.name,
      { state: "open" },
      await run.sessions.options(run.owner),
    )
  ).data;
  const found = changes.find((change) => change.number === number);
  if (!found) {
    throw new Error(`${run.binder.name}: #${number} is not open.`);
  }
  return found;
}

/**
 * Each review the scenario lists, given by the person it names.
 *
 * Read back and given again until it holds, because Gitea dismisses approvals
 * asynchronously when it catches up with the push that made the branch — and
 * a seeded approval that silently arrives dismissed puts the document in the
 * wrong state.
 */
async function ensureReviews(
  run: BinderRun,
  number: number,
  wanted: readonly SeedReview[],
): Promise<void> {
  if (wanted.length === 0) return;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { reviews } = await readOpenChange(run, number);
    const missing = wanted.filter(
      (review) =>
        !reviews.some(
          (existing) =>
            existing.author.login === review.by &&
            sameWords(existing.body, review.body) &&
            existing.state === review.state &&
            !existing.dismissed &&
            !existing.stale,
        ),
    );
    if (missing.length === 0) return;

    for (const review of missing) {
      await Binders.reviewBinderChange(
        run.org,
        run.binder.name,
        String(number),
        { event: REVIEW_EVENT[review.state], body: review.body },
        await run.sessions.options(review.by),
      );
      run.log(`${review.by} ${review.state.replace("_", " ")} #${number}`);
    }
    await sleep(1500);
  }

  throw new Error(
    `${run.binder.name}: reviews on #${number} kept being dismissed after 5 attempts.`,
  );
}

/**
 * Who the change is waiting on. Somebody who has already reviewed is not asked
 * again, and the author cannot be asked at all.
 */
async function ensureAssignments(
  run: BinderRun,
  number: number,
  assignment: SeedAssignment,
  author: string,
): Promise<void> {
  const change = await readOpenChange(run, number);
  const spoken = new Set(change.reviews.map((review) => review.author.login));
  const requested = new Set(
    change.reviewers
      .filter((reviewer) => reviewer.requested)
      .map((reviewer) => reviewer.login),
  );
  const reviewers = assignment.reviewers.filter(
    (name) => name !== author && !spoken.has(name),
  );

  const assigneeMatches =
    (assignment.assignee ?? null) === (change.assignee?.login ?? null);
  const reviewersMatch = reviewers.every((name) => requested.has(name));
  if (assigneeMatches && reviewersMatch) return;

  await Binders.updateBinderChangeAssignments(
    run.org,
    run.binder.name,
    String(number),
    {
      ...(assignment.assignee !== undefined
        ? { assignee: assignment.assignee }
        : {}),
      reviewers: [...new Set([...requested, ...reviewers])],
    },
    await run.sessions.options(author),
  );
  run.log(`Asked ${reviewers.join(", ") || "nobody new"} on #${number}`);
}

/** Whitespace aside — the API trims what it stores, and YAML folds lines. */
function sameWords(a: string, b: string): boolean {
  const words = (text: string) => text.trim().replace(/\s+/g, " ");
  return words(a) === words(b);
}

/** A discussion, found again by its opening words. */
async function ensureThread(
  run: BinderRun,
  number: number,
  thread: SeedThread,
): Promise<void> {
  const { org } = run;
  const binder = run.binder.name;
  const changeNumber = String(number);
  const read = async () =>
    (
      await Binders.listBinderChangeDiscussions(
        org,
        binder,
        changeNumber,
        await run.sessions.options(run.owner),
      )
    ).data.threads.find(
      (candidate) =>
        sameWords(candidate.comments[0]?.body ?? "", thread.body) &&
        candidate.comments[0]?.author.login === thread.by,
    );

  let found = await read();
  if (!found) {
    await Binders.createBinderChangeDiscussion(
      org,
      binder,
      changeNumber,
      { body: thread.body },
      await run.sessions.options(thread.by),
    );
    found = await read();
    if (!found) {
      throw new Error(`${binder}: a discussion on #${number} did not stick.`);
    }
    run.log(`${thread.by} opened a discussion on #${number}`);
  }

  for (const reply of thread.replies.slice(found.comments.length - 1)) {
    await Binders.replyToBinderChangeDiscussion(
      org,
      binder,
      changeNumber,
      found.id,
      { body: reply.body },
      await run.sessions.options(reply.by),
    );
  }

  if (thread.resolved && !found.resolved) {
    await Binders.resolveBinderChangeDiscussion(
      org,
      binder,
      changeNumber,
      found.id,
      { resolved: true },
      await run.sessions.options(thread.resolvedBy ?? thread.by),
    );
    run.log(`Resolved a discussion on #${number}`);
  }
}

/** See {@link THE_PRODUCT_CANNOT}. */
async function closeInGitea(
  run: BinderRun,
  number: number,
  author: string,
): Promise<void> {
  const auth: BasicAuth = { username: author, password: run.gitea.password };
  await giteaRequest(
    run.gitea.baseUrl,
    `${repoPath(run.org, run.binder.name)}/issues/${number}`,
    {
      method: "PATCH",
      auth,
      body: JSON.stringify({ state: "closed" }),
      expectedStatuses: [200, 201],
    },
  );
  run.log(`Closed #${number} without publishing it`);
}

/**
 * Whoever publishes. The author, when they are allowed to; a reviewer is not,
 * so the organization's owner presses the button for them.
 */
function publisherFor(run: BinderRun, author: string): string {
  const role = run.roles.get(author);
  return role === "admins" || role === "authors" ? author : run.owner;
}

/**
 * Publish, and wait it out if the API says it will finish later — a publish is
 * a job now, and a 202 means a step is being retried.
 */
async function publish(
  run: BinderRun,
  number: number,
  author: string,
  reviews: readonly SeedReview[],
): Promise<void> {
  const as = await run.sessions.options(publisherFor(run, author));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await Binders.publishBinderChange(
      run.org,
      run.binder.name,
      String(number),
      as,
    ).catch((error: unknown) => {
      // Gitea works out whether a branch can merge in the background, and
      // says no until it has.
      if (isStatus(error, 405, 409, 422) && attempt < 9) return null;
      throw error;
    });
    // Gitea can dismiss an approval after it was read back as holding, when
    // it catches up with the push late. Give the reviews again and retry.
    if (!response) await ensureReviews(run, number, reviews);
    if (response && response.status === 200) {
      run.log(`Published #${number}`);
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${run.binder.name}: #${number} would not publish.`);
}

type AnyChange = SeedChange | SeedBinderChange;

/**
 * Everything after the change exists: reviews, who is asked, discussions, and
 * how it ends.
 */
async function settleChange(
  run: BinderRun,
  number: number,
  change: AnyChange,
  author: string,
): Promise<void> {
  await ensureReviews(run, number, change.reviews);
  await ensureAssignments(run, number, change, author);
  for (const thread of change.threads) {
    await ensureThread(run, number, thread);
  }
  if (change.closed) await closeInGitea(run, number, author);
  if (change.publish) await publish(run, number, author, change.reviews);
}

/** A change that has already ended is left exactly as it is. */
async function applyChange(
  run: BinderRun,
  change: AnyChange,
  propose: (author: string) => Promise<number>,
): Promise<number> {
  const author = change.author ?? run.owner;
  const existing = run.changes.get(change.title);

  if (existing && existing.outcome !== "open") {
    return existing.number;
  }

  const number = existing?.number ?? (await propose(author));
  await settleChange(run, number, change, author);
  return number;
}

/**
 * The binder's starting sign-off rules, put in force the way a binder admin
 * would: proposed from settings, approved, published.
 *
 * After the documents rather than before them, because a rule naming a
 * document names it by an identity the API mints when the document is first
 * uploaded. Approved by as many members as the binder asks for, in the order
 * the scenario lists them.
 */
async function ensureStartingSignOff(run: BinderRun): Promise<number | null> {
  const { binder } = run;
  if (binder.signOff.length === 0) return null;

  const author =
    binder.members.find((member) => member.role === "admins")?.user ??
    run.owner;
  const approvers = binder.members
    .map((member) => member.user)
    .filter((user) => user !== author)
    .slice(0, binder.requiredApprovals);
  const summary = "The sign-off rules this binder starts with.";

  return applyChange(
    run,
    {
      branch: "",
      title: STARTING_SIGN_OFF_TITLE,
      summary,
      author,
      acts: [],
      reviews: approvers.map((by) => ({
        by,
        state: "approved",
        body: "Approved.",
      })),
      threads: [],
      reviewers: [],
      publish: true,
      closed: false,
    },
    (proposer) =>
      proposeSignOffChange(
        run,
        proposer,
        STARTING_SIGN_OFF_TITLE,
        summary,
        binder.signOff,
      ),
  );
}

async function applyBinder(
  org: string,
  binder: SeedBinder,
  scenario: SeedScenario,
  sessions: Sessions,
  gitea: { baseUrl: string; password: string },
  log: (message: string) => void,
): Promise<Record<string, number>> {
  const owner = scenario.organization.owner;
  const run: BinderRun = {
    org,
    binder,
    sessions,
    owner,
    roles: new Map(binder.members.map((member) => [member.user, member.role])),
    changes: new Map(),
    gitea,
    log,
  };

  await ensureBinderShell(run);
  run.changes = await listChanges(
    org,
    binder.name,
    await sessions.options(owner),
  );

  const pullRequests: Record<string, number> = {};
  const key = (change: AnyChange) => `${org}/${binder.name}#${change.branch}`;

  for (const document of binder.documents) {
    for (const change of document.changes) {
      pullRequests[key(change)] = await applyChange(run, change, () =>
        proposeDocumentChange(run, document, change),
      );
    }
  }

  await ensureStartingSignOff(run);

  for (const change of binder.changes) {
    const signOff = change.acts.find(
      (act): act is Extract<SeedAct, { kind: "signOff" }> =>
        act.kind === "signOff",
    );
    pullRequests[key(change)] = await applyChange(run, change, (author) =>
      signOff
        ? proposeSignOffChange(
            run,
            author,
            change.title,
            change.summary,
            signOff.rules,
          )
        : proposeChange(
            run,
            author,
            change.title,
            change.summary,
            async (draft, as) => {
              for (const act of change.acts) {
                await applyAct(run, act, draft, as);
              }
            },
          ),
    );
  }

  return pullRequests;
}

export { isTokenValid } from "./seed-accounts";

export async function seedDevStack(
  options: SeedOptions = {},
): Promise<SeedResult> {
  const log = options.log ?? ((message: string) => console.log(message));
  const accounts = await seedAccounts({
    ...options,
    createToken: options.createToken ?? true,
    log,
  });
  const { scenario, password } = accounts;
  const sessions = new Sessions(password);

  try {
    const org = await ensureOrganization(scenario, sessions, log);
    await ensurePeopleAndGroups(org, scenario, sessions, log);

    // **Binders at once, not one after another.** Each is its own repository
    // with its own changes, so nothing one writes is read by another — and
    // applied in turn they were most of the stack's boot time.
    const applied = await Promise.all(
      scenario.binders.map((binder) =>
        applyBinder(
          org,
          binder,
          scenario,
          sessions,
          { baseUrl: accounts.baseUrl, password },
          (message) => log(`[${binder.name}] ${message}`),
        ),
      ),
    );

    return {
      pullRequests: Object.assign({}, ...applied),
      oauthClientId: accounts.oauthClientId,
      token: accounts.token,
      tokenName: accounts.tokenName,
    };
  } finally {
    await sessions.closeAll();
  }
}

async function runCli(): Promise<void> {
  const scenario = loadSeedScenario(SCENARIO_URL);
  const result = await seedDevStack({ scenario });
  const password = process.env.GITEA_ADMIN_PASS ?? scenario.password;

  console.log("");
  console.log("==================================================");
  console.log(
    `Sign in at http://localhost:${process.env.APP_PORT ?? "5173"} as any of:`,
  );
  for (const user of scenario.users) {
    const role = user.role ? ` — ${user.role}` : "";
    console.log(`  ${user.username} / ${password}${role}`);
  }
  console.log("");
  const documentCount = scenario.binders.reduce(
    (total, binder) => total + binder.documents.length,
    0,
  );
  console.log(
    `Seeded ${documentCount} documents across ${scenario.binders.length} binders in ${scenario.organization.name}.`,
  );
  if (result.oauthClientId) {
    console.log(`OAUTH_CLIENT_ID=${result.oauthClientId}`);
    console.log("Add to .env:");
    console.log(`  BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID=${result.oauthClientId}`);
  }
  if (result.token) {
    console.log(`TOKEN_NAME=${result.tokenName}`);
    console.log(`ALICE_TOKEN_SUFFIX=...${result.token.slice(-8)}`);
    console.log(
      "Token created. Set VITE_GITEA_TOKEN manually in your shell if needed.",
    );
  }
  console.log("==================================================");
  console.log("Seed complete.");
}

const invokedDirectly = (() => {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return pathToFileURL(entryPath).href === import.meta.url;
})();

if (invokedDirectly) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof ApiRequestError) console.error(error.data);
    process.exit(1);
  });
}
