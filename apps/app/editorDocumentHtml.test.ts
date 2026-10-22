import { expect, test } from "bun:test";

import {
  editorDocumentToHtml,
  parseEditorDocument,
  pruneToSchema,
} from "./editorDocumentHtml";

const policy = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "HIPAA Training Policy" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "All staff complete training " },
        {
          type: "text",
          text: "within thirty days",
          marks: [{ type: "bold" }],
        },
        { type: "text", text: " of hire." },
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
              content: [{ type: "text", text: "Annual refresher" }],
            },
          ],
        },
      ],
    },
  ],
};

test("a document the editor wrote reads as a document, not as its JSON", async () => {
  const html = await editorDocumentToHtml(JSON.stringify(policy, null, 2));

  expect(html).not.toBeNull();
  expect(html).toContain("<h1>HIPAA Training Policy</h1>");
  expect(html).toContain("<strong>within thirty days</strong>");
  expect(html).toContain("<li>");
  expect(html).not.toContain('"type"');
});

test("a .json that is data stays data", async () => {
  expect(await editorDocumentToHtml('{"rates": [1, 2, 3]}')).toBeNull();
  expect(await editorDocumentToHtml("[1, 2, 3]")).toBeNull();
  expect(await editorDocumentToHtml("not json at all")).toBeNull();
  expect(await editorDocumentToHtml('{"type": "doc", "content": ')).toBeNull();
});

test("the editor's own marks and nodes are unwrapped, and their words kept", async () => {
  const withEditorOnlyParts = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Hands are washed",
            marks: [{ type: "commentAnchor", attrs: { threadId: "t1" } }],
          },
        ],
      },
      {
        type: "conflict",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "before every contact" }],
          },
        ],
      },
    ],
  };

  const html = await editorDocumentToHtml(JSON.stringify(withEditorOnlyParts));
  expect(html).toContain("<p>Hands are washed</p>");
  expect(html).toContain("<p>before every contact</p>");
});

test("pruning keeps known types and drops the rest", () => {
  const [pruned] = pruneToSchema(
    {
      type: "doc",
      content: [
        {
          type: "text",
          text: "x",
          marks: [{ type: "bold" }, { type: "mystery" }],
        },
      ],
    },
    new Set(["doc", "text"]),
    new Set(["bold"]),
  );
  expect(pruned).toEqual({
    type: "doc",
    content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
  });
});

test("parsing refuses anything that is not the editor's shape", () => {
  expect(parseEditorDocument("  " + JSON.stringify(policy))).not.toBeNull();
  expect(parseEditorDocument('{"type": "doc"}')).toBeNull();
});
