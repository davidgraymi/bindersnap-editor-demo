/**
 * The text of a fragment of HTML, with its tags taken out: what a heading
 * reads as in a table of contents or an anchor.
 *
 * A scan rather than `replace(/<[^>]*>/g, "")`, because one pass of that can
 * leave a tag behind (`<<b>script>` becomes `<script>`). Everything from a `<`
 * to its `>` is dropped, and so is a `<` that never closes, so no `<` survives.
 * Entities are left as they are; the caller's HTML already escaped its text.
 */
export function stripTags(html: string): string {
  let text = "";
  let inTag = false;
  for (const char of html) {
    if (inTag) {
      if (char === ">") inTag = false;
    } else if (char === "<") {
      inTag = true;
    } else if (char !== ">") {
      text += char;
    }
  }
  return text;
}
