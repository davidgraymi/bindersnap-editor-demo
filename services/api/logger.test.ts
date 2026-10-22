import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { logger, withLogContext } from "./logger";

describe("log context", () => {
  const write = spyOn(process.stdout, "write").mockImplementation(() => true);
  const lines = () =>
    write.mock.calls.map(
      ([chunk]) => JSON.parse(String(chunk)) as Record<string, unknown>,
    );

  afterEach(() => write.mockClear());

  test("every line logged inside carries the context's fields", async () => {
    await withLogContext({ requestId: "req-1" }, async () => {
      logger.warn("before");
      await Promise.resolve();
      logger.warn("after an await", { status: 500 });
    });
    logger.warn("outside");

    expect(lines().map((line) => line.requestId)).toEqual([
      "req-1",
      "req-1",
      undefined,
    ]);
    expect(lines()[1]!.status).toBe(500);
  });

  test("a line's own fields win over the context's", () => {
    withLogContext({ requestId: "req-1" }, () =>
      logger.warn("explicit", { requestId: "other" }),
    );
    expect(lines()[0]!.requestId).toBe("other");
  });
});
