import { expect, test } from "bun:test";

import { renderSeedDocumentFile } from "../../tests/seed-documents";
import { extractPdfBlocks } from "./pdfText";

/**
 * Reading a PDF back as a document.
 *
 * A PDF carries glyphs at coordinates, not prose. These tests run against a
 * real PDF — the one the seed generates — because the whole question is
 * whether the structure can be recovered from what a writer actually puts on
 * a page, and a hand-built fixture would be answering an easier one.
 */

const policy = {
  title: "Medication Administration Policy",
  sections: [
    {
      heading: "Purpose",
      paragraphs: [
        "This policy sets out how medication is prescribed, verified, administered, and documented, and how an error is reported.",
      ],
    },
    {
      heading: "Scope",
      paragraphs: [
        "This policy applies to every licensed clinician who administers medication.",
        "It applies at all sites, including the mobile unit.",
      ],
    },
  ],
};

async function blocksOf(document: typeof policy) {
  const file = await renderSeedDocumentFile(document, "pdf");
  const bytes = Buffer.from(file.content, "base64");
  return extractPdfBlocks(new Blob([new Uint8Array(bytes)]));
}

test("the title and the section headings come back as headings", async () => {
  const blocks = await blocksOf(policy);

  // The bug this covers: everything joined with spaces, so the policy read
  // "Medication Administration Policy Purpose This policy sets out..." as one
  // run-on line and the comparison marked it as one.
  expect(blocks[0]).toEqual({
    kind: "heading",
    level: 1,
    text: "Medication Administration Policy",
  });
  expect(blocks[1]).toEqual({ kind: "heading", level: 2, text: "Purpose" });
  expect(blocks[2]?.kind).toBe("paragraph");
  expect(blocks.find((block) => block.text === "Scope")?.kind).toBe("heading");
});

test("a paragraph that wrapped over several lines comes back as one", async () => {
  const blocks = await blocksOf(policy);
  const purpose = blocks[2];

  expect(purpose?.kind).toBe("paragraph");
  // Set at eleven point inside a measure of 468 points, this ran to three
  // lines on the page; it has to read as one paragraph again.
  expect(purpose?.text).toBe(
    "This policy sets out how medication is prescribed, verified, administered, and documented, and how an error is reported.",
  );
});

test("two paragraphs under one heading stay two paragraphs", async () => {
  const blocks = await blocksOf(policy);
  const scope = blocks.findIndex((block) => block.text === "Scope");

  expect(blocks[scope + 1]?.text).toBe(
    "This policy applies to every licensed clinician who administers medication.",
  );
  expect(blocks[scope + 2]?.text).toBe(
    "It applies at all sites, including the mobile unit.",
  );
});

test("a PDF with no text layer comes back with nothing rather than noise", async () => {
  // A one-page PDF carrying no text operators at all — what a scan of paper
  // looks like to pdf.js.
  const blank =
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n";

  const blocks = await extractPdfBlocks(
    new Blob([new TextEncoder().encode(blank)]),
  );
  expect(blocks).toEqual([]);
});
