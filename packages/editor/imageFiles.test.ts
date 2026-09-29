import { describe, expect, test } from "bun:test";

import {
  MAX_EDGE_PX,
  PictureError,
  dataUrlBytes,
  describeFromFileName,
  fitWithin,
  isPictureFile,
  pictureToDataUrl,
} from "./imageFiles";

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
