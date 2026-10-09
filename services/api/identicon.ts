import { createHash } from "node:crypto";

/**
 * A face for a login: a mirrored five-by-five grid of squares in one colour,
 * as an SVG.
 *
 * Drawn from a hash of the login alone, so it needs nothing looked up and
 * says nothing about the person but the login every viewer already sees.
 * Mirrored left to right because a symmetric pattern reads as a face rather
 * than as noise, which is why Gravatar and GitHub draw theirs that way.
 */
export function identiconSvg(login: string, size = 80): string {
  const digest = createHash("sha256")
    .update(`bindersnap:${login.trim().toLowerCase()}`)
    .digest();

  // Fifteen cells decide the grid: three columns, mirrored onto five.
  const cells: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const bit = row * 3 + column;
      if ((digest[bit >> 3]! >> (bit & 7)) & 1) {
        cells.push(square(column, row));
        if (column < 2) cells.push(square(4 - column, row));
      }
    }
  }

  const hue = ((digest[2]! << 8) | digest[3]!) % 360;
  const saturation = 45 + (digest[4]! % 20);
  const lightness = 45 + (digest[5]! % 12);
  const fill = `hsl(${hue} ${saturation}% ${lightness}%)`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-0.5 -0.5 6 6" shape-rendering="crispEdges"><rect x="-0.5" y="-0.5" width="6" height="6" fill="#f0f0f0"/><g fill="${fill}">${cells.join("")}</g></svg>`;
}

function square(x: number, y: number): string {
  return `<rect x="${x}" y="${y}" width="1" height="1"/>`;
}
