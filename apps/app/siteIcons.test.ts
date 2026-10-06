import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a browser tab, a home screen and a link pasted into a text or a post
 * show for bindersnap.com. The images come from scripts/brand-images.ts.
 */

const PUBLIC_DIR = join(import.meta.dir, "public");
const html = readFileSync(join(import.meta.dir, "index.html"), "utf8");

const meta = (property: string) =>
  new RegExp(
    `<meta\\s+(?:property|name)="${property}"\\s+content="([^"]*)"`,
  ).exec(html)?.[1];

/** Width and height from a PNG's IHDR chunk. */
function pngSize(name: string): [number, number] {
  const data = readFileSync(join(PUBLIC_DIR, name));
  expect(data.subarray(1, 4).toString()).toBe("PNG");
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

describe("the site's icons and link preview", () => {
  test("every icon the page links is there to bundle", () => {
    const hrefs = [
      ...html.matchAll(
        /<link\s+rel="(?:icon|apple-touch-icon|manifest)"\s+href="([^"]+)"/g,
      ),
    ].map((match) => match[1]!);
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const href of hrefs) {
      expect(href).toStartWith("./public/");
      expect(existsSync(join(import.meta.dir, href)), href).toBe(true);
    }
  });

  test("a shared link unfurls into the large card, at an absolute URL", () => {
    expect(meta("og:title")).toStartWith("Bindersnap");
    expect(meta("og:description")).toBeTruthy();
    expect(meta("og:url")).toBe("https://bindersnap.com/");
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(meta("og:image:alt")).toBeTruthy();

    const image = new URL(meta("og:image")!);
    expect(image.origin).toBe("https://bindersnap.com");
    expect(pngSize(image.pathname.slice(1))).toEqual([
      Number(meta("og:image:width")),
      Number(meta("og:image:height")),
    ]);
  });

  test("the manifest's icons exist at the sizes it claims", () => {
    const manifest = JSON.parse(
      readFileSync(join(PUBLIC_DIR, "site.webmanifest"), "utf8"),
    ) as { icons: { src: string; sizes: string }[] };
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src.slice(1))).toEqual([width!, height!]);
    }
  });

  test("iOS gets a 180px icon with no transparency to turn black", () => {
    const data = readFileSync(join(PUBLIC_DIR, "apple-touch-icon.png"));
    expect(pngSize("apple-touch-icon.png")).toEqual([180, 180]);
    // IHDR colour type 2 is RGB: no alpha channel.
    expect(data[25]).toBe(2);
  });
});
