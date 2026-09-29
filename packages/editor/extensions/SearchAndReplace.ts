import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Find and replace, the way a word processor does it.
 *
 * Every match is marked in the page, the current one more strongly, and the
 * count reads "3 of 12" — Word's navigation pane, not the browser's Ctrl+F,
 * which cannot see past the part of a long policy that is on screen and
 * cannot replace anything at all.
 *
 * Matches never span two paragraphs: a phrase that breaks across a paragraph
 * is two phrases to the person who wrote it.
 */

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  /** Index into `matches`; -1 when there are none. */
  current: number;
}

export const searchPluginKey = new PluginKey<SearchState>("bsSearch");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchQuery: (query: string) => ReturnType;
      setSearchCaseSensitive: (caseSensitive: boolean) => ReturnType;
      nextSearchMatch: () => ReturnType;
      previousSearchMatch: () => ReturnType;
      replaceSearchMatch: (replacement: string) => ReturnType;
      replaceAllSearchMatches: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

type SearchMeta =
  | { kind: "query"; query: string }
  | { kind: "case"; caseSensitive: boolean }
  | { kind: "move"; step: 1 | -1 };

/** Every match of `query` in the document, in document order. */
export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  if (query === "") return [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: SearchMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    // The block's text, with where each character sits in the document. An
    // inline node that is not text — an image, a line break — is a gap that
    // no match may cross.
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        const start = pos + 1 + offset;
        for (let index = 0; index < child.text.length; index += 1) {
          text += child.text[index];
          positions.push(start + index);
        }
      } else {
        text += "\u0000";
        positions.push(-1);
      }
    });

    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      const from = positions[at] ?? -1;
      const last = positions[at + needle.length - 1] ?? -1;
      if (from !== -1 && last !== -1) {
        matches.push({ from, to: last + 1 });
      }
      at = haystack.indexOf(needle, at + needle.length);
    }
    return false;
  });

  return matches;
}

/** The match at or after `pos`, so a new search starts where the reader is. */
function nearestMatch(matches: SearchMatch[], pos: number): number {
  if (matches.length === 0) return -1;
  const after = matches.findIndex((match) => match.from >= pos);
  return after === -1 ? 0 : after;
}

export const SearchAndReplace = Extension.create({
  name: "search",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: () => ({
            query: "",
            caseSensitive: false,
            matches: [],
            current: -1,
          }),
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;
            let { query, caseSensitive, current } = previous;

            if (meta?.kind === "query") query = meta.query;
            if (meta?.kind === "case") caseSensitive = meta.caseSensitive;

            const fresh = meta?.kind === "query" || meta?.kind === "case";
            const matches =
              tr.docChanged || fresh
                ? findMatches(newState.doc, query, caseSensitive)
                : previous.matches;

            if (meta?.kind === "move" && matches.length > 0) {
              current = (current + meta.step + matches.length) % matches.length;
            } else if (fresh) {
              current = nearestMatch(matches, newState.selection.from);
            } else if (tr.docChanged) {
              current =
                matches.length === 0
                  ? -1
                  : Math.min(Math.max(current, 0), matches.length - 1);
            }

            return { query, caseSensitive, matches, current };
          },
        },
        props: {
          decorations(state) {
            const search = searchPluginKey.getState(state);
            if (!search || search.matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              search.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class:
                    index === search.current
                      ? "bs-search-match bs-search-match--current"
                      : "bs-search-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },

  addCommands() {
    /**
     * Step to the next or previous match, select it, and bring it into view.
     *
     * The index moves in the plugin's own state; the selection is set here on
     * the same transaction, from the match the plugin will land on, so the
     * two can never disagree about which one is current.
     */
    const step =
      (direction: 1 | -1) =>
      ({
        state,
        tr,
        dispatch,
      }: {
        state: EditorState;
        tr: Transaction;
        dispatch?: ((tr: Transaction) => void) | undefined;
      }) => {
        const search = searchPluginKey.getState(state);
        if (!search || search.matches.length === 0) return false;
        if (dispatch) {
          const count = search.matches.length;
          const next = (search.current + direction + count) % count;
          const match = search.matches[next]!;
          tr.setMeta(searchPluginKey, { kind: "move", step: direction });
          tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
          tr.scrollIntoView();
        }
        return true;
      };

    const replace = (tr: Transaction, match: SearchMatch, text: string) => {
      if (text === "") tr.delete(match.from, match.to);
      else tr.insertText(text, match.from, match.to);
    };

    return {
      setSearchQuery:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchPluginKey, { kind: "query", query });
          return true;
        },
      setSearchCaseSensitive:
        (caseSensitive) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(searchPluginKey, { kind: "case", caseSensitive });
          }
          return true;
        },
      nextSearchMatch: () => step(1),
      previousSearchMatch: () => step(-1),
      replaceSearchMatch:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const search = searchPluginKey.getState(state);
          const match = search?.matches[search.current];
          if (!match) return false;
          if (dispatch) replace(tr, match, replacement);
          return true;
        },
      replaceAllSearchMatches:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const search = searchPluginKey.getState(state);
          if (!search || search.matches.length === 0) return false;
          if (dispatch) {
            // Last first, so each replacement leaves the positions of the ones
            // still to do where the search found them.
            for (const match of [...search.matches].reverse()) {
              replace(tr, match, replacement);
            }
          }
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(searchPluginKey, { kind: "query", query: "" });
          }
          return true;
        },
    };
  },
});

/** The search's state, for the pane that drives it. */
export function getSearchState(state: EditorState): SearchState | undefined {
  return searchPluginKey.getState(state);
}
