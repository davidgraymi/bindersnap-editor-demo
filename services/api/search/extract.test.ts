import { describe, expect, test } from "bun:test";

import { renderSeedDocumentFile } from "../../../tests/seed-documents";
import type { SeedDocumentFormat } from "../../../tests/seed-scenario";
import { extractPassages, htmlBlocks, readableFormat } from "./extract";

/**
 * Against the files the seed writes — a real Word file, a real PDF — because
 * the question is whether the words come out of what a writer actually
 * uploads, not out of a fixture built to be easy.
 */
const policy = {
  title: "Hand Hygiene Policy",
  sections: [
    {
      heading: "Purpose",
      paragraphs: ["Staff use an alcohol-based rub before & after care."],
    },
    { heading: "Scope", paragraphs: ["Every clinician, at every site."] },
  ],
};

async function passagesOf(format: SeedDocumentFormat) {
  const file = await renderSeedDocumentFile(
    policy,
    format,
    "clinical/hand-hygiene",
    "01J8XZ4K7MQ9V3B0RN7YHS2E1D",
  );
  // The seed hands every file over base64, as Gitea's contents API takes it.
  return extractPassages(
    file.path,
    new Uint8Array(Buffer.from(file.content, "base64")),
  );
}

describe("extractPassages", () => {
  for (const format of ["prosemirror", "markdown", "docx", "pdf"] as const) {
    test(`reads the words of a ${format} file, section by section`, async () => {
      const passages = await passagesOf(format);
      expect(passages).not.toBeNull();
      const texts = passages!.map((passage) => passage.text);
      expect(texts).toContain("Hand Hygiene Policy");
      expect(texts).toContain(
        "Staff use an alcohol-based rub before & after care.",
      );
      const scope = passages!.find((passage) =>
        passage.text.startsWith("Every clinician"),
      );
      expect(scope?.heading).toBe("Scope");
    });
  }

  test("a format it does not read is null, not empty", async () => {
    expect(
      await extractPassages("forms/intake.xlsx", new Uint8Array(4)),
    ).toBeNull();
    expect(readableFormat("a/b.DOCX")).toBe("docx");
  });

  test("a .json the editor did not write is found by its title only", async () => {
    const bytes = new TextEncoder().encode('{"rows":[1,2,3]}');
    expect(await extractPassages("data/export.json", bytes)).toBeNull();
  });
});

describe("htmlBlocks", () => {
  test("a block nested in another is read once, in order, entities decoded once", async () => {
    expect(
      await htmlBlocks(
        "<h2>Steps</h2><ul><li><p>Wash &amp;lt;hands&gt;</p></li></ul><table><tr><td><p>A<br />B</p></td></tr></table>",
      ),
    ).toEqual([
      { kind: "heading", text: "Steps" },
      { kind: "paragraph", text: "" },
      { kind: "paragraph", text: "Wash &lt;hands>" },
      { kind: "paragraph", text: "" },
      { kind: "paragraph", text: "A B" },
    ]);
  });
});
