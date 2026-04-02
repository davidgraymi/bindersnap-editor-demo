import { describe, expect, test } from "bun:test";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  validateUploadFile,
} from "./uploads";

// ────────────────────────────────────────────────────────────────
// validateUploadFile tests
// ────────────────────────────────────────────────────────────────

test("validateUploadFile accepts pdf", () => {
  const file = new File(["content"], "test.pdf", { type: "application/pdf" });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts docx", () => {
  const file = new File(["content"], "test.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts xlsx", () => {
  const file = new File(["content"], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts any extension — txt", () => {
  const file = new File(["content"], "notes.txt", { type: "text/plain" });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts any extension — zip", () => {
  const file = new File(["content"], "archive.zip", {
    type: "application/zip",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts files without extensions", () => {
  const file = new File(["content"], "Makefile", {
    type: "application/octet-stream",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile rejects files over 25 MiB", () => {
  const largeContent = new Uint8Array(26 * 1024 * 1024);
  const file = new File([largeContent], "large.pdf", {
    type: "application/pdf",
  });
  const result = validateUploadFile(file);
  expect(result.valid).toBe(false);
  expect(result.reason).toContain("File is too large");
  expect(result.reason).toContain("MiB");
});

test("validateUploadFile accepts files exactly at 25 MiB limit", () => {
  const largeContent = new Uint8Array(25 * 1024 * 1024);
  const file = new File([largeContent], "at-limit.pdf", {
    type: "application/pdf",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

// ────────────────────────────────────────────────────────────────
// buildUploadBranchName tests
// ────────────────────────────────────────────────────────────────

test("buildUploadBranchName produces correct format", () => {
  const now = new Date("2026-04-02T14:35:22Z");
  const branchName = buildUploadBranchName(
    "quarterly-report",
    "alice",
    "abc12345",
    now,
  );

  expect(branchName).toBe(
    "upload/quarterly-report/20260402/143522Z-alice-abc12345",
  );
});

test("buildUploadBranchName uses UTC time", () => {
  // Test with a date that has different local and UTC times
  const now = new Date("2026-12-31T23:59:59Z");
  const branchName = buildUploadBranchName("doc", "user", "hash1234", now);

  expect(branchName).toBe("upload/doc/20261231/235959Z-user-hash1234");
});

test("buildUploadBranchName pads single-digit months and days", () => {
  const now = new Date("2026-01-05T08:09:07Z");
  const branchName = buildUploadBranchName("test-doc", "bob", "12345678", now);

  expect(branchName).toBe("upload/test-doc/20260105/080907Z-bob-12345678");
});

test("buildUploadBranchName handles different doc slugs", () => {
  const now = new Date("2026-04-02T12:00:00Z");
  const branchName = buildUploadBranchName(
    "policy-handbook-v2",
    "charlie",
    "abcdef12",
    now,
  );

  expect(branchName).toBe(
    "upload/policy-handbook-v2/20260402/120000Z-charlie-abcdef12",
  );
});

// ────────────────────────────────────────────────────────────────
// buildUploadCommitMessage tests
// ────────────────────────────────────────────────────────────────

test("buildUploadCommitMessage includes all required trailers", () => {
  const message = buildUploadCommitMessage({
    docSlug: "quarterly-report",
    canonicalFile: "quarterly-report.pdf",
    sourceFilename: "Q2_Report_Final.pdf",
    uploadBranch: "upload/quarterly-report/20260402/143522Z-alice-abc12345",
    uploaderSlug: "alice",
    fileHashSha256: "abc123def456789",
  });

  expect(message).toContain("Bindersnap-Document-Id: quarterly-report");
  expect(message).toContain("Bindersnap-Canonical-File: quarterly-report.pdf");
  expect(message).toContain("Bindersnap-Source-Filename: Q2_Report_Final.pdf");
  expect(message).toContain(
    "Bindersnap-Upload-Branch: upload/quarterly-report/20260402/143522Z-alice-abc12345",
  );
  expect(message).toContain("Bindersnap-Uploaded-By: alice");
  expect(message).toContain("Bindersnap-File-Hash-SHA256: abc123def456789");
});

test("buildUploadCommitMessage format", () => {
  const message = buildUploadCommitMessage({
    docSlug: "test-doc",
    canonicalFile: "test-doc.docx",
    sourceFilename: "original.docx",
    uploadBranch: "upload/test-doc/20260402/120000Z-user-12345678",
    uploaderSlug: "user",
    fileHashSha256: "hash123",
  });

  const lines = message.split("\n");

  // First line is the summary
  expect(lines[0]).toBe("Upload: original.docx");

  // Second line is blank
  expect(lines[1]).toBe("");

  // Remaining lines are trailers
  expect(lines[2]).toMatch(/^Bindersnap-/);
});

test("buildUploadCommitMessage handles special characters in filenames", () => {
  const message = buildUploadCommitMessage({
    docSlug: "doc-with-dashes",
    canonicalFile: "doc-with-dashes.pdf",
    sourceFilename: "File (with) [special] chars & stuff.pdf",
    uploadBranch: "upload/doc-with-dashes/20260402/120000Z-user-12345678",
    uploaderSlug: "user-name",
    fileHashSha256: "abc123",
  });

  expect(message).toContain("Upload: File (with) [special] chars & stuff.pdf");
  expect(message).toContain(
    "Bindersnap-Source-Filename: File (with) [special] chars & stuff.pdf",
  );
});
