import { describe, expect, test } from "bun:test";

import {
  passagesFromBlocks,
  passagesFromEditorDocument,
  passagesFromMarkdown,
} from "./documentPassages";

describe("passagesFromEditorDocument", () => {
  test("every block is a passage, filed under the heading before it", () => {
    const passages = passagesFromEditorDocument({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Hand Hygiene" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Use an " },
            { type: "text", text: "alcohol-based", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "rub." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Before care" }],
                },
              ],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Gloves" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(passages).toEqual([
      { ordinal: 0, heading: "Hand Hygiene", text: "Hand Hygiene" },
      {
        ordinal: 1,
        heading: "Hand Hygiene",
        text: "Use an alcohol-based rub.",
      },
      { ordinal: 2, heading: "Hand Hygiene", text: "Before care" },
      { ordinal: 3, heading: "Hand Hygiene", text: "Gloves" },
    ]);
  });

  test("a picture is its alt text, never its data, and empty blocks are skipped", () => {
    const passages = passagesFromEditorDocument({
      type: "doc",
      content: [
        { type: "paragraph" },
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "data:image/png;base64,AAAA",
                alt: "Handwashing steps",
              },
            },
          ],
        },
      ],
    });
    expect(passages).toEqual([
      { ordinal: 0, heading: null, text: "Handwashing steps" },
    ]);
  });

  test("a node it does not know is read for the blocks inside it", () => {
    const passages = passagesFromEditorDocument({
      type: "doc",
      content: [
        {
          type: "somethingNew",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Kept" }] },
          ],
        },
      ],
    });
    expect(passages.map((passage) => passage.text)).toEqual(["Kept"]);
  });

  test("anything that is not a document has no passages", () => {
    expect(passagesFromEditorDocument(null)).toEqual([]);
    expect(passagesFromEditorDocument("doc")).toEqual([]);
  });
});

describe("passagesFromMarkdown", () => {
  test("headings, paragraphs, list items and table rows", () => {
    const passages = passagesFromMarkdown(
      [
        "# Infection Control",
        "",
        "Staff **must** clean",
        "every [surface](https://example.com).",
        "",
        "## Steps",
        "- Wear `PPE`",
        "1. Wash hands",
        "",
        "| Item | When |",
        "| --- | --- |",
        "| Gloves | Always |",
        "",
        "```",
        "code line",
        "```",
      ].join("\n"),
    );
    expect(passages).toEqual([
      { ordinal: 0, heading: "Infection Control", text: "Infection Control" },
      {
        ordinal: 1,
        heading: "Infection Control",
        text: "Staff must clean every surface.",
      },
      { ordinal: 2, heading: "Steps", text: "Steps" },
      { ordinal: 3, heading: "Steps", text: "Wear PPE" },
      { ordinal: 4, heading: "Steps", text: "Wash hands" },
      { ordinal: 5, heading: "Steps", text: "Item When" },
      { ordinal: 6, heading: "Steps", text: "Gloves Always" },
      { ordinal: 7, heading: "Steps", text: "code line" },
    ]);
  });
});

describe("passagesFromBlocks", () => {
  test("whitespace collapses and empty blocks are not counted", () => {
    expect(
      passagesFromBlocks([
        { kind: "paragraph", text: "  " },
        { kind: "heading", text: "Scope\n" },
        { kind: "paragraph", text: "All   sites" },
      ]),
    ).toEqual([
      { ordinal: 0, heading: "Scope", text: "Scope" },
      { ordinal: 1, heading: "Scope", text: "All sites" },
    ]);
  });
});
