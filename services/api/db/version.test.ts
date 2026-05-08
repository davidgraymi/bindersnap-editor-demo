import { describe, expect, test } from "bun:test";
import { EXPECTED_SCHEMA_VERSION, SchemaVersionMismatchError } from "./version";

describe("schema version", () => {
  test("EXPECTED_SCHEMA_VERSION is non-empty", () => {
    expect(EXPECTED_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  test("mismatch error names both expected and actual", () => {
    const err = new SchemaVersionMismatchError("0001_x", "0000_y");
    expect(err.message).toContain("0001_x");
    expect(err.message).toContain("0000_y");
    expect(err.name).toBe("SchemaVersionMismatchError");
  });

  test("missing-row mismatch tells the operator to run the migration runner", () => {
    const err = new SchemaVersionMismatchError("0001_x", null);
    expect(err.message).toContain(
      "Run the migration runner before starting the API",
    );
    expect(err.message).toContain("0001_x");
  });
});
