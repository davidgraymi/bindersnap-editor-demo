import { FileText, Folder, Library } from "lucide-react";

import type { AppRoute } from "../routes";
import { formatDocumentName } from "../documentDisplay";
import type { SidebarBinder, SidebarBinderContents } from "./AppSidebar";

/**
 * The binder's files, in a panel of their own beside what you are reading.
 *
 * **It was inside the product's navigation and should not have been.** The
 * customer: *"Move the file explorer out of the side navigation bar into its
 * own side navigation bar exactly like GitHub's."* They are two different
 * questions — the map of the product barely changes, and a binder's contents
 * change every time you open a different binder — and one panel answering both
 * made the map look unstable and the contents look like navigation chrome.
 *
 * Two panels also buy the thing that makes it worth doing: the file list can
 * be as wide as a filename needs while the product's map stays narrow, and the
 * document gets the whole of the rest of the window.
 *
 * Only while a policy is open. Every other binder screen draws its own tree in
 * the page, and two trees on one screen is one too many.
 */

interface BinderExplorerProps {
  binder: SidebarBinder & { contents: SidebarBinderContents };
  onNavigate: (route: AppRoute) => void;
}

/**
 * The contents by folder, in filed order, top level first.
 *
 * A flat list would put `nursing/hand-hygiene` beside `hand-hygiene` with
 * nothing saying one is inside the other — the same thing the binder's own
 * tree exists to avoid.
 */
export function groupByFolder(
  documents: SidebarBinderContents["documents"],
): Array<[string, SidebarBinderContents["documents"]]> {
  const byFolder = new Map<string, Array<(typeof documents)[number]>>();
  for (const document of documents) {
    const existing = byFolder.get(document.folder);
    if (existing) existing.push(document);
    else byFolder.set(document.folder, [document]);
  }

  return [...byFolder.entries()].sort(([left], [right]) =>
    left === "" ? -1 : right === "" ? 1 : left.localeCompare(right),
  );
}

export function BinderExplorer({ binder, onNavigate }: BinderExplorerProps) {
  const { contents } = binder;

  return (
    <aside className="app-explorer" aria-label={`Files in ${binder.name}`}>
      {/* The binder's name heads its own files, and opens it. Not a page
          title — the page is titled by the policy — but the answer to "which
          binder am I in", which the panel would otherwise leave to memory. */}
      <button
        type="button"
        className="app-explorer-head"
        onClick={() =>
          onNavigate({
            kind: "binder",
            org: binder.org,
            binder: binder.binder,
          })
        }
      >
        <Library size={14} strokeWidth={1.75} aria-hidden="true" />
        {binder.name}
      </button>

      <div className="app-explorer-tree">
        {groupByFolder(contents.documents).map(([folder, documents]) => (
          <div className="app-explorer-group" key={folder || "top-level"}>
            {folder ? (
              <div className="app-explorer-folder">
                <Folder size={13} strokeWidth={1.75} aria-hidden="true" />
                {formatDocumentName(folder)}
              </div>
            ) : null}
            {documents.map((document) => {
              const on = document.slugPath === contents.active;

              return (
                <button
                  key={document.slugPath}
                  type="button"
                  className={`app-explorer-item${on ? " app-explorer-item--active" : ""}`}
                  aria-current={on ? "page" : undefined}
                  title={formatDocumentName(document.name)}
                  onClick={() =>
                    onNavigate({
                      kind: "binderDocument",
                      org: binder.org,
                      binder: binder.binder,
                      documentPath: document.slugPath,
                      // Clicking through a branch's tree stays on that
                      // branch: these addresses are the branch's, and
                      // following one to `main` would be following a policy
                      // to a name it does not have there.
                      ...(contents.ref ? { ref: contents.ref } : {}),
                      ...(contents.change ? { change: contents.change } : {}),
                    })
                  }
                >
                  <FileText size={14} strokeWidth={1.6} aria-hidden="true" />
                  <span className="app-explorer-name">
                    {formatDocumentName(document.name)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
