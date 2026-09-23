import { useCallback, useEffect, useState } from "react";

import { foldersHolding } from "./binderTree";

/**
 * Which folders are open in this binder, remembered between visits.
 *
 * **Shut by default, and the one you are in is open.** This used to store the
 * shut set and open everything else, which made a binder of forty policies in
 * eight departments arrive as a wall of every policy in it — the customer:
 * *"Folders should be collapsed by default unless you are currently viewing a
 * document in a folder path in which case those folders should be expanded."*
 * A file explorer shut is a filing cabinet with the drawers closed, which is
 * what a filing cabinet looks like; a reader opens the drawer they want.
 *
 * What keeps that from being useless is the second half. Landing on a policy
 * three levels down with every folder shut shows a tree that does not contain
 * the thing on screen, so the folders holding it are opened — persisted, so
 * they are still open when the reader comes back, and shuttable like any
 * other, because an automatic open that cannot be undone is a folder that
 * will not close.
 *
 * Per binder, because opening the departments you work in is a statement about
 * that binder and nothing else.
 *
 * Local to the browser on purpose. This is a view preference — it changes
 * nothing about the record, it is worthless to anybody else, and putting it on
 * the server would mean a write to the binder every time somebody clicked a
 * triangle. Storage that is unavailable or full costs the memory of the
 * preference and nothing more.
 */

function storageKey(org: string, binder: string): string {
  // A new key rather than the old `…tree.collapsed…` one. The sets are
  // complements of each other, so reading the old value here would open
  // precisely the folders somebody had shut.
  return `bindersnap.tree.open.${org}/${binder}`;
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

export function useOpenFolders(
  org: string,
  binder: string,
  /** The document on screen, whose folders are open whatever was shut. */
  activeDocument: string | null = null,
): {
  isOpen: (path: string) => boolean;
  toggle: (path: string) => void;
  open: (paths: readonly string[]) => void;
} {
  const key = storageKey(org, binder);
  const [opened, setOpened] = useState<Set<string>>(() => read(key));

  // Re-read when the binder changes: this hook outlives a navigation between
  // two binders, and carrying one binder's open folders into another would
  // open folders nobody has ever opened.
  useEffect(() => {
    setOpened(read(key));
  }, [key]);

  const open = useCallback(
    (paths: readonly string[]) => {
      setOpened((current) => {
        if (paths.every((path) => current.has(path))) return current;
        const next = new Set(current);
        for (const path of paths) next.add(path);
        return write(key, next);
      });
    },
    [key],
  );

  // The folders the open document is inside, opened as soon as it is known.
  // Its own `key` in the dependencies rather than the effect above's, because
  // this has to run again after that one has replaced the set.
  useEffect(() => {
    if (activeDocument === null) return;
    const holding = foldersHolding(activeDocument);
    if (holding.length > 0) open(holding);
  }, [activeDocument, open]);

  const toggle = useCallback(
    (path: string) => {
      setOpened((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return write(key, next);
      });
    },
    [key],
  );

  const isOpen = useCallback((path: string) => opened.has(path), [opened]);

  return { isOpen, toggle, open };
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
