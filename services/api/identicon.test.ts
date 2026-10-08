import { describe, expect, test } from "bun:test";

import { identiconSvg } from "./identicon";

describe("identiconSvg", () => {
  test("one login draws one face, whatever its case", () => {
    expect(identiconSvg("JKim")).toBe(identiconSvg("jkim"));
  });

  test("two logins draw different faces", () => {
    expect(identiconSvg("jkim")).not.toBe(identiconSvg("alice"));
  });

  test("the grid is mirrored left to right", () => {
    const squares = [
      ...identiconSvg("carol").matchAll(/<rect x="(\d)" y="(\d)" width="1"/g),
    ].map((match) => `${match[1]},${match[2]}`);
    for (const square of squares) {
      const [x, y] = square.split(",").map(Number);
      expect(squares).toContain(`${4 - x!},${y}`);
    }
  });

  test("it is drawn at the size asked for, and from nothing but the login", () => {
    const svg = identiconSvg("dan", 48);
    expect(svg).toStartWith(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"',
    );
    expect(svg).not.toContain("gravatar");
  });
});
