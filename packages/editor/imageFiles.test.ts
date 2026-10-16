import { describe, expect, test } from "bun:test";

import {
  MAX_EDGE_PX,
  PictureError,
  dataUrlBytes,
  describeFromFileName,
  fitWithin,
  isPictureFile,
  pictureToDataUrl,
  pictureWidth,
} from "./imageFiles";
import { draggedWidth, MIN_PICTURE_WIDTH } from "./extensions/PictureSize";

describe("pictures from the author's computer", () => {
  test("a photo is scaled so its long edge fits, keeping its shape", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE_PX, height: 1200 });
    expect(fitWithin(1000, 3200)).toEqual({ width: 500, height: MAX_EDGE_PX });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  test("a file name is a start on a description", () => {
    expect(describeFromFileName("Site_Map-2024.png")).toBe("Site Map 2024");
    expect(describeFromFileName("C:\\\\pics\\\\logo.jpeg")).toBe("logo");
  });

  test("a data address's size is its decoded bytes", () => {
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/png;base64,AAA=")).toBe(2);
  });

  test("only raster pictures are taken; SVG can carry script", async () => {
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    expect(isPictureFile(svg)).toBe(false);
    expect(isPictureFile(new File(["x"], "a.png", { type: "image/png" }))).toBe(
      true,
    );
    await expect(pictureToDataUrl(svg)).rejects.toBeInstanceOf(PictureError);
  });
});

describe("a picture's size", () => {
  test("a stored width is whole pixels, or nothing", () => {
    expect(pictureWidth(312)).toBe(312);
    expect(pictureWidth("312")).toBe(312);
    expect(pictureWidth("312.6px")).toBe(313);
    expect(pictureWidth("50%")).toBeNull();
    expect(pictureWidth(null)).toBeNull();
    expect(pictureWidth(0)).toBeNull();
    expect(pictureWidth("wide")).toBeNull();
  });

  test("a corner drag is measured on the page, whatever the zoom", () => {
    const drag = { startWidth: 300, fromLeft: false, maxWidth: 624 };
    expect(draggedWidth({ ...drag, deltaX: 50, scale: 1 })).toBe(350);
    // At 50% zoom, 50 pixels on screen is 100 on the page.
    expect(draggedWidth({ ...drag, deltaX: 50, scale: 0.5 })).toBe(400);
    // A left-hand corner grows the picture as it moves left.
    expect(
      draggedWidth({ ...drag, fromLeft: true, deltaX: -40, scale: 1 }),
    ).toBe(340);
  });

  test("a picture is never dragged past the text, or down to nothing", () => {
    const drag = { startWidth: 300, fromLeft: false, scale: 1, maxWidth: 624 };
    expect(draggedWidth({ ...drag, deltaX: 900 })).toBe(624);
    expect(draggedWidth({ ...drag, deltaX: -900 })).toBe(MIN_PICTURE_WIDTH);
  });
});
