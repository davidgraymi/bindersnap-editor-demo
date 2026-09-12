import { expect, test } from "bun:test";

import { renderSeedDocumentFile, renderSeedMarkdown } from "./seed-documents";
import {
  canonicalFileNameFor,
  seedDocumentUid,
  type SeedDocument,
} from "./seed-scenario";

/** What the seed derives for this document, which is what it commits under. */
const UID = seedDocumentUid("riverside-health", "clinical", "nursing/handover");

/**
 * The bytes the seed commits.
 *
 * These are fixtures a developer looks at in a browser, so what matters is
 * that each format is genuinely that format — a `.docx` a Word reader opens,
 * a PDF with a text layer the comparison screen can read back — and that
 * re-seeding an unchanged policy commits nothing.
 */

const policy: SeedDocument = {
  title: "Infection Control Policy",
  sections: [
    {
      heading: "Purpose",
      paragraphs: ["This policy sets out how the clinic prevents infection."],
    },
    {
      heading: "Hand Hygiene",
      paragraphs: [
        "Alcohol-based hand rub is the default.",
        "The infection preventionist audits compliance monthly.",
      ],
    },
  ],
};

test("the canonical file name is the one the BFF goes looking for", () => {
  // `inferStoredDocumentFileName` in services/api matches `document.<ext>`.
  expect(canonicalFileNameFor("prosemirror")).toBe("document.json");
  expect(canonicalFileNameFor("markdown")).toBe("document.md");
  expect(canonicalFileNameFor("pdf")).toBe("document.pdf");
  expect(canonicalFileNameFor("docx")).toBe("document.docx");
});

test("Markdown keeps the document's structure as headings", () => {
  expect(renderSeedMarkdown(policy)).toBe(
    [
      "# Infection Control Policy",
      "",
      "## Purpose",
      "",
      "This policy sets out how the clinic prevents infection.",
      "",
      "## Hand Hygiene",
      "",
      "Alcohol-based hand rub is the default.",
      "",
      "The infection preventionist audits compliance monthly.",
      "",
    ].join("\n"),
  );
});

test("a seeded Word file is a real .docx", async () => {
  const file = await renderSeedDocumentFile(
    policy,
    "docx",
    "nursing/handover",
    UID,
  );
  const bytes = Buffer.from(file.content, "base64");

  // A file inside a binder, named for where it is filed, which document it is,
  // and how to render it.
  expect(file.path).toBe(`nursing/handover.${UID}.docx`);
  // "PK" — a .docx is an Office Open XML package in a ZIP.
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(bytes.toString("latin1")).toContain("word/document.xml");
});

test("a seeded PDF is a real PDF carrying the policy's words", async () => {
  const file = await renderSeedDocumentFile(
    policy,
    "pdf",
    "nursing/handover",
    UID,
  );
  const bytes = Buffer.from(file.content, "base64");

  expect(file.path).toBe(`nursing/handover.${UID}.pdf`);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // The text layer is the point: the comparison screen reads the words back
  // out of it, so a PDF of flat images would seed a document that can never
  // be compared.
  const { extractPdfBlocks } = await import("../apps/app/pdfText");
  const blocks = await extractPdfBlocks(new Blob([new Uint8Array(bytes)]));
  expect(blocks.map((block) => block.text)).toContain(
    "The infection preventionist audits compliance monthly.",
  );
});

test("re-rendering an unchanged policy produces the same bytes", async () => {
  // Seeding runs on every `docker compose up` and only commits what changed.
  // A live clock in the Word file's ZIP entries, or in either format's
  // metadata, would add a silent update to every open change on every run.
  for (const format of ["prosemirror", "markdown", "pdf", "docx"] as const) {
    const first = await renderSeedDocumentFile(
      policy,
      format,
      "nursing/handover",
      UID,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await renderSeedDocumentFile(
      policy,
      format,
      "nursing/handover",
      UID,
    );
    expect(second.content).toBe(first.content);
  }
});

test("editing the prose changes the bytes for every format", async () => {
  const edited: SeedDocument = {
    ...policy,
    sections: [
      policy.sections[0]!,
      {
        heading: "Hand Hygiene",
        paragraphs: [
          "Alcohol-based hand rub is the default.",
          "The infection preventionist audits compliance weekly.",
        ],
      },
    ],
  };

  for (const format of ["prosemirror", "markdown", "pdf", "docx"] as const) {
    const before = await renderSeedDocumentFile(
      policy,
      format,
      "nursing/handover",
      UID,
    );
    const after = await renderSeedDocumentFile(
      edited,
      format,
      "nursing/handover",
      UID,
    );
    expect(after.content).not.toBe(before.content);
  }
});

test("a document's identity is the same on every seed run", () => {
  // What keeps re-seeding a no-op. A minted identity would file the same policy
  // under a new name every run, orphan its tags, and restart it at v1 — the
  // exact bug ADR 0005 exists to prevent, reproduced by the tool that is meant
  // to demonstrate the fix.
  expect(
    seedDocumentUid("riverside-health", "clinical", "nursing/handover"),
  ).toBe(UID);
});

test("the same policy name in two binders is two documents", () => {
  // Derived from the binder as well as the address, so a "Handover" in
  // Clinical and a "Handover" in Facilities do not share a version series.
  expect(
    seedDocumentUid("riverside-health", "facilities", "nursing/handover"),
  ).not.toBe(UID);
  expect(
    seedDocumentUid("mercy-health", "clinical", "nursing/handover"),
  ).not.toBe(UID);
});
