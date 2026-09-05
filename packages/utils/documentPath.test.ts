import { expect, test } from "bun:test";

import {
  buildDocumentFilePath,
  buildDocumentSlugPath,
  buildDocumentVersionTag,
  documentSlugPathFromVersionTag,
  MAX_DOCUMENT_SLUG_LENGTH,
  MAX_FOLDER_DEPTH,
  normalizeFolderSegments,
  slugifyDocumentName,
  versionFromTag,
} from "./documentPath";

test("slugifyDocumentName turns a policy title into a path segment", () => {
  expect(slugifyDocumentName("Infection Control")).toBe("infection-control");
  expect(slugifyDocumentName("  Hand Hygiene (2026)  ")).toBe(
    "hand-hygiene-2026",
  );
  expect(slugifyDocumentName("Medication — Administration")).toBe(
    "medication-administration",
  );
});

test("slugifyDocumentName drops dots, unlike the organization rule", () => {
  // A dot in a segment reads as an extension, and the extension is what tells
  // us how to render the document.
  expect(slugifyDocumentName("policy.v2")).toBe("policy-v2");
  expect(slugifyDocumentName("_leading.and.trailing_")).toBe(
    "leading-and-trailing",
  );
});

test("slugifyDocumentName answers empty when there is nothing usable", () => {
  expect(slugifyDocumentName("!!!")).toBe("");
  expect(slugifyDocumentName("   ")).toBe("");
});

test("slugifyDocumentName bounds the length without leaving a trailing dash", () => {
  const slug = slugifyDocumentName("a".repeat(200));
  expect(slug).toHaveLength(MAX_DOCUMENT_SLUG_LENGTH);

  // Truncation can land on a separator, and a path segment ending in one is
  // ugly in every place it is ever shown.
  const cut = slugifyDocumentName(`${"a".repeat(MAX_DOCUMENT_SLUG_LENGTH)} b`);
  expect(cut.endsWith("-")).toBe(false);
});

test("normalizeFolderSegments cannot climb out of the workspace", () => {
  // A path that escapes the repository would write outside the binder whose
  // rules govern it, which is the one thing a folder must never do.
  expect(normalizeFolderSegments("../../etc")).toEqual(["etc"]);
  expect(normalizeFolderSegments("/absolute/path")).toEqual([
    "absolute",
    "path",
  ]);
  expect(normalizeFolderSegments("clinical//infection")).toEqual([
    "clinical",
    "infection",
  ]);
  expect(normalizeFolderSegments("..")).toEqual([]);
});

test("normalizeFolderSegments treats no folder as the workspace root", () => {
  expect(normalizeFolderSegments(null)).toEqual([]);
  expect(normalizeFolderSegments("")).toEqual([]);
});

test("normalizeFolderSegments bounds how deep folders nest", () => {
  const deep = Array.from({ length: 20 }, (_, i) => `f${i}`).join("/");
  expect(normalizeFolderSegments(deep)).toHaveLength(MAX_FOLDER_DEPTH);
});

test("buildDocumentSlugPath places the document in its folder", () => {
  expect(buildDocumentSlugPath("Infection Control")).toBe("infection-control");
  expect(buildDocumentSlugPath("Infection Control", "Clinical")).toBe(
    "clinical/infection-control",
  );
  expect(buildDocumentSlugPath("Handover", "Clinical/Nursing")).toBe(
    "clinical/nursing/handover",
  );
});

test("buildDocumentSlugPath answers empty when the name is unusable", () => {
  // The folder alone is not a document, so there is no path to offer.
  expect(buildDocumentSlugPath("!!!", "clinical")).toBe("");
});

test("buildDocumentFilePath carries the extension on the path itself", () => {
  expect(buildDocumentFilePath("Infection Control", "pdf")).toBe(
    "infection-control.pdf",
  );
  expect(buildDocumentFilePath("Infection Control", ".PDF", "Clinical")).toBe(
    "clinical/infection-control.pdf",
  );
});

test("buildDocumentFilePath tolerates a file with no extension", () => {
  expect(buildDocumentFilePath("Readme", "")).toBe("readme");
});

test("version tags carry the document, because tags are repository-global", () => {
  // Publishing one change that touched three documents writes three of these
  // onto the same commit.
  expect(buildDocumentVersionTag("clinical/infection-control", 4)).toBe(
    "clinical/infection-control/v4",
  );
  expect(buildDocumentVersionTag("handover", 2)).toBe("handover/v2");
});

test("a version tag reads back as its document and its number", () => {
  expect(documentSlugPathFromVersionTag("clinical/infection-control/v4")).toBe(
    "clinical/infection-control",
  );
  expect(versionFromTag("clinical/infection-control/v4")).toBe(4);
  expect(versionFromTag("handover/v12")).toBe(12);
});

test("a tag that is not ours reads back as nothing, rather than as v0", () => {
  // Repositories carry tags nobody here wrote, and mistaking one for a
  // published version would invent a version of a document that has none.
  expect(documentSlugPathFromVersionTag("v1")).toBeNull();
  expect(versionFromTag("v1")).toBeNull();
  expect(versionFromTag("release-2026")).toBeNull();
  expect(versionFromTag("infection-control/draft")).toBeNull();
});
