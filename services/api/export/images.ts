/**
 * A picture's own size and kind, read from its first bytes.
 *
 * Both writers need it: Word will not place a picture without a size, and a
 * PDF has to know how tall the picture is before it can decide whether it
 * fits on the page. PNG and JPEG are what the editor embeds (`imageFiles.ts`
 * turns everything else into one of them), and GIF costs four lines.
 */

export type PictureKind = "png" | "jpg" | "gif";

export interface PictureInfo {
  kind: PictureKind;
  width: number;
  height: number;
}

export function readPicture(data: Uint8Array): PictureInfo | null {
  if (data.length < 24) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // PNG: signature, then the IHDR chunk's width and height.
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return {
      kind: "png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }

  // GIF: "GIF8", then little-endian width and height.
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return {
      kind: "gif",
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
    };
  }

  // JPEG: walk the segments to the frame header.
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1]!;
      const length = view.getUint16(offset + 2);
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        return {
          kind: "jpg",
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return null;
}

/**
 * How big to draw it, in points, inside `maxWidth`.
 *
 * The author's width is pixels at 100% zoom, which the page draws at 96 to the
 * inch; a point is a seventy-second of one.
 */
export function pictureSize(
  info: Pick<PictureInfo, "width" | "height">,
  authorWidthPx: number | null,
  maxWidthPt: number,
): { width: number; height: number } {
  const widthPx = authorWidthPx ?? info.width;
  let width = (widthPx * 72) / 96;
  if (width > maxWidthPt) width = maxWidthPt;
  const height = info.width > 0 ? (width * info.height) / info.width : width;
  return { width, height };
}
