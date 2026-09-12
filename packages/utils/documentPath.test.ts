import { expect, test } from "bun:test";

import {
  buildDocumentDisplayPath,
  buildDocumentFilePath,
  buildDocumentSlugPath,
  buildDocumentVersionTag,
  documentUidFromVersionTag,
  MAX_DOCUMENT_SLUG_LENGTH,
  MAX_FOLDER_DEPTH,
  normalizeFolderSegments,
  parseDocumentFilename,
  slugifyDocumentName,
  versionFromTag,
} from "./documentPath";

/** A real one, so the tests exercise the same validation the product does. */
const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const OTHER_UID = "01J9A0B1C2D3E4F5G6H7J8K9M0";

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

test("buildDocumentFilePath puts the identity between the name and the extension", () => {
  expect(buildDocumentFilePath("Infection Control", "pdf", UID)).toBe(
    `infection-control.${UID}.pdf`,
  );
  expect(
    buildDocumentFilePath("Infection Control", ".PDF", UID, "Clinical"),
  ).toBe(`clinical/infection-control.${UID}.pdf`);
});

test("buildDocumentFilePath tolerates a file with no extension", () => {
  expect(buildDocumentFilePath("Readme", "", UID)).toBe(`readme.${UID}`);
});

test("the address a person is shown carries no identity", () => {
  // The app promises where the document is going before the server has minted
  // anything, and a 26-character blob is not a confirmation anybody can read.
  expect(buildDocumentDisplayPath("Infection Control", "pdf", "Clinical")).toBe(
    "clinical/infection-control.pdf",
  );
  expect(buildDocumentDisplayPath("Readme", "")).toBe("readme");
});

test("a filename reads back as its name, its identity and its extension", () => {
  expect(parseDocumentFilename(`hand-hygiene.${UID}.md`)).toEqual({
    name: "hand-hygiene",
    uid: UID,
    extension: "md",
  });
  expect(parseDocumentFilename(`hand-hygiene.${UID}`)).toEqual({
    name: "hand-hygiene",
    uid: UID,
    extension: "",
  });
});

test("renaming the human half leaves the identity alone", () => {
  // The whole point of ADR 0005, as one assertion: the version series is keyed
  // on what survives a retitle.
  const before = parseDocumentFilename(`hand-hygiene.${UID}.md`);
  const after = parseDocumentFilename(`hand-hygiene-and-ppe.${UID}.md`);

  expect(after.name).not.toBe(before.name);
  expect(after.uid).toBe(before.uid);
  expect(buildDocumentVersionTag(after.uid!, 4)).toBe(
    buildDocumentVersionTag(before.uid!, 4),
  );
});

test("a file this product did not write parses with no identity", () => {
  // Described rather than thrown over: it is one blob in a tree that has to be
  // listed. Refusing it is the publish guard's job, once.
  expect(parseDocumentFilename("README.md")).toEqual({
    name: "README",
    uid: null,
    extension: "md",
  });
  expect(parseDocumentFilename("LICENSE")).toEqual({
    name: "LICENSE",
    uid: null,
    extension: "",
  });
  // A leading dot is part of the name, not an extension with no name.
  expect(parseDocumentFilename(".gitignore")).toEqual({
    name: ".gitignore",
    uid: null,
    extension: "",
  });
});

test("the identity is the last matching segment, not the first", () => {
  // Somebody may legitimately name a policy after a UID. What was minted for
  // the document is what was written last.
  expect(parseDocumentFilename(`${OTHER_UID}.${UID}.md`)).toEqual({
    name: OTHER_UID,
    uid: UID,
    extension: "md",
  });
});

test("version tags carry the identity, because tags are repository-global", () => {
  // Publishing one change that touched three documents writes three of these
  // onto the same commit.
  expect(buildDocumentVersionTag(UID, 4)).toBe(`${UID}/v4`);
  expect(buildDocumentVersionTag(OTHER_UID, 2)).toBe(`${OTHER_UID}/v2`);
});

test("a version tag reads back as its document and its number", () => {
  expect(documentUidFromVersionTag(`${UID}/v4`)).toBe(UID);
  expect(versionFromTag(`${UID}/v4`)).toBe(4);
  expect(versionFromTag(`${UID}/v12`)).toBe(12);
});

test("a tag that is not ours reads back as nothing, rather than as v0", () => {
  // Repositories carry tags nobody here wrote, and mistaking one for a
  // published version would invent a version of a document that has none.
  for (const notOurs of [
    "v1",
    "release-2026",
    `${UID}/draft`,
    // The shape ADR 0004 used. It is not a version of anything now, and
    // counting it as one would number a document after a path.
    "clinical/infection-control/v4",
    // A path-shaped tag whose last segment happens to validate.
    `clinical/${UID}/v4`,
  ]) {
    expect(documentUidFromVersionTag(notOurs)).toBeNull();
    expect(versionFromTag(notOurs)).toBeNull();
  }
});
