import { describe, expect, test } from "bun:test";

import {
  describeExportStatus,
  exportDocument,
  exportFilename,
} from "./exportPolicy";
import { SAMPLE_POLICY } from "./fixtures";
import { policyBlocks } from "./policyBlocks";

const heading = { title: "Infection Control Policy", status: "Version 3" };
const json = new TextEncoder().encode(JSON.stringify(SAMPLE_POLICY));

describe("policyBlocks", () => {
  const blocks = policyBlocks(SAMPLE_POLICY as never);

  test("numbers sections the way the page does, and fills in the contents", () => {
    const headings = blocks.filter((block) => block.kind === "heading");
    expect(
      headings.map((block) => block.kind === "heading" && block.number),
    ).toEqual([null, "1.", "1.1", "2."]);
    const contents = blocks.find((block) => block.kind === "contents");
    expect(
      contents?.kind === "contents" &&
        contents.entries.map((entry) => entry.text),
    ).toEqual([
      "Infection Control Policy",
      "Hand hygiene",
      "Checks",
      "Records",
    ]);
  });

  test("keeps the marks on a run", () => {
    const first = blocks.find((block) => block.kind === "paragraph");
    expect(
      first?.kind === "paragraph" && first.runs.find((run) => run.link)?.link,
    ).toBe("https://www.cdc.gov");
  });
});

describe("exportDocument", () => {
  test("a policy written here becomes a real PDF", async () => {
    const result = await exportDocument({
      path: "nursing/infection-control.json",
      bytes: json,
      format: "pdf",
      heading,
    });
    expect(result.kind).toBe("converted");
    if (result.kind !== "converted") return;
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
  });

  test("the same policy makes the same PDF, byte for byte", async () => {
    const make = async () =>
      exportDocument({ path: "a.json", bytes: json, format: "pdf", heading });
    const [first, second] = await Promise.all([make(), make()]);
    expect(first.kind === "converted" && second.kind === "converted").toBe(
      true,
    );
    if (first.kind !== "converted" || second.kind !== "converted") return;
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(
      true,
    );
  });

  test("a policy written here becomes a Word document", async () => {
    const result = await exportDocument({
      path: "a.json",
      bytes: json,
      format: "docx",
      heading,
    });
    expect(result.kind).toBe("converted");
    if (result.kind !== "converted") return;
    // A .docx is a zip.
    expect(result.bytes[0]).toBe(0x50);
    expect(result.bytes[1]).toBe(0x4b);
  });

  test("an uploaded file is handed back as itself, or the refusal says why", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      (await exportDocument({ path: "a.pdf", bytes, format: "pdf", heading }))
        .kind,
    ).toBe("original");
    const refused = await exportDocument({
      path: "a.docx",
      bytes,
      format: "pdf",
      heading,
    });
    expect(refused.kind).toBe("refused");
    expect(refused.kind === "refused" && refused.reason).toContain(
      "a Word document",
    );
  });
});

describe("describeExportStatus", () => {
  const versions = [
    { tag: "doc/x/v2", version: 2, publishedAt: "2026-03-14T10:00:00Z" },
    { tag: "doc/x/v1", version: 1, publishedAt: "2026-01-02T10:00:00Z" },
  ];

  test("the record is its newest version", () => {
    expect(describeExportStatus({ ref: "main", versions })).toBe(
      "Version 2 · published March 14, 2026",
    );
  });

  test("an older version says it has been replaced", () => {
    expect(describeExportStatus({ ref: "doc/x/v1", versions })).toBe(
      "Version 1 · published January 2, 2026 · replaced by version 2",
    );
  });

  test("a branch is proposed, and nothing yet is not published", () => {
    expect(describeExportStatus({ ref: "draft/alice/1", versions })).toBe(
      "Proposed — not yet approved",
    );
    expect(describeExportStatus({ ref: "main", versions: [] })).toBe(
      "Not yet published",
    );
  });
});

describe("exportFilename", () => {
  test("says which policy and which version", () => {
    expect(
      exportFilename({
        slugPath: "nursing/hand-hygiene",
        version: 3,
        proposed: false,
        format: "pdf",
      }),
    ).toBe("hand-hygiene-v3.pdf");
    expect(
      exportFilename({
        slugPath: "hand-hygiene",
        version: null,
        proposed: true,
        format: "docx",
      }),
    ).toBe("hand-hygiene-proposed.docx");
  });
});
