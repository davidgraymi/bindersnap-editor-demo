/**
 * "1." and "2.1" for a list of heading levels in order, as the counters draw
 * them; null for a level that is not numbered. A subsection before any
 * section is "0.1", as Word's would be.
 *
 * Here rather than in the editor because an exported copy numbers its sections
 * the same way the page does, and the export is made on the server, which does
 * not load the editor.
 */
export function headingNumbers(levels: readonly number[]): (string | null)[] {
  let section = 0;
  let sub = 0;
  return levels.map((level) => {
    if (level === 2) {
      section += 1;
      sub = 0;
      return `${section}.`;
    }
    if (level === 3) {
      sub += 1;
      return `${section}.${sub}`;
    }
    return null;
  });
}
