import { useCallback, useEffect, useState } from "react";

/**
 * Which folders a person has shut in this binder, remembered between visits.
 *
 * **Shut, not open.** Storing the collapsed set rather than the expanded one
 * is what keeps "open by default" true: a folder made after somebody last
 * looked is absent from the set, so it opens. Storing the open set would have
 * every new folder arrive shut, which is the opposite of what a binder should
 * do with something just added to it.
 *
 * Per binder, because shutting the departments you do not work in is a
 * statement about that binder and nothing else.
 *
 * Local to the browser on purpose. This is a view preference — it changes
 * nothing about the record, it is worthless to anybody else, and putting it on
 * the server would mean a write to the binder every time somebody clicked a
 * triangle. Storage that is unavailable or full costs the memory of the
 * preference and nothing more.
 */

function storageKey(org: string, binder: string): string {
  return `bindersnap.tree.collapsed.${org}/${binder}`;
}

function read(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    // Private browsing, a disabled store, or something else's key at ours.
    // A forgotten preference is not worth a broken binder.
    return new Set();
  }
}

export function useCollapsedFolders(
  org: string,
  binder: string,
): {
  collapsed: Set<string>;
  toggle: (path: string) => void;
  reveal: (paths: readonly string[]) => void;
} {
  const key = storageKey(org, binder);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => read(key));

  // Re-read when the binder changes: this hook outlives a navigation between
  // two binders, and carrying one binder's shut folders into another would
  // hide folders nobody has ever shut.
  useEffect(() => {
    setCollapsed(read(key));
  }, [key]);

  const toggle = useCallback(
    (path: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return write(key, next);
      });
    },
    [key],
  );

  /** Open these folders, whatever their state — used to show something. */
  const reveal = useCallback(
    (paths: readonly string[]) => {
      setCollapsed((current) => {
        if (!paths.some((path) => current.has(path))) return current;
        const next = new Set(current);
        for (const path of paths) next.delete(path);
        return write(key, next);
      });
    },
    [key],
  );

  return { collapsed, toggle, reveal };
}

/** Persist and hand back, so the updater is a one-liner at both call sites. */
function write(key: string, next: Set<string>): Set<string> {
  try {
    window.localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // Out of quota or no store. The preference holds for this visit.
  }
  return next;
}
