import { describe, expect, test } from "bun:test";

import { describeBulkChange, nameFromFile, planBulkUpload } from "./bulkUpload";

const file = (name: string, size = 100) => ({ name, size });
const source = (relativePath: string, size = 100) => ({
  file: file(relativePath.split("/").pop()!, size),
  relativePath,
});

describe("nameFromFile", () => {
  test("drops the extension and separators and starts with a capital", () => {
    expect(nameFromFile("hand_hygiene-v3.docx")).toBe("Hand hygiene v3");
    expect(nameFromFile("PPE and gloves.pdf")).toBe("PPE and gloves");
  });
});

describe("planBulkUpload", () => {
  test("keeps a dropped folder's shape beneath the chosen folder", () => {
    const plan = planBulkUpload(
      [
        source("Policies/Nursing/Hand hygiene.docx"),
        source("Policies/Fire safety.pdf"),
      ],
      "Clinical",
    );
    expect(plan.items.map((item) => [item.folder, item.name])).toEqual([
      ["Clinical/Policies", "Fire safety"],
      ["Clinical/Policies/Nursing", "Hand hygiene"],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("leaves out system litter and anything that is not Word or PDF, and says so", () => {
    const plan = planBulkUpload(
      [
        source("Policies/.DS_Store"),
        source("Policies/~$nd hygiene.docx"),
        source("Policies/rota.xlsx"),
        source("Policies/empty.pdf", 0),
        source("Policies/huge.pdf", 30 * 1024 * 1024),
        source("Policies/Kept.docx"),
      ],
      "",
    );
    expect(plan.items.map((item) => item.name)).toEqual(["Kept"]);
    expect(plan.skipped.map((skip) => skip.reason).sort()).toEqual([
      "A system or temporary file",
      "A system or temporary file",
      "Larger than 25 MB",
      "Only Word documents and PDFs are added in bulk",
      "The file is empty",
    ]);
  });

  test("keeps only the first of two files that would share a name", () => {
    const plan = planBulkUpload(
      [source("Policy.docx"), source("Policy.pdf")],
      "",
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.skipped[0]!.reason).toBe("Another file here has the same name");
  });
});

describe("describeBulkChange", () => {
  test("names the change by what it adds", () => {
    expect(
      describeBulkChange([
        { name: "Fire safety", folder: "" },
        { name: "Hand hygiene", folder: "Nursing/Wards" },
      ]),
    ).toEqual({
      title: "Add 2 documents",
      body: "- Fire safety\n- Hand hygiene (Nursing › Wards)",
    });
    expect(
      describeBulkChange([{ name: "Fire safety", folder: "" }]).title,
    ).toBe("Add Fire safety");
  });
});
