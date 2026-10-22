import { afterEach, describe, expect, test } from "bun:test";
import { Editor, generateHTML } from "@tiptap/core";

import { documentContentExtensions } from "./documentSchema";
import {
  countDocument,
  countSelectedWords,
  countWords,
  documentOutline,
  paginate,
} from "./documentStats";
import { readEntries } from "./extensions/TableOfContents";
import {
  SearchAndReplace,
  findMatches,
  getSearchState,
} from "./extensions/SearchAndReplace";

const editors: Editor[] = [];

function editorWith(content: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...documentContentExtensions(), SearchAndReplace],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

describe("the document schema", () => {
  test("line spacing is the paragraph's, and survives the round trip", () => {
    const editor = editorWith("<p>One</p><p>Two</p>");
    editor.chain().selectAll().setLineSpacing("1.5").run();

    const json = editor.getJSON();
    expect(json.content?.[0]?.attrs?.lineSpacing).toBe("1.5");
    expect(json.content?.[1]?.attrs?.lineSpacing).toBe("1.5");

    // What the reader draws, from the same list.
    const html = generateHTML(json, documentContentExtensions());
    expect(html).toContain('style="line-height: 1.5;"');
  });

  test("a spacing that is not on the menu is refused", () => {
    const editor = editorWith("<p>One</p>");
    expect(editor.chain().selectAll().setLineSpacing("9").run()).toBe(false);
    expect(editor.getJSON().content?.[0]?.attrs?.lineSpacing).toBeNull();
  });

  test("indent moves a paragraph in half an inch a step, and never below zero", () => {
    const editor = editorWith("<p>Body</p>");
    editor.commands.setTextSelection(2);
    editor.commands.indentParagraph();
    editor.commands.indentParagraph();
    expect(editor.getJSON().content?.[0]?.attrs?.indent).toBe(2);
    expect(editor.getHTML()).toContain("margin-left: 1in");

    editor.commands.outdentParagraph();
    editor.commands.outdentParagraph();
    expect(editor.commands.outdentParagraph()).toBe(false);
    expect(editor.getJSON().content?.[0]?.attrs?.indent).toBe(0);
  });

  test("a list item is indented by nesting, not by a margin", () => {
    const editor = editorWith("<ul><li><p>Item</p></li></ul>");
    editor.commands.setTextSelection(3);
    expect(editor.commands.indentParagraph()).toBe(false);
  });

  test("a picture keeps its width, never a height that could squash it", () => {
    const png = "https://example.com/map.png";
    const editor = editorWith(
      `<p><img src="${png}" width="312" height="90"><img src="${png}" width="40%"></p>`,
    );
    const [sized, relative] = editor.getJSON().content?.[0]?.content ?? [];
    expect(sized?.attrs?.width).toBe(312);
    expect(sized?.attrs?.height).toBeNull();
    expect(relative?.attrs?.width).toBeNull();
    const html = editor.getHTML();
    expect(html).toContain('width="312"');
    expect(html).not.toContain("height=");
  });

  test("a page break is a node of its own, and prints as one", () => {
    const editor = editorWith("<p>Before</p>");
    editor.commands.setTextSelection(7);
    editor.commands.setPageBreak();

    const types = editor.getJSON().content?.map((node) => node.type);
    expect(types).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(editor.getHTML()).toContain('class="bs-page-break"');
  });
});

describe("a table of contents", () => {
  const entriesOf = (editor: Editor) =>
    editor.getJSON().content?.find((node) => node.type === "tableOfContents")
      ?.attrs?.entries;

  test("lists headings 1 to 3, in order, where it is put", () => {
    const editor = editorWith(
      "<p></p><h1>Hand Hygiene</h1><h2>Scope</h2><h4>Too deep</h4><h3>Gloves</h3><h2></h2>",
    );
    editor.commands.setTextSelection(1);
    editor.commands.insertTableOfContents();
    expect(entriesOf(editor)).toEqual([
      { level: 1, text: "Hand Hygiene" },
      { level: 2, text: "Scope" },
      { level: 3, text: "Gloves" },
    ]);
    const html = editor.getHTML();
    expect(html).toContain('class="bs-toc"');
    expect(html).toContain("bs-toc-entry--2");
    expect(html).toContain(">Gloves</p>");
  });

  test("follows the headings as they change, and Undo takes both back", () => {
    const editor = editorWith("<p></p><h2>Scope</h2>");
    editor.commands.setTextSelection(1);
    editor.commands.insertTableOfContents();
    // Type into the heading: the contents change in the same step.
    let end = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") end = offset + node.nodeSize - 1;
    });
    editor.chain().setTextSelection(end).insertContent(" and purpose").run();
    expect(entriesOf(editor)).toEqual([
      { level: 2, text: "Scope and purpose" },
    ]);
    editor.commands.undo();
    expect(entriesOf(editor)).toEqual([{ level: 2, text: "Scope" }]);
  });

  test("goes beside the paragraph the cursor is in, never through it", () => {
    const editor = editorWith("<h1>Policy</h1><p>Clean your hands.</p>");
    editor.commands.setTextSelection(13); // "Clean yo|ur"
    editor.commands.insertTableOfContents();
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "tableOfContents",
      "paragraph",
    ]);
    expect(editor.getText()).toContain("Clean your hands.");
    // At the start of a block, it goes before it.
    editor.commands.setTextSelection(1);
    editor.commands.insertTableOfContents();
    expect(editor.getJSON().content?.[0]?.type).toBe("tableOfContents");
    // And the cursor is after it, so typing does not replace it.
    editor.commands.insertContent("x");
    expect(editor.getJSON().content?.[0]?.type).toBe("tableOfContents");
  });

  test("with no headings it says how to get some", () => {
    const editor = editorWith("<p>Just words</p>");
    editor.commands.setTextSelection(1);
    editor.commands.insertTableOfContents();
    expect(entriesOf(editor)).toEqual([]);
    expect(editor.getHTML()).toContain("No headings yet.");
  });

  test("the reader draws what was stored, and only text", () => {
    const html = generateHTML(
      {
        type: "doc",
        content: [
          {
            type: "tableOfContents",
            attrs: {
              entries: [
                { level: 2, text: "<b>Scope</b>" },
                { level: 9, text: "Deep" },
                { text: 5 },
                "junk",
              ],
            },
          },
        ],
      },
      documentContentExtensions(),
    );
    expect(html).toContain("&lt;b&gt;Scope&lt;/b&gt;");
    expect(html).toContain("bs-toc-entry--3");
    expect(readEntries("junk")).toEqual([]);
  });
});

describe("find and replace", () => {
  test("finds every match, ignoring case unless asked", () => {
    const editor = editorWith(
      "<p>Hand hygiene is hand washing.</p><p>HAND rub</p>",
    );
    expect(findMatches(editor.state.doc, "hand", false)).toHaveLength(3);
    expect(findMatches(editor.state.doc, "hand", true)).toHaveLength(1);
    expect(findMatches(editor.state.doc, "", false)).toHaveLength(0);
  });

  test("never matches across two paragraphs", () => {
    const editor = editorWith("<p>end of one</p><p>start of two</p>");
    expect(findMatches(editor.state.doc, "onestart", false)).toHaveLength(0);
    expect(findMatches(editor.state.doc, "one start", false)).toHaveLength(0);
  });

  test("steps through matches, wrapping at the end", () => {
    const editor = editorWith("<p>a b a b a</p>");
    editor.commands.setTextSelection(1);
    editor.commands.setSearchQuery("a");
    expect(getSearchState(editor.state)?.current).toBe(0);

    editor.commands.nextSearchMatch();
    editor.commands.nextSearchMatch();
    expect(getSearchState(editor.state)?.current).toBe(2);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("a");

    editor.commands.nextSearchMatch();
    expect(getSearchState(editor.state)?.current).toBe(0);
    editor.commands.previousSearchMatch();
    expect(getSearchState(editor.state)?.current).toBe(2);
  });

  test("replaces one, then all, and keeps the formatting around them", () => {
    const editor = editorWith(
      "<p><strong>thirty</strong> days, then thirty more</p>",
    );
    editor.commands.setTextSelection(1);
    editor.commands.setSearchQuery("thirty");
    editor.commands.replaceSearchMatch("sixty");
    expect(editor.getText()).toBe("sixty days, then thirty more");
    expect(editor.getHTML()).toContain("<strong>sixty</strong>");

    editor.commands.setSearchQuery("then thirty");
    editor.commands.replaceAllSearchMatches("then sixty");
    expect(editor.getText()).toBe("sixty days, then sixty more");
    expect(getSearchState(editor.state)?.matches).toHaveLength(0);
  });
});

describe("document statistics", () => {
  test("counts words the way Word does", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("A follow-up in 3.5 days.")).toBe(5);
  });

  test("counts words, characters and non-empty paragraphs", () => {
    const editor = editorWith(
      "<h1>Title</h1><p>Two words</p><p></p><ul><li><p>one more</p></li></ul>",
    );
    expect(countDocument(editor.state.doc)).toEqual({
      words: 5,
      characters: 22,
      paragraphs: 3,
    });
  });

  test("counts the selected words, apart across paragraphs", () => {
    const editor = editorWith("<p>Wash your</p><p>hands now</p>");
    const { doc } = editor.state;
    expect(countSelectedWords(doc, 3, 3)).toBeNull();
    // "sh your" + "hands": the paragraph boundary is a gap between words.
    expect(countSelectedWords(doc, 4, doc.content.size - 5)).toBe(3);
  });

  test("the outline is every heading with text, in order", () => {
    const editor = editorWith(
      "<h1>Policy</h1><p>x</p><h2>Scope</h2><h2></h2><blockquote><h3>Note</h3></blockquote>",
    );
    expect(
      documentOutline(editor.state.doc).map(({ level, text }) => [level, text]),
    ).toEqual([
      [1, "Policy"],
      [2, "Scope"],
      [3, "Note"],
    ]);
  });
});

describe("pagination", () => {
  test("one page until the blocks overflow it", () => {
    expect(paginate([], 100)).toEqual({ starts: [], pages: 1 });
    expect(paginate([{ height: 40 }, { height: 60 }], 100)).toEqual({
      starts: [],
      pages: 1,
    });
    expect(
      paginate([{ height: 40 }, { height: 40 }, { height: 40 }], 100),
    ).toEqual({ starts: [2], pages: 2 });
  });

  test("a page break starts the next page, and a trailing one adds nothing", () => {
    expect(
      paginate(
        [{ height: 10 }, { height: 0, pageBreak: true }, { height: 10 }],
        100,
      ),
    ).toEqual({ starts: [2], pages: 2 });
    expect(
      paginate([{ height: 10 }, { height: 0, pageBreak: true }], 100),
    ).toEqual({ starts: [], pages: 1 });
  });

  test("a block taller than a page fills the pages it needs", () => {
    expect(paginate([{ height: 250 }], 100)).toEqual({ starts: [], pages: 3 });
    expect(paginate([{ height: 50 }, { height: 250 }], 100)).toEqual({
      starts: [1],
      pages: 4,
    });
  });
});
