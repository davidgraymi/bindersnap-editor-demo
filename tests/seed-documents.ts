/**
 * Turning a seeded document into the bytes that get committed.
 *
 * The scenario file describes a policy as prose — a title, headings, and
 * paragraphs — and never mentions a file format beyond one `format:` line on
 * the document. This module is the only place that knows what each of those
 * formats actually looks like on disk, so adding a third policy in Word is a
 * YAML edit rather than a code change.
 *
 * Word files and PDFs are generated rather than committed as fixtures on
 * purpose: the seed's whole premise is that the policy text lives in
 * `dev.yaml` where a developer can edit it. A binary checked into
 * `seed-data/` would quietly become a second source of truth that nobody
 * could read a diff of.
 */

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { SeedDocument, SeedDocumentFormat } from "./seed-scenario";
import { canonicalFileNameFor, renderSeedDocument } from "./seed-scenario";

/**
 * The instant every generated file is stamped with.
 *
 * Seeding runs again on every `docker compose up`, and it only rewrites a
 * file whose bytes actually changed. Word files and PDFs both carry created
 * and modified timestamps, and a .docx is a ZIP whose every entry carries one
 * too — so with a live clock, identical prose produces different bytes every
 * run and each seed silently adds another update to every open change. This
 * is what keeps re-seeding a no-op.
 */
const SEED_INSTANT = new Date("2026-01-05T09:00:00Z");

/**
 * Run `render` with `Date` pinned to `SEED_INSTANT`.
 *
 * Only the Word file needs this. A .docx is a ZIP, and JSZip stamps every
 * entry with the time it was added — deep inside docx's packer, with no
 * option exposed to pass a date in. Nothing else runs during a render, and
 * the real `Date` is always put back.
 */
async function withSeedClock<T>(render: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const fixed = SEED_INSTANT.getTime();

  class SeedDate extends RealDate {
    // Only the no-argument form is frozen; every other way of building a date
    // is passed straight through. The cast is for the spread alone — `Date`
    // takes anywhere from one to seven arguments and TypeScript cannot spread
    // that union.
    constructor(...args: unknown[]) {
      super(...((args.length === 0 ? [fixed] : args) as [number]));
    }
    static override now(): number {
      return fixed;
    }
  }

  globalThis.Date = SeedDate as unknown as DateConstructor;
  try {
    return await render();
  } finally {
    globalThis.Date = RealDate;
  }
}

/** What to commit, and where. `content` is base64 — Gitea's contents API takes nothing else. */
export interface SeedDocumentFile {
  path: string;
  content: string;
}

/** The document as Markdown: an H1, H2 headings, and paragraphs. */
export function renderSeedMarkdown(document: SeedDocument): string {
  const lines: string[] = [`# ${document.title}`, ""];

  for (const section of document.sections) {
    if (section.heading) {
      lines.push(`## ${section.heading}`, "");
    }
    for (const paragraph of section.paragraphs) {
      lines.push(paragraph, "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * The document as a Word file.
 *
 * A real `.docx`, not a renamed anything: the app cannot preview one, and the
 * point of seeding it is to see the screens that say so honestly and hand the
 * reader both versions to open in Word.
 */
async function renderSeedDocx(document: SeedDocument): Promise<Uint8Array> {
  // No explicit bold on the headings: Word's own heading styles carry it,
  // and setting it again wraps every heading in a redundant run that comes
  // back out as `<h1><strong>…</strong></h1>` when the file is read.
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(document.title)],
    }),
  ];

  for (const section of document.sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(section.heading)],
        }),
      );
    }
    for (const paragraph of section.paragraphs) {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun(paragraph)],
        }),
      );
    }
  }

  // The created and modified dates in `docProps/core.xml` are not options —
  // docx writes them from the clock, which `withSeedClock` has already pinned.
  const file = new Document({
    title: document.title,
    creator: "Bindersnap seed",
    lastModifiedBy: "Bindersnap seed",
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(file));
}

/** Page geometry, in points. Letter paper with a one-inch margin. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const BODY_SIZE = 11;
const LINE_HEIGHT = 15;

/** Greedy wrap: the widest run of words that still fits the measure. */
function wrapLine(
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = word;
  }

  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * The document as a PDF with a real text layer.
 *
 * The text layer is the whole point: the comparison screen reads the words
 * back out with pdf.js, so a PDF of flat images would seed a document nothing
 * can be said about.
 */
async function renderSeedPdf(document: SeedDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const measure = PAGE_WIDTH - MARGIN * 2;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursor = PAGE_HEIGHT - MARGIN;

  const write = (text: string, size: number, font: typeof body) => {
    for (const line of wrapLine(text, font, size, measure)) {
      if (cursor < MARGIN) {
        page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        cursor = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, {
        x: MARGIN,
        y: cursor,
        size,
        font,
        color: rgb(0.11, 0.1, 0.09),
      });
      cursor -= size + 4;
    }
  };

  write(document.title, 18, bold);
  cursor -= 10;

  for (const section of document.sections) {
    if (section.heading) {
      cursor -= 8;
      write(section.heading, 13, bold);
      cursor -= 2;
    }
    for (const paragraph of section.paragraphs) {
      write(paragraph, BODY_SIZE, body);
      cursor -= LINE_HEIGHT - BODY_SIZE + 6;
    }
  }

  pdf.setTitle(document.title);
  pdf.setProducer("Bindersnap seed");
  pdf.setCreator("Bindersnap seed");
  pdf.setCreationDate(SEED_INSTANT);
  pdf.setModificationDate(SEED_INSTANT);

  return pdf.save();
}

/** The bytes for one version of a document, ready for the contents API. */
export async function renderSeedDocumentFile(
  document: SeedDocument,
  format: SeedDocumentFormat,
): Promise<SeedDocumentFile> {
  const path = canonicalFileNameFor(format);

  switch (format) {
    case "prosemirror":
      return {
        path,
        content: Buffer.from(renderSeedDocument(document), "utf8").toString(
          "base64",
        ),
      };
    case "markdown":
      return {
        path,
        content: Buffer.from(renderSeedMarkdown(document), "utf8").toString(
          "base64",
        ),
      };
    case "docx":
      return {
        path,
        content: Buffer.from(
          await withSeedClock(() => renderSeedDocx(document)),
        ).toString("base64"),
      };
    case "pdf":
      // No frozen clock here: pdf-lib takes the two dates it stamps as
      // arguments, so pinning them is enough to make the bytes reproducible.
      return {
        path,
        content: Buffer.from(await renderSeedPdf(document)).toString("base64"),
      };
  }
}
