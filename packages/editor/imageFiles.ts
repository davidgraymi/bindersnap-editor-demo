/**
 * A picture from the author's computer, made fit to live inside a policy.
 *
 * **Embedded, not linked.** A policy is evidence: the version approved in
 * March has to read the same in five years, and a picture linked from a web
 * address can change or vanish under it. So a picture chosen, pasted or
 * dropped is written into the document itself, as a `data:` address, and is
 * versioned with the words around it in the same commit.
 *
 * That makes size the author's business, so it is handled here rather than
 * left to them: a photo off a phone is scaled to at most
 * {@link MAX_EDGE_PX} on its long edge — wider than a printed page needs —
 * and one still too large after that is refused with a reason, not stored.
 */

/** The kinds a browser draws everywhere. SVG is left out: it can carry script. */
export const PICTURE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** Long edge, in pixels: a Letter page's text width at 200 dpi is ~1300. */
export const MAX_EDGE_PX = 1600;

/** The most one picture may add to a document, once scaled. */
export const MAX_PICTURE_BYTES = 1_500_000;

/**
 * A picture's stored width as whole pixels, or null for its own size. Pasted
 * HTML brings widths as strings, and some as percentages, which are not kept.
 */
export function pictureWidth(value: unknown): number | null {
  if (typeof value === "string" && !/^\s*\d+(\.\d+)?\s*(px)?\s*$/.test(value)) {
    return null;
  }
  const px =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(px) && px > 0 ? Math.round(px) : null;
}

export class PictureError extends Error {}

export function isPictureFile(file: File): boolean {
  return (PICTURE_TYPES as readonly string[]).includes(file.type);
}

/** `Site_Map-2024.png` → `Site Map 2024`, a start on a description. */
export function describeFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How big a `data:` address's bytes are, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/** The size to draw at: the same, or scaled so the long edge fits. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new PictureError("That picture could not be read."));
    reader.readAsDataURL(blob);
  });
}

/**
 * The picture as a `data:` address, scaled if it needed to be.
 *
 * A GIF is kept as it is, since redrawing it would stop it moving. Anything
 * else already small enough is kept byte for byte. Otherwise it is redrawn
 * and tried, smallest-loss first, until one fits: a PNG as a PNG (a diagram's
 * edges stay sharp), then as a JPEG on white, then a JPEG a size smaller. A
 * full-screen screenshot off a laptop lands on the second.
 */
export async function pictureToDataUrl(file: File): Promise<string> {
  if (!isPictureFile(file)) {
    throw new PictureError(
      "Only PNG, JPEG, GIF and WebP pictures can go in a document.",
    );
  }
  const tooLarge = () =>
    new PictureError(
      "That picture is too large to put in a document, even scaled down. Try a smaller one.",
    );

  if (file.type === "image/gif" || typeof createImageBitmap !== "function") {
    const url = await readAsDataUrl(file);
    if (dataUrlBytes(url) > MAX_PICTURE_BYTES) throw tooLarge();
    return url;
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new PictureError("That picture could not be read.");
  });
  try {
    const fits = fitWithin(bitmap.width, bitmap.height);
    if (fits.width === bitmap.width && file.size <= MAX_PICTURE_BYTES) {
      return await readAsDataUrl(file);
    }

    const attempts: Array<{ edge: number; type: "image/png" | "image/jpeg" }> =
      [
        ...(file.type === "image/png"
          ? [{ edge: MAX_EDGE_PX, type: "image/png" as const }]
          : []),
        { edge: MAX_EDGE_PX, type: "image/jpeg" },
        { edge: 1200, type: "image/jpeg" },
      ];
    for (const attempt of attempts) {
      const size = fitWithin(bitmap.width, bitmap.height, attempt.edge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new PictureError("That picture could not be read.");
      if (attempt.type === "image/jpeg") {
        // JPEG has no transparency; what was see-through prints as paper.
        context.fillStyle = "white";
        context.fillRect(0, 0, size.width, size.height);
      }
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const url =
        attempt.type === "image/png"
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", 0.85);
      if (dataUrlBytes(url) <= MAX_PICTURE_BYTES) return url;
    }
    throw tooLarge();
  } finally {
    bitmap.close();
  }
}
