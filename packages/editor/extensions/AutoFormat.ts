import { Extension, textInputRule } from "@tiptap/core";

/**
 * Word's AutoFormat As You Type, for the few it does to every document.
 *
 * Curly quotes for straight ones, a dash for two hyphens, an ellipsis for
 * three dots, © ® ™ for (c) (r) (tm), and ½ ¼ ¾ for the fractions typed out.
 * People who write policies in Word are used to getting these without asking,
 * and a policy with straight quotes in it reads as one pasted from email.
 *
 * Backspace straight after one puts back what was typed, as Ctrl+Z does
 * after Word's. None of it happens in code, where a straight quote is a
 * quote the reader may need to copy.
 */

/** Before an opening quote: the start, a space, or an opening bracket. */
const OPENS = `(?:^|[\\s{[(<'"‘“—–-])`;

export const AUTO_FORMAT_RULES: readonly { find: RegExp; replace: string }[] = [
  { find: new RegExp(`${OPENS}(")$`), replace: "“" },
  { find: /"$/, replace: "”" },
  { find: new RegExp(`${OPENS}(')$`), replace: "‘" },
  { find: /'$/, replace: "’" },
  { find: /--$/, replace: "—" },
  { find: /\.\.\.$/, replace: "…" },
  { find: /\(c\)$/i, replace: "©" },
  { find: /\(r\)$/i, replace: "®" },
  { find: /\(tm\)$/i, replace: "™" },
  // Only a fraction standing alone: 11/2 is a date, not eleven and a half.
  { find: /(?:^|\s)(1\/2)\s$/, replace: "½" },
  { find: /(?:^|\s)(1\/4)\s$/, replace: "¼" },
  { find: /(?:^|\s)(3\/4)\s$/, replace: "¾" },
];

export const AutoFormat = Extension.create({
  name: "autoFormat",

  addInputRules() {
    return AUTO_FORMAT_RULES.map((rule) => textInputRule(rule));
  },
});
