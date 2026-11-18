import { describe, expect, test } from "bun:test";

import { ICON, SHARED_GLYPHS, type IconName } from "./icons";

/** Lucide's icons are forwardRef objects; their displayName is the glyph. */
const glyphName = (name: IconName) =>
  (ICON[name] as { displayName?: string }).displayName ?? name;

describe("the icon vocabulary", () => {
  test("every entry is a drawable glyph", () => {
    for (const [name, glyph] of Object.entries(ICON)) {
      expect(glyph, name).toBeTruthy();
      expect(typeof (glyph as { render?: unknown }).render, name).toBe(
        "function",
      );
    }
  });

  test("one idea per glyph, except the pairs that are one idea", () => {
    const allowed = new Set(
      SHARED_GLYPHS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
    );
    const byGlyph = new Map<unknown, IconName[]>();
    for (const name of Object.keys(ICON) as IconName[]) {
      const ideas = byGlyph.get(ICON[name]) ?? [];
      ideas.push(name);
      byGlyph.set(ICON[name], ideas);
    }
    const clashes: string[] = [];
    for (const ideas of byGlyph.values()) {
      for (let i = 0; i < ideas.length; i++) {
        for (let j = i + 1; j < ideas.length; j++) {
          if (!allowed.has(`${ideas[i]}|${ideas[j]}`)) {
            clashes.push(`${ideas[i]} and ${ideas[j]}`);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  test("each shared pair really does share its glyph", () => {
    for (const [a, b] of SHARED_GLYPHS) {
      expect(ICON[a], `${a} / ${b}`).toBe(ICON[b]);
    }
  });

  test("the lifecycle's three shapes are three different pictures", () => {
    const shapes = new Set([ICON.draft, ICON.changeRequest, ICON.onRecord]);
    expect(shapes.size).toBe(3);
  });

  test("no Git symbol stands for a draft, a change or a merge", () => {
    const git = (Object.keys(ICON) as IconName[]).filter((name) =>
      /^Git/.test(glyphName(name)),
    );
    expect(git).toEqual([]);
  });

  test("a verdict never borrows the tick or the close button", () => {
    for (const verdict of [
      "approved",
      "changesRequested",
      "published",
      "closed",
    ] as const) {
      expect(ICON[verdict]).not.toBe(ICON.selected);
      expect(ICON[verdict]).not.toBe(ICON.close);
    }
  });
});
