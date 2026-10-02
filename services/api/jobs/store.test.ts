import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JOB_MAX_ATTEMPTS, JobStore, withGroupLock } from "./store";

function freshStore() {
  return new JobStore(join(mkdtempSync(join(tmpdir(), "jobs-")), "jobs.db"));
}

const base = {
  kind: "publish",
  groupKey: "mercy-health/clinical",
  subject: "change:12",
  plan: { pullNumber: 12 },
  createdBy: "alice",
};

test("a job is recorded pending, with its plan, before anything runs", () => {
  const store = freshStore();
  const job = store.create(base);
  expect(job.status).toBe("pending");
  expect(job.plan).toEqual({ pullNumber: 12 });
  expect(store.openFor(base.groupKey, base.subject)?.id).toBe(job.id);
});

test("the same idempotency key hands back the same job", () => {
  const store = freshStore();
  const first = store.create({ ...base, idempotencyKey: "click-1" });
  const again = store.create({ ...base, idempotencyKey: "click-1" });
  expect(again.id).toBe(first.id);
  // Two jobs without keys are two jobs.
  expect(store.create(base).id).not.toBe(store.create(base).id);
});

test("a claimed job cannot be claimed again until its lease lapses", () => {
  const store = freshStore();
  const job = store.create(base);
  const now = 1_000_000;
  expect(store.claim(job.id, now)?.status).toBe("running");
  expect(store.claim(job.id, now + 1)).toBeNull();
  // The process that held it died: its lease runs out and the job is runnable.
  const later = now + 10 * 60_000;
  expect(store.runnable(later).map((entry) => entry.id)).toEqual([job.id]);
  expect(store.claim(job.id, later)?.status).toBe("running");
});

test("a failing job backs off, then stops in failed for a person", () => {
  const store = freshStore();
  const job = store.create(base);
  let now = 0;
  for (let attempt = 1; attempt < JOB_MAX_ATTEMPTS; attempt += 1) {
    store.claim(job.id, now);
    const failed = store.fail(job.id, "gitea timed out", { now });
    expect(failed?.status).toBe("pending");
    // Not runnable until its backoff passes.
    expect(store.runnable(now)).toEqual([]);
    now = failed!.leaseUntil! + 1;
    expect(store.runnable(now).map((entry) => entry.id)).toEqual([job.id]);
  }
  store.claim(job.id, now);
  expect(store.fail(job.id, "gitea timed out", { now })?.status).toBe("failed");
  expect(store.runnable(now + 10 ** 9)).toEqual([]);
  // A person pressing the button again can still take it.
  expect(store.claim(job.id, now)?.status).toBe("running");
});

test("a conflict stops at once; done and deleted jobs are no longer open", () => {
  const store = freshStore();
  const conflict = store.create(base);
  store.claim(conflict.id);
  expect(
    store.fail(conflict.id, "tag on another commit", { permanent: true })
      ?.status,
  ).toBe("failed");

  const done = store.create({ ...base, subject: "change:13" });
  store.claim(done.id);
  store.complete(done.id, { tags: [] });
  expect(store.openFor(base.groupKey, "change:13")).toBeNull();
  expect(store.get(done.id)?.result).toEqual({ tags: [] });

  const abandoned = store.create({ ...base, subject: "change:14" });
  store.delete(abandoned.id);
  expect(store.get(abandoned.id)).toBeNull();
});

test("a group runs one thing at a time, in order; other groups do not wait", async () => {
  const order: string[] = [];
  const step = (name: string, ms: number) => async () => {
    order.push(`${name}:start`);
    await Bun.sleep(ms);
    order.push(`${name}:end`);
  };

  await Promise.all([
    withGroupLock("a/clinical", step("first", 10)),
    withGroupLock("a/clinical", step("second", 1)),
    withGroupLock("a/hr", step("other", 1)),
  ]);

  expect(order.indexOf("first:end")).toBeLessThan(
    order.indexOf("second:start"),
  );
  expect(order.indexOf("other:end")).toBeLessThan(order.indexOf("first:end"));
});

test("a group whose run threw still lets the next one in", async () => {
  await expect(
    withGroupLock("a/clinical", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  await expect(withGroupLock("a/clinical", async () => "next")).resolves.toBe(
    "next",
  );
});
