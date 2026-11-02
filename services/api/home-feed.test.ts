import { expect, test } from "bun:test";

import { changesNeedingTitles, toFeedEvents } from "./home-feed";
import type { components } from "./gitea-client/spec/gitea";

type Activity = components["schemas"]["Activity"];

const ORGS = new Set(["riverside-health"]);

let nextId = 1;
function activity(
  op_type: string,
  content: string,
  extra: Partial<Activity> & {
    login?: string;
    repo?: string;
    owner?: string;
  } = {},
): Activity {
  const {
    login = "carol",
    repo = "clinical",
    owner = "riverside-health",
  } = extra;
  return {
    id: nextId++,
    op_type,
    content,
    act_user_id: login.length,
    act_user: { login, full_name: login === "carol" ? "Carol Mendes" : "" },
    repo_id: repo.length,
    repo: { name: repo, owner: { login: owner } },
    created: "2026-10-30T21:50:00Z",
    ...extra,
  } as Activity;
}

test("a change opened, published and closed carries its title", () => {
  const events = toFeedEvents(
    [
      activity("create_pull_request", "19|Rename the grievance policy"),
      activity("merge_pull_request", "20|Retire the 2019 supplier terms"),
      activity("close_pull_request", "21|An idea we dropped"),
    ],
    ORGS,
  );
  expect(
    events.map((event) => [event.kind, event.changeNumber, event.title]),
  ).toEqual([
    ["opened", 19, "Rename the grievance policy"],
    ["published", 20, "Retire the 2019 supplier terms"],
    ["closed", 21, "An idea we dropped"],
  ]);
  expect(events[0]?.actorName).toBe("Carol Mendes");
  expect(events[0]?.excerpt).toBeNull();
});

test("an approval is one event, not the review and its comment", () => {
  const events = toFeedEvents(
    [
      activity("approve_pull_request", "20|Checked the register. Approved."),
      activity("comment_pull", "20|Checked the register. Approved."),
    ],
    ORGS,
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "approved",
    excerpt: "Checked the register. Approved.",
  });
});

test("what Home has no word for is left out", () => {
  const events = toFeedEvents(
    [
      activity("commit_repo", '{"Commits":[]}'),
      activity("push_tag", ""),
      activity("delete_branch", ""),
      activity("watch_repo", ""),
    ],
    ORGS,
  );
  expect(events).toEqual([]);
});

test("a repository outside your organizations is not a binder", () => {
  const events = toFeedEvents(
    [activity("create_pull_request", "1|Test", { owner: "alice" })],
    ORGS,
  );
  expect(events).toEqual([]);
});

test("a discussion says what happened to it, without its markers", () => {
  const marker = (kind: string, extra = "") =>
    `<!-- bindersnap:v1 kind=${kind} thread=b29dfb69-fe65-4ec2-9711-0123456789ab${extra} -->`;
  const events = toFeedEvents(
    [
      activity("comment_pull", `19|Three working days?\n\n${marker("thread")}`),
      activity("comment_pull", `19|Fixed.\n\n${marker("reply")}`),
      activity("comment_pull", `19|${marker("resolve", " state=resolved")}`),
      activity("comment_pull", "19|A plain comment"),
    ],
    ORGS,
    new Map([["riverside-health/clinical#19", "Rename the grievance policy"]]),
  );
  expect(events.map((event) => [event.kind, event.excerpt])).toEqual([
    ["started_discussion", "Three working days?"],
    ["replied", "Fixed."],
    ["resolved", null],
    ["commented", "A plain comment"],
  ]);
  // The title comes from the read the handler made.
  expect(events[0]?.title).toBe("Rename the grievance policy");
});

test("a long comment is cut to a line or two", () => {
  const [event] = toFeedEvents(
    [activity("comment_pull", `19|${"word ".repeat(100)}`)],
    ORGS,
  );
  expect(event?.excerpt?.length).toBeLessThanOrEqual(240);
  expect(event?.excerpt?.endsWith("…")).toBe(true);
});

test("a binder being made is an event with no change", () => {
  const [event] = toFeedEvents([activity("create_repo", "")], ORGS);
  expect(event).toMatchObject({
    kind: "binder_created",
    binder: "clinical",
    changeNumber: null,
  });
});

test("only the changes whose actions do not name them are read", () => {
  const needed = changesNeedingTitles(
    [
      activity("create_pull_request", "19|Has its title"),
      activity("approve_pull_request", "20|Fine"),
      activity("comment_pull", "20|Again"),
      activity("comment_pull", "21|Hm", { owner: "alice" }),
    ],
    ORGS,
  );
  expect(needed).toEqual([
    { org: "riverside-health", binder: "clinical", number: 20 },
  ]);
});

test("the same act written twice in a row is said once", () => {
  const events = toFeedEvents(
    [
      activity("comment_pull", "19|No objection from the audit side."),
      activity("comment_pull", "19|No objection from the audit side."),
      activity("comment_pull", "19|A different thought."),
    ],
    ORGS,
  );
  expect(events.map((event) => event.excerpt)).toEqual([
    "No objection from the audit side.",
    "A different thought.",
  ]);
});
