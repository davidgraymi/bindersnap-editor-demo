/**
 * Mapping between Pandoc JSON AST and ProseMirror JSON.
 *
 * Covers common document elements: paragraphs, headings, lists, tables,
 * and inline formatting (bold, italic, code, links).
 *
 * Pandoc AST reference: https://hackage.haskell.org/package/pandoc-types
 */

// ─── ProseMirror types ───────────────────────────────────────────────────────

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMark[];
  text?: string;
}

export interface PMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMDoc {
  type: 'doc';
  content: PMNode[];
}

// ─── Pandoc AST types (subset) ───────────────────────────────────────────────

interface PandocDoc {
  blocks: PandocBlock[];
}

type PandocBlock =
  | { t: 'Para'; c: PandocInline[] }
  | { t: 'Plain'; c: PandocInline[] }
  | { t: 'Header'; c: [number, unknown, PandocInline[]] }
  | { t: 'BulletList'; c: PandocBlock[][] }
  | { t: 'OrderedList'; c: [unknown, PandocBlock[][]] }
  | { t: 'BlockQuote'; c: PandocBlock[] }
  | { t: 'CodeBlock'; c: [unknown, string] }
  | { t: 'HorizontalRule' }
  | { t: 'Table'; c: unknown[] }
  | { t: string; c?: unknown };

type PandocInline =
  | { t: 'Str'; c: string }
  | { t: 'Space' }
  | { t: 'SoftBreak' }
  | { t: 'LineBreak' }
  | { t: 'Strong'; c: PandocInline[] }
  | { t: 'Emph'; c: PandocInline[] }
  | { t: 'Underline'; c: PandocInline[] }
  | { t: 'Strikeout'; c: PandocInline[] }
  | { t: 'Code'; c: [unknown, string] }
  | { t: 'Link'; c: [unknown, PandocInline[], [string, string]] }
  | { t: string; c?: unknown };

// ─── Pandoc → ProseMirror ────────────────────────────────────────────────────

function pandocInlinesToPM(inlines: PandocInline[], activeMarks: PMark[] = []): PMNode[] {
  const nodes: PMNode[] = [];

  for (const inline of inlines) {
    switch (inline.t) {
      case 'Str':
        nodes.push({ type: 'text', text: inline.c, marks: activeMarks.length ? [...activeMarks] : undefined });
        break;
      case 'Space':
      case 'SoftBreak':
        nodes.push({ type: 'text', text: ' ', marks: activeMarks.length ? [...activeMarks] : undefined });
        break;
      case 'LineBreak':
        nodes.push({ type: 'hardBreak' });
        break;
      case 'Strong':
        nodes.push(...pandocInlinesToPM(inline.c, [...activeMarks, { type: 'bold' }]));
        break;
      case 'Emph':
        nodes.push(...pandocInlinesToPM(inline.c, [...activeMarks, { type: 'italic' }]));
        break;
      case 'Underline':
        nodes.push(...pandocInlinesToPM(inline.c, [...activeMarks, { type: 'underline' }]));
        break;
      case 'Strikeout':
        nodes.push(...pandocInlinesToPM(inline.c, [...activeMarks, { type: 'strike' }]));
        break;
      case 'Code':
        nodes.push({ type: 'text', text: inline.c[1], marks: [...activeMarks, { type: 'code' }] });
        break;
      case 'Link': {
        const [, linkInlines, [href]] = inline.c as [unknown, PandocInline[], [string, string]];
        const linkMark: PMark = { type: 'link', attrs: { href, target: '_blank' } };
        nodes.push(...pandocInlinesToPM(linkInlines, [...activeMarks, linkMark]));
        break;
      }
      default:
        // Unknown inline — skip silently
        break;
    }
  }

  return nodes;
}

function pandocBlocksToPM(blocks: PandocBlock[]): PMNode[] {
  const nodes: PMNode[] = [];

  for (const block of blocks) {
    switch (block.t) {
      case 'Para':
      case 'Plain': {
        const content = pandocInlinesToPM(block.c);
        nodes.push({ type: 'paragraph', content: content.length ? content : undefined });
        break;
      }
      case 'Header': {
        const [level, , inlines] = block.c;
        nodes.push({
          type: 'heading',
          attrs: { level },
          content: pandocInlinesToPM(inlines),
        });
        break;
      }
      case 'BulletList':
        nodes.push({
          type: 'bulletList',
          content: block.c.map((itemBlocks) => ({
            type: 'listItem',
            content: pandocBlocksToPM(itemBlocks),
          })),
        });
        break;
      case 'OrderedList':
        nodes.push({
          type: 'orderedList',
          attrs: { order: 1 },
          content: (block.c[1] as PandocBlock[][]).map((itemBlocks) => ({
            type: 'listItem',
            content: pandocBlocksToPM(itemBlocks),
          })),
        });
        break;
      case 'BlockQuote':
        nodes.push({ type: 'blockquote', content: pandocBlocksToPM(block.c) });
        break;
      case 'CodeBlock':
        nodes.push({ type: 'codeBlock', attrs: { language: '' }, content: [{ type: 'text', text: block.c[1] }] });
        break;
      case 'HorizontalRule':
        nodes.push({ type: 'horizontalRule' });
        break;
      default:
        // Unsupported block type — emit an empty paragraph as placeholder
        nodes.push({ type: 'paragraph' });
        break;
    }
  }

  return nodes;
}

export function pandocToProseMirror(pandocJson: PandocDoc): PMDoc {
  return {
    type: 'doc',
    content: pandocBlocksToPM(pandocJson.blocks),
  };
}

// ─── ProseMirror → Pandoc ────────────────────────────────────────────────────

function pmMarksToPandocWrap(
  inlines: PandocInline[],
  marks: PMark[] | undefined,
): PandocInline[] {
  if (!marks || marks.length === 0) return inlines;

  let wrapped = inlines;
  for (const mark of [...marks].reverse()) {
    switch (mark.type) {
      case 'bold':
        wrapped = [{ t: 'Strong', c: wrapped }];
        break;
      case 'italic':
        wrapped = [{ t: 'Emph', c: wrapped }];
        break;
      case 'underline':
        wrapped = [{ t: 'Underline', c: wrapped }];
        break;
      case 'strike':
        wrapped = [{ t: 'Strikeout', c: wrapped }];
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) ?? '';
        wrapped = [{ t: 'Link', c: [['', []], wrapped, [href, '']] }];
        break;
      }
      case 'code':
        wrapped = [{ t: 'Code', c: [['', [], []], (inlines[0] as { t: 'Str'; c: string })?.c ?? ''] }];
        break;
      default:
        break;
    }
  }
  return wrapped;
}

function pmNodesToPandocInlines(nodes: PMNode[] | undefined): PandocInline[] {
  if (!nodes) return [];
  const inlines: PandocInline[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      const base: PandocInline[] = [{ t: 'Str', c: node.text ?? '' }];
      inlines.push(...pmMarksToPandocWrap(base, node.marks));
    } else if (node.type === 'hardBreak') {
      inlines.push({ t: 'LineBreak' });
    }
  }

  return inlines;
}

function pmNodesToPandocBlocks(nodes: PMNode[] | undefined): PandocBlock[] {
  if (!nodes) return [];
  const blocks: PandocBlock[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        blocks.push({ t: 'Para', c: pmNodesToPandocInlines(node.content) });
        break;
      case 'heading':
        blocks.push({
          t: 'Header',
          c: [(node.attrs?.level as number) ?? 1, ['', [], []], pmNodesToPandocInlines(node.content)],
        });
        break;
      case 'bulletList':
        blocks.push({
          t: 'BulletList',
          c: (node.content ?? []).map((item) => pmNodesToPandocBlocks(item.content)),
        });
        break;
      case 'orderedList':
        blocks.push({
          t: 'OrderedList',
          c: [
            [1, { t: 'Decimal' }, { t: 'Period' }],
            (node.content ?? []).map((item) => pmNodesToPandocBlocks(item.content)),
          ],
        });
        break;
      case 'blockquote':
        blocks.push({ t: 'BlockQuote', c: pmNodesToPandocBlocks(node.content) });
        break;
      case 'codeBlock':
        blocks.push({ t: 'CodeBlock', c: [['', [], []], (node.content?.[0]?.text) ?? ''] });
        break;
      case 'horizontalRule':
        blocks.push({ t: 'HorizontalRule' });
        break;
      default:
        // Fallback: render as paragraph
        blocks.push({ t: 'Para', c: pmNodesToPandocInlines(node.content) });
        break;
    }
  }

  return blocks;
}

export function proseMirrorToPandoc(doc: PMDoc): PandocDoc {
  return {
    blocks: pmNodesToPandocBlocks(doc.content),
    // Minimal Pandoc meta required by pandoc CLI
    meta: {},
    'pandoc-api-version': [1, 23, 1],
  } as unknown as PandocDoc;
}
