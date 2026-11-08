/**
 * How wide the editor's file panel is drawn, when someone has dragged its
 * edge: remembered per browser, as an IDE remembers its sidebar.
 */

export const FILES_WIDTH_KEY = "bindersnap.editor.files.width";

/** As wide as it is drawn until someone drags it. */
export const FILES_WIDTH_DEFAULT = 248;
/** Narrower than this, a folder's name and its row actions do not fit. */
export const FILES_WIDTH_MIN = 180;
/** Wider than this, the panel takes the room the page is read in. */
export const FILES_WIDTH_MAX = 520;
/** One press of an arrow key on the handle. */
export const FILES_WIDTH_STEP = 16;

export function clampFilesWidth(width: number): number {
  if (!Number.isFinite(width)) return FILES_WIDTH_DEFAULT;
  return Math.round(
    Math.min(FILES_WIDTH_MAX, Math.max(FILES_WIDTH_MIN, width)),
  );
}

/** The width remembered in this browser, or the default when there is none. */
export function readFilesWidth(): number {
  try {
    const stored = window.localStorage.getItem(FILES_WIDTH_KEY);
    if (stored === null) return FILES_WIDTH_DEFAULT;
    return clampFilesWidth(Number(stored));
  } catch {
    return FILES_WIDTH_DEFAULT;
  }
}

export function writeFilesWidth(width: number): void {
  try {
    if (width === FILES_WIDTH_DEFAULT) {
      window.localStorage.removeItem(FILES_WIDTH_KEY);
    } else {
      window.localStorage.setItem(FILES_WIDTH_KEY, String(width));
    }
  } catch {
    // A private window, or storage blocked: the width lasts the visit.
  }
}

/**
 * What a key on the handle does to the width, or `null` for a key it leaves
 * alone: the arrows step it, Home and End take it to either end.
 */
export function keyedFilesWidth(key: string, width: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampFilesWidth(width - FILES_WIDTH_STEP);
    case "ArrowRight":
      return clampFilesWidth(width + FILES_WIDTH_STEP);
    case "Home":
      return FILES_WIDTH_MIN;
    case "End":
      return FILES_WIDTH_MAX;
    default:
      return null;
  }
}
