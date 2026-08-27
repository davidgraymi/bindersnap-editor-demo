import { expect, test } from "bun:test";

import {
  classifyDocumentFile,
  describeFileKind,
  fileExtension,
  formatFileSize,
} from "./documentFile";

test("fileExtension reads the last suffix, lower-cased", () => {
  expect(fileExtension("Q3 Report.DOCX")).toBe("docx");
  expect(fileExtension("archive.tar.gz")).toBe("gz");
  expect(fileExtension("README")).toBe("");
  expect(fileExtension(".gitignore")).toBe("");
  expect(fileExtension("trailing.")).toBe("");
});

test("classifyDocumentFile picks the renderer for each file type", () => {
  expect(classifyDocumentFile("policy.md")).toBe("markdown");
  expect(classifyDocumentFile("notes.txt")).toBe("text");
  expect(classifyDocumentFile("ledger.csv")).toBe("text");
  expect(classifyDocumentFile("contract.pdf")).toBe("pdf");
  expect(classifyDocumentFile("scan.PNG")).toBe("image");
  expect(classifyDocumentFile("contract.docx")).toBe("word");
  // A legacy .doc is a binary format no browser library reads.
  expect(classifyDocumentFile("contract.doc")).toBe("unsupported");
  expect(classifyDocumentFile(null)).toBe("unsupported");
});

test("classifyDocumentFile never renders SVG inline", () => {
  expect(classifyDocumentFile("diagram.svg")).toBe("unsupported");
});

test("describeFileKind names the common office formats", () => {
  expect(describeFileKind("contract.docx")).toBe("Word document");
  expect(describeFileKind("budget.xlsx")).toBe("Excel spreadsheet");
  expect(describeFileKind("deck.pptx")).toBe("PowerPoint deck");
  expect(describeFileKind("terms.pdf")).toBe("PDF");
  expect(describeFileKind("data.parquet")).toBe("PARQUET file");
  expect(describeFileKind("LICENSE")).toBe("File");
});

test("formatFileSize scales into readable units", () => {
  expect(formatFileSize(512)).toBe("512 B");
  expect(formatFileSize(2048)).toBe("2.0 KB");
  expect(formatFileSize(15 * 1024)).toBe("15 KB");
  expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  expect(formatFileSize(-1)).toBe("");
});
