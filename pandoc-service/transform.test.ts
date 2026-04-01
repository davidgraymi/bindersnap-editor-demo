import { describe, expect, test } from 'bun:test';
import { pandocToProseMirror, proseMirrorToPandoc } from './transform';
import type { PMDoc } from './transform';

// ─── pandocToProseMirror ──────────────────────────────────────────────────────

describe('pandocToProseMirror', () => {
  test('wraps blocks in a doc node', () => {
    const result = pandocToProseMirror({ blocks: [] });
    expect(result.type).toBe('doc');
    expect(result.content).toEqual([]);
  });

  test('converts Para to paragraph', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hello' }] }],
    });
    expect(result.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello' }],
    });
  });

  test('converts Plain to paragraph', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Plain', c: [{ t: 'Str', c: 'Plain text' }] }],
    });
    expect(result.content[0].type).toBe('paragraph');
  });

  test('converts Header with level', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Header', c: [2, {}, [{ t: 'Str', c: 'Title' }]] }],
    });
    expect(result.content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Title' }],
    });
  });

  test('converts BulletList with items', () => {
    const result = pandocToProseMirror({
      blocks: [
        {
          t: 'BulletList',
          c: [
            [{ t: 'Para', c: [{ t: 'Str', c: 'Item 1' }] }],
            [{ t: 'Para', c: [{ t: 'Str', c: 'Item 2' }] }],
          ],
        },
      ],
    });
    expect(result.content[0].type).toBe('bulletList');
    expect(result.content[0].content).toHaveLength(2);
    expect(result.content[0].content![0]).toMatchObject({ type: 'listItem' });
  });

  test('converts OrderedList with items', () => {
    const result = pandocToProseMirror({
      blocks: [
        {
          t: 'OrderedList',
          c: [
            {},
            [
              [{ t: 'Para', c: [{ t: 'Str', c: 'First' }] }],
            ],
          ],
        },
      ],
    });
    expect(result.content[0]).toMatchObject({ type: 'orderedList', attrs: { order: 1 } });
    expect(result.content[0].content![0].type).toBe('listItem');
  });

  test('converts BlockQuote', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'BlockQuote', c: [{ t: 'Para', c: [{ t: 'Str', c: 'Quoted' }] }] }],
    });
    expect(result.content[0]).toMatchObject({ type: 'blockquote' });
  });

  test('converts CodeBlock', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'CodeBlock', c: [{}, 'const x = 1;'] }],
    });
    expect(result.content[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: '' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    });
  });

  test('converts HorizontalRule', () => {
    const result = pandocToProseMirror({ blocks: [{ t: 'HorizontalRule' }] });
    expect(result.content[0]).toEqual({ type: 'horizontalRule' });
  });

  test('emits empty paragraph for unknown block types', () => {
    const result = pandocToProseMirror({ blocks: [{ t: 'UnknownBlock' as never }] });
    expect(result.content[0].type).toBe('paragraph');
  });

  test('converts Space inline as single space', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'a' }, { t: 'Space' }, { t: 'Str', c: 'b' }] }],
    });
    const texts = result.content[0].content!.map((n) => n.text);
    expect(texts).toEqual(['a', ' ', 'b']);
  });

  test('converts Strong inline with bold mark', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Strong', c: [{ t: 'Str', c: 'bold' }] }] }],
    });
    const node = result.content[0].content![0];
    expect(node.marks).toEqual([{ type: 'bold' }]);
  });

  test('converts Emph inline with italic mark', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Emph', c: [{ t: 'Str', c: 'italic' }] }] }],
    });
    const node = result.content[0].content![0];
    expect(node.marks).toEqual([{ type: 'italic' }]);
  });

  test('converts Strikeout inline with strike mark', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Strikeout', c: [{ t: 'Str', c: 'struck' }] }] }],
    });
    expect(result.content[0].content![0].marks).toEqual([{ type: 'strike' }]);
  });

  test('converts Underline inline with underline mark', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Underline', c: [{ t: 'Str', c: 'ul' }] }] }],
    });
    expect(result.content[0].content![0].marks).toEqual([{ type: 'underline' }]);
  });

  test('converts Code inline with code mark', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Code', c: [{}, 'foo()'] }] }],
    });
    const node = result.content[0].content![0];
    expect(node.text).toBe('foo()');
    expect(node.marks).toContainEqual({ type: 'code' });
  });

  test('converts Link inline with link mark', () => {
    const result = pandocToProseMirror({
      blocks: [
        {
          t: 'Para',
          c: [{ t: 'Link', c: [{}, [{ t: 'Str', c: 'click' }], ['https://example.com', '']] }],
        },
      ],
    });
    const node = result.content[0].content![0];
    expect(node.marks).toContainEqual({ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } });
  });

  test('converts LineBreak to hardBreak', () => {
    const result = pandocToProseMirror({
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'a' }, { t: 'LineBreak' }, { t: 'Str', c: 'b' }] }],
    });
    expect(result.content[0].content![1]).toEqual({ type: 'hardBreak' });
  });
});

// ─── proseMirrorToPandoc ──────────────────────────────────────────────────────

describe('proseMirrorToPandoc', () => {
  test('produces a pandoc doc with blocks array', () => {
    const result = proseMirrorToPandoc({ type: 'doc', content: [] });
    expect(Array.isArray(result.blocks)).toBe(true);
  });

  test('converts paragraph to Para', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0]).toMatchObject({ t: 'Para', c: [{ t: 'Str', c: 'Hello' }] });
  });

  test('converts heading to Header', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Hi' }] }],
    };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0]).toMatchObject({ t: 'Header', c: [3, expect.anything(), [{ t: 'Str', c: 'Hi' }]] });
  });

  test('converts bulletList to BulletList', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
        }],
      }],
    };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0].t).toBe('BulletList');
  });

  test('converts orderedList to OrderedList', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{
        type: 'orderedList',
        attrs: { order: 1 },
        content: [{
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
        }],
      }],
    };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0].t).toBe('OrderedList');
  });

  test('converts blockquote to BlockQuote', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Q' }] }],
      }],
    };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0].t).toBe('BlockQuote');
  });

  test('converts codeBlock to CodeBlock', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1' }] }],
    };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0]).toMatchObject({ t: 'CodeBlock', c: [expect.anything(), 'let x = 1'] });
  });

  test('converts horizontalRule to HorizontalRule', () => {
    const doc: PMDoc = { type: 'doc', content: [{ type: 'horizontalRule' }] };
    const result = proseMirrorToPandoc(doc);
    expect(result.blocks[0]).toMatchObject({ t: 'HorizontalRule' });
  });

  test('converts bold mark to Strong', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
      }],
    };
    const result = proseMirrorToPandoc(doc);
    const inlines = (result.blocks[0] as { t: 'Para'; c: unknown[] }).c;
    expect(inlines[0]).toMatchObject({ t: 'Strong', c: [{ t: 'Str', c: 'bold' }] });
  });

  test('converts italic mark to Emph', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'em', marks: [{ type: 'italic' }] }],
      }],
    };
    const result = proseMirrorToPandoc(doc);
    const inlines = (result.blocks[0] as { t: 'Para'; c: unknown[] }).c;
    expect(inlines[0]).toMatchObject({ t: 'Emph' });
  });

  test('converts hardBreak to LineBreak', () => {
    const doc: PMDoc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }],
      }],
    };
    const result = proseMirrorToPandoc(doc);
    const inlines = (result.blocks[0] as { t: 'Para'; c: unknown[] }).c as Array<{ t: string }>;
    expect(inlines[1].t).toBe('LineBreak');
  });
});

// ─── round-trip ───────────────────────────────────────────────────────────────

describe('round-trip', () => {
  test('paragraph with plain text survives pandoc→PM→pandoc', () => {
    const original = {
      blocks: [{ t: 'Para' as const, c: [{ t: 'Str' as const, c: 'Round-trip text' }] }],
    };
    const pm = pandocToProseMirror(original);
    const back = proseMirrorToPandoc(pm);
    expect(back.blocks[0]).toMatchObject({ t: 'Para', c: [{ t: 'Str', c: 'Round-trip text' }] });
  });

  test('heading survives PM→pandoc→PM', () => {
    const original: PMDoc = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading' }] }],
    };
    const pandoc = proseMirrorToPandoc(original);
    const back = pandocToProseMirror(pandoc);
    expect(back.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(back.content[0].content![0].text).toBe('Heading');
  });
});
