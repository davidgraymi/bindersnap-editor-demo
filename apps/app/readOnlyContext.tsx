import { createContext, useContext } from "react";
import { NOT_READ_ONLY, type ReadOnlyState } from "./readOnly";

const ReadOnlyContext = createContext<ReadOnlyState>(NOT_READ_ONLY);

export const ReadOnlyProvider = ReadOnlyContext.Provider;

/**
 * Whether this session may write, and whose bill it is if not.
 *
 * A context rather than a prop because read-only is a fact about the whole
 * app, not about any one page: it reaches the publish gate, the upload form
 * and the people tabs alike, and threading it through every intermediate
 * component would guarantee one of them forgot.
 *
 * This is not a permission check. Permission is Gitea's answer and arrives on
 * the payload as `canManage` — an app-side check standing in for one is the
 * tripwire ADR 0004 names. This is a billing state, which is ours to know,
 * and it applies to everyone in the organization including its owners.
 */
export function useReadOnly(): ReadOnlyState {
  return useContext(ReadOnlyContext);
}

/**
 * True when a control that writes should not be drawn.
 *
 * The common case, given a name so components read as
 * `canManage && !isReadOnly` rather than reaching into the state object.
 */
export function useIsReadOnly(): boolean {
  return useContext(ReadOnlyContext).readOnly;
}
