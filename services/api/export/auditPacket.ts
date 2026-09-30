import {
  sha256,
  standingApprovals,
  type AuditRecord,
  type AuditRecordWithFiles,
  type AuditVersion,
} from "./auditRecord";
import { exportDocument } from "./exportDocument";
import { PdfWriter } from "./pdfLayout";
import { buildZip } from "./zip";

/**
 * The file a policy manager hands a surveyor.
 *
 * "Show me the approved version of this policy, who approved it, and when" —
 * answered without anybody logging in to anything. One zip:
 *
 * - `audit-packet.pdf` — the answer, for a person: the approval summary, every
 *   version, every review and discussion, and what the fingerprints prove.
 * - `approvals.csv` — the same events, one per row, for a spreadsheet.
 * - `record.json` — the raw record, for somebody who wants to check it.
 * - `versions/` — every version's exact file, so each fingerprint can be
 *   recomputed; and for a policy written in Bindersnap, a PDF of each to read.
 * - `README.txt` — what the files are, and how to check them.
 *
 * The PDF prints a digest of `record.json`, which ties the readable account to
 * the machine-checkable one: change a line of either and they stop agreeing.
 */

const DECISIONS: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Asked for changes",
  commented: "Commented",
};

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

const short = (hash: string) => (hash ? hash.slice(0, 12) : "—");

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per event: submitted, each review, published. */
export function buildApprovalsCsv(record: AuditRecord): string {
  const rows: (string | number)[][] = [
    [
      "version",
      "tag",
      "change",
      "actor",
      "action",
      "timestamp",
      "commit",
      "file_blob",
      "file_sha256",
    ],
  ];
  for (const version of record.versions) {
    const base = (
      actor: string,
      action: string,
      at: string,
      commit = version.commit,
    ) => [
      version.version,
      version.tag,
      version.change ? version.change.number : "",
      actor,
      action,
      at,
      commit,
      version.blob,
      version.sha256,
    ];
    if (version.change) {
      rows.push(
        base(
          version.change.author.login,
          "submitted",
          version.change.openedAt,
          "",
        ),
      );
    }
    for (const review of version.reviews) {
      const action =
        review.decision +
        (review.dismissed
          ? " (dismissed)"
          : review.stale
            ? " (superseded)"
            : "");
      rows.push(base(review.reviewer.login, action, review.at, review.commit));
    }
    rows.push(
      base(
        version.change?.publishedBy?.login ?? "",
        "published",
        version.change?.publishedAt ?? version.publishedAt,
      ),
    );
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The record as the packet stores it: stable key order, two-space indent. */
export function serializeRecord(record: AuditRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export const VERIFY_PARAGRAPH =
  "Every version of this document is identified by a fingerprint of its exact file, computed the way git computes it. " +
  "The files themselves are in the versions folder, so anybody can recompute each fingerprint and compare it with the one printed here; " +
  "changing a single character of a file changes its fingerprint. Each published version is also a signed-off entry in the binder's history: " +
  "its commit fingerprint depends on the file and on every version before it, so an earlier version cannot be altered without every later " +
  "fingerprint changing too. The same fingerprints can be checked against the organization's own copy of the binder at any time.";

export function buildReadme(record: AuditRecord, digest: string): string {
  const current = record.versions[record.versions.length - 1];
  return [
    `Audit packet: ${record.document.title}`,
    "",
    `Organization: ${record.organization}`,
    `Binder: ${record.binder}`,
    `Current version: ${current ? `${current.version} (${current.tag})` : "none published"}`,
    `Exported: ${record.exportedAt} by ${record.exportedBy}`,
    "",
    "What is here",
    "  audit-packet.pdf   Who approved each version, when, and what was discussed.",
    "  approvals.csv      The same events, one per row.",
    "  record.json        The raw record the PDF was written from.",
    "  versions/          Every version's exact file, and a readable PDF of each",
    "                     version written in Bindersnap.",
    "",
    "How to check it",
    `  1. The SHA-256 of record.json is ${digest}. It is printed on the PDF's cover.`,
    "  2. For each version, the file in versions/ has the SHA-256 and the git blob",
    "     hash listed in record.json. Recompute them:",
    "       shasum -a 256 versions/v1/<file>",
    "       git hash-object versions/v1/<file>",
    "  3. In a clone of the binder, each version's tag and commit can be read back:",
    "       git show <tag>          (the approval policy stamped at publication)",
    "       git ls-tree <commit> <path>   (the blob hash of the file at that version)",
    "",
    VERIFY_PARAGRAPH,
    "",
  ].join("\n");
}

function heading(writer: PdfWriter, text: string, size = 15): void {
  writer.say(text, {
    size,
    bold: true,
    family: "sans",
    spaceBefore: 14,
    spaceAfter: 6,
    keepWithNext: 40,
  });
}

function line(writer: PdfWriter, label: string, value: string): void {
  writer.text([{ text: `${label}  `, bold: true }, { text: value }], {
    size: 10.5,
    family: "sans",
    spaceAfter: 2,
  });
}

function versionSection(writer: PdfWriter, version: AuditVersion): void {
  heading(
    writer,
    `Version ${version.version}${version.change ? ` — ${version.change.title}` : ""}`,
    13,
  );
  line(
    writer,
    "Published",
    `${when(version.change?.publishedAt ?? version.publishedAt)}${
      version.change?.publishedBy
        ? ` by ${version.change.publishedBy.name}`
        : ""
    }`,
  );
  if (version.change) {
    line(
      writer,
      "Change",
      `#${version.change.number}, opened ${when(version.change.openedAt)} by ${version.change.author.name}`,
    );
    const description = version.change.description.trim();
    if (
      description &&
      !description.includes("Automated upload from Bindersnap")
    ) {
      writer.say(description, { size: 10.5, spaceBefore: 4, spaceAfter: 6 });
    }
  } else {
    writer.say(
      "This version has no change request on record — it was published outside Bindersnap.",
      {
        size: 10.5,
        italic: true,
        spaceAfter: 6,
      },
    );
  }

  if (version.reviews.length > 0) {
    writer.say("Reviews", {
      size: 11,
      bold: true,
      family: "sans",
      spaceBefore: 6,
      spaceAfter: 4,
    });
    writer.table(
      [
        [
          { runs: [{ text: "Reviewer" }], header: true },
          { runs: [{ text: "Decision" }], header: true },
          { runs: [{ text: "When" }], header: true },
          { runs: [{ text: "Commit reviewed" }], header: true },
        ],
        ...version.reviews.map((review) => [
          { runs: [{ text: review.reviewer.name }] },
          {
            runs: [
              {
                text: `${DECISIONS[review.decision] ?? review.decision}${
                  review.dismissed
                    ? " (dismissed)"
                    : review.stale
                      ? " (superseded by a later edit)"
                      : ""
                }`,
              },
            ],
          },
          { runs: [{ text: when(review.at) }] },
          { runs: [{ text: short(review.commit), code: true }] },
        ]),
      ],
      { size: 9.5, family: "sans", widths: [0.28, 0.3, 0.24, 0.18] },
    );
    for (const review of version.reviews.filter((entry) =>
      entry.comment.trim(),
    )) {
      writer.text(
        [
          { text: `${review.reviewer.name}: `, bold: true },
          { text: review.comment.trim() },
        ],
        { size: 10, indent: 12, spaceAfter: 3 },
      );
    }
  }

  if (version.threads.length > 0) {
    writer.say("Discussion", {
      size: 11,
      bold: true,
      family: "sans",
      spaceBefore: 6,
      spaceAfter: 4,
    });
    for (const thread of version.threads) {
      const entries = [
        ...thread.comments.map((comment) => ({
          at: comment.at,
          runs: [
            {
              text: `${comment.author.name}, ${when(comment.at)}: `,
              bold: true,
            },
            { text: comment.body.trim() },
          ],
        })),
        ...thread.events.map((event) => ({
          at: event.at,
          runs: [
            {
              text: `${event.resolved ? "Resolved" : "Reopened"} by ${event.actor.name}, ${when(event.at)}`,
              italic: true,
            },
          ],
        })),
      ].sort((left, right) => left.at.localeCompare(right.at));
      entries.forEach((entry, index) =>
        writer.text(entry.runs, {
          size: 10,
          indent: index === 0 ? 0 : 14,
          spaceAfter: 2,
        }),
      );
      writer.space(6);
    }
  }
}

export async function buildAuditPdf(
  record: AuditRecord,
  digest: string,
): Promise<Uint8Array> {
  const writer = await PdfWriter.create({
    title: `Audit packet — ${record.document.title}`,
    subject: `${record.organization}/${record.binder}`,
  });
  const versions = record.versions;
  const current = versions[versions.length - 1] ?? null;

  // Cover.
  writer.say("Audit packet", {
    size: 11,
    family: "sans",
    color: [0.47, 0.44, 0.42],
    spaceAfter: 4,
  });
  writer.say(record.document.title, {
    size: 24,
    bold: true,
    spaceAfter: 12,
    lineHeight: 1.15,
  });
  line(writer, "Organization", record.organization);
  line(writer, "Binder", record.binder);
  line(writer, "Filed at", record.document.slugPath);
  line(
    writer,
    "Version in force",
    current
      ? `Version ${current.version}, published ${when(current.change?.publishedAt ?? current.publishedAt)} (${current.tag})`
      : "No version has been published",
  );
  line(
    writer,
    "Exported",
    `${when(record.exportedAt)} by ${record.exportedBy}`,
  );
  line(writer, "Record digest", `SHA-256 ${digest}`);
  writer.say("How to check this packet", {
    size: 11,
    bold: true,
    family: "sans",
    spaceBefore: 14,
    spaceAfter: 4,
  });
  writer.say(VERIFY_PARAGRAPH, { size: 10.5, spaceAfter: 6, align: "justify" });

  // Approval summary.
  writer.newPage();
  heading(writer, "Who approved the version in force");
  if (!current) {
    writer.say("Nothing has been published.", { size: 11 });
  } else {
    const standing = standingApprovals(current);
    writer.say(
      standing.length === 0
        ? `Version ${current.version} was published without an approval on record — the binder asked for none.`
        : `Version ${current.version} was approved by ${standing
            .map((review) => review.reviewer.name)
            .join(", ")}, each approving the exact commit that was published.`,
      { size: 11, spaceAfter: 8 },
    );
    const stamp = current.tagMessage
      .split("\n")
      .map((text) => text.trim())
      .filter((text) =>
        /^(Approvals required|Approved by|Published by|Unresolved discussions|Per-folder sign-off)/.test(
          text,
        ),
      );
    if (stamp.length > 0) {
      writer.say("Stamped on the version when it was published:", {
        size: 10.5,
        italic: true,
        spaceAfter: 3,
      });
      for (const text of stamp)
        writer.say(text, { size: 10.5, indent: 12, spaceAfter: 1 });
      writer.space(6);
    }
  }

  // Version history.
  heading(writer, "Every version");
  writer.table(
    [
      [
        { runs: [{ text: "Version" }], header: true },
        { runs: [{ text: "Published" }], header: true },
        { runs: [{ text: "Written by" }], header: true },
        { runs: [{ text: "Approved by" }], header: true },
        { runs: [{ text: "What changed" }], header: true },
      ],
      ...[...versions].reverse().map((version) => [
        { runs: [{ text: String(version.version) }] },
        {
          runs: [
            { text: when(version.change?.publishedAt ?? version.publishedAt) },
          ],
        },
        { runs: [{ text: version.change?.author.name ?? "—" }] },
        {
          runs: [
            {
              text:
                standingApprovals(version)
                  .map((review) => review.reviewer.name)
                  .join(", ") || "—",
            },
          ],
        },
        { runs: [{ text: version.change?.title ?? "—" }] },
      ]),
    ],
    { size: 9.5, family: "sans", widths: [0.1, 0.22, 0.18, 0.2, 0.3] },
  );

  // The full record, newest first.
  writer.newPage();
  heading(writer, "The review record", 17);
  for (const version of [...versions].reverse())
    versionSection(writer, version);

  // Integrity.
  writer.newPage();
  heading(writer, "Fingerprints", 17);
  writer.say(VERIFY_PARAGRAPH, {
    size: 10.5,
    spaceAfter: 10,
    align: "justify",
  });
  writer.table(
    [
      [
        { runs: [{ text: "Version" }], header: true },
        { runs: [{ text: "File (git blob)" }], header: true },
        { runs: [{ text: "Commit" }], header: true },
        { runs: [{ text: "Tag object" }], header: true },
      ],
      ...versions.map((version) => [
        { runs: [{ text: String(version.version) }] },
        { runs: [{ text: version.blob, code: true }] },
        { runs: [{ text: version.commit, code: true }] },
        { runs: [{ text: version.tagObject || "—", code: true }] },
      ]),
    ],
    { size: 7, family: "sans", widths: [0.1, 0.3, 0.3, 0.3] },
  );

  writer.furnish(
    `Audit packet  ·  ${record.document.title}  ·  ${record.organization}/${record.binder}`,
  );
  return writer.save();
}

function leafOf(path: string): string {
  return path.split("/").pop() || "document";
}

export async function buildAuditPacket(
  input: AuditRecordWithFiles,
): Promise<Uint8Array> {
  const { record, files } = input;
  const recordJson = serializeRecord(record);
  const digest = sha256(recordJson);

  const entries: { name: string; data: Uint8Array | string }[] = [
    { name: "README.txt", data: buildReadme(record, digest) },
    { name: "audit-packet.pdf", data: await buildAuditPdf(record, digest) },
    { name: "approvals.csv", data: buildApprovalsCsv(record) },
    { name: "record.json", data: recordJson },
  ];

  for (const version of record.versions) {
    const bytes = files.get(version.version) ?? new Uint8Array();
    const folder = `versions/v${version.version}`;
    entries.push({ name: `${folder}/${leafOf(version.path)}`, data: bytes });
    if (version.path.toLowerCase().endsWith(".json")) {
      const readable = await exportDocument({
        path: version.path,
        bytes,
        format: "pdf",
        // The version as its author wrote it: nothing printed on it that
        // the document did not say. Which version it is, is in its name.
        title: `${record.document.title} — version ${version.version}`,
      });
      if (readable.kind === "converted") {
        const stem = record.document.slugPath.split("/").pop() || "document";
        entries.push({
          name: `${folder}/${stem}-v${version.version}.pdf`,
          data: readable.bytes,
        });
      }
    }
  }

  return buildZip(entries, new Date(record.exportedAt));
}
