import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildApprovalsCsv,
  buildAuditPacket,
  serializeRecord,
} from "./auditPacket";
import {
  gitBlobHash,
  pathFromStamp,
  sha256,
  standingApprovals,
  type AuditRecord,
  type AuditVersion,
} from "./auditRecord";
import { SAMPLE_DOCUMENT } from "./fixtures";
import { crc32 } from "./zip";

const person = (login: string) => ({
  login,
  name: login[0]!.toUpperCase() + login.slice(1),
});
const file = new TextEncoder().encode(JSON.stringify(SAMPLE_DOCUMENT));

function version(overrides: Partial<AuditVersion> = {}): AuditVersion {
  return {
    version: 1,
    tag: "doc/01ABC/v1",
    tagObject: "a".repeat(40),
    tagMessage:
      "Infection Control v1 — nursing/infection-control.01ABC.json\n\n  Approved by: bob\n",
    commit: "c".repeat(40),
    publishedAt: "2026-03-14T10:00:00Z",
    path: "nursing/infection-control.01ABC.json",
    blob: gitBlobHash(file),
    sha256: sha256(file),
    size: file.byteLength,
    change: {
      number: 7,
      title: "Tighten hand hygiene",
      description: "Why: the audit found gaps.",
      author: person("alice"),
      openedAt: "2026-03-10T09:00:00Z",
      publishedBy: person("alice"),
      publishedAt: "2026-03-14T10:00:00Z",
    },
    reviews: [
      {
        reviewer: person("carol"),
        decision: "approved",
        at: "2026-03-11T09:00:00Z",
        commit: "b".repeat(40),
        stale: true,
        dismissed: false,
        comment: "",
      },
      {
        reviewer: person("bob"),
        decision: "changes_requested",
        at: "2026-03-12T09:00:00Z",
        commit: "b".repeat(40),
        stale: false,
        dismissed: false,
        comment: "Say, twenty seconds.",
      },
      {
        reviewer: person("bob"),
        decision: "approved",
        at: "2026-03-13T09:00:00Z",
        commit: "c".repeat(40),
        stale: false,
        dismissed: false,
        comment: "",
      },
    ],
    threads: [
      {
        id: "t1",
        resolved: true,
        comments: [
          {
            author: person("bob"),
            at: "2026-03-12T09:00:00Z",
            body: "Twenty seconds, or thirty?",
          },
        ],
        events: [
          {
            actor: person("alice"),
            resolved: true,
            at: "2026-03-12T10:00:00Z",
          },
          { actor: person("bob"), resolved: false, at: "2026-03-12T11:00:00Z" },
          { actor: person("bob"), resolved: true, at: "2026-03-12T12:00:00Z" },
        ],
      },
    ],
    ...overrides,
  };
}

const record: AuditRecord = {
  organization: "riverside-health",
  binder: "clinical",
  document: {
    title: "Infection Control",
    slugPath: "nursing/infection-control",
    uid: "01ABC",
  },
  exportedAt: "2026-09-29T12:00:00.000Z",
  exportedBy: "alice",
  versions: [version()],
};

describe("gitBlobHash", () => {
  test("is the hash git itself gives the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "blob-"));
    const path = join(dir, "policy.json");
    writeFileSync(path, file);
    const git = execFileSync("git", ["hash-object", path]).toString().trim();
    expect(gitBlobHash(file)).toBe(git);
  });
});

describe("standingApprovals", () => {
  test("counts an approval of the published commit, not a superseded one", () => {
    expect(
      standingApprovals(version()).map((review) => review.reviewer.login),
    ).toEqual(["bob"]);
  });
});

describe("pathFromStamp", () => {
  test("reads the file a version is from the stamp's first line", () => {
    expect(pathFromStamp(version().tagMessage)).toBe(
      "nursing/infection-control.01ABC.json",
    );
    expect(pathFromStamp("hand-written tag")).toBeNull();
  });
});

describe("buildApprovalsCsv", () => {
  test("has one row per event, reviews marked when they no longer counted", () => {
    const rows = buildApprovalsCsv(record).trim().split("\r\n");
    expect(rows[0]).toStartWith("version,tag,change,actor,action,timestamp");
    expect(rows.map((row) => row.split(",")[4])).toEqual([
      "action",
      "submitted",
      "approved (superseded)",
      "changes_requested",
      "approved",
      "published",
    ]);
  });
});

describe("buildAuditPacket", () => {
  test("is a zip every tool opens, holding the PDF, the record and each version's file", async () => {
    const zip = await buildAuditPacket({ record, files: new Map([[1, file]]) });
    const dir = mkdtempSync(join(tmpdir(), "packet-"));
    const path = join(dir, "packet.zip");
    writeFileSync(path, zip);
    const listing = execFileSync("unzip", ["-Z1", path])
      .toString()
      .trim()
      .split("\n");
    expect(listing).toEqual([
      "README.txt",
      "audit-packet.pdf",
      "approvals.csv",
      "record.json",
      "versions/v1/infection-control.01ABC.json",
      "versions/v1/infection-control-v1.pdf",
    ]);
    execFileSync("unzip", ["-q", path, "-d", dir]);
    expect(readFileSync(join(dir, "record.json"), "utf8")).toBe(
      serializeRecord(record),
    );
    expect(
      readFileSync(join(dir, "audit-packet.pdf")).subarray(0, 5).toString(),
    ).toBe("%PDF-");
    // The README names the record's digest, which ties the PDF to the JSON.
    expect(readFileSync(join(dir, "README.txt"), "utf8")).toContain(
      sha256(serializeRecord(record)),
    );
  });

  test("a file altered after the fact no longer matches its fingerprint", () => {
    const tampered = new Uint8Array(file);
    tampered[10] = tampered[10]! ^ 1;
    expect(gitBlobHash(tampered)).not.toBe(record.versions[0]!.blob);
    expect(sha256(tampered)).not.toBe(record.versions[0]!.sha256);
  });
});

describe("crc32", () => {
  test("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
