import { beforeEach, describe, expect, test } from "bun:test";

import {
  dropWords,
  keepWords,
  readWords,
  recoveryKey,
  worthOffering,
} from "./editorRecovery";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("AutoRecover", () => {
  const key = recoveryKey("acme", "hr", "draft/ann/1", "leave/annual");

  beforeEach(() => window.localStorage.clear());

  test("unsaved words are kept per policy and per draft", () => {
    keepWords(key, doc("Typed"), JSON.stringify(doc("Saved")));
    expect(readWords(key)?.doc).toEqual(doc("Typed"));
    expect(
      readWords(recoveryKey("acme", "hr", "draft/ann/2", "leave/annual")),
    ).toBeNull();
  });

  test("offered only when they say something the saved version does not", () => {
    keepWords(key, doc("Typed"), "");
    expect(worthOffering(readWords(key), JSON.stringify(doc("Typed")))).toBe(
      false,
    );
    expect(worthOffering(readWords(key), JSON.stringify(doc("Saved")))).toBe(
      true,
    );
  });

  test("dropped once saved or thrown away, and a bad entry reads as nothing", () => {
    keepWords(key, doc("Typed"), "");
    dropWords(key);
    expect(readWords(key)).toBeNull();
    window.localStorage.setItem(key, "{not json");
    expect(readWords(key)).toBeNull();
  });
});
