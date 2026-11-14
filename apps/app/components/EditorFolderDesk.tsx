import { useLayoutEffect, useRef, useState } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { buildDocumentUrl } from "../binderDocument";
import { buildBinderUrl } from "../binderShell";
import { formatDocumentName } from "../documentDisplay";
import { BinderDocuments } from "./BinderPage";

/**
 * A folder on the editor's desk, where a document's page goes (D1, 4.5).
 *
 * A head card — the folder, how many documents, Upload files here and New
 * document here — then the folder's list, the binder page's own, read at the
 * draft. **Nothing about who signs off is laid out here**: that is the
 * right-hand panel's. No Published picker either: the editor always shows the
 * draft, and the draft picker in its bar already says which (O1).
 *
 * The list sits between the two panels, using their real widths — the file
 * panel is resizable and either may be shut — so neither covers a name.
 */
export function EditorFolderDesk({
  org,
  binder,
  binderName,
  folder,
  draft,
  documentCount,
  onUpload,
  onNew,
  onOpenDocument,
  onOpenFolder,
}: {
  org: string;
  binder: string;
  binderName: string;
  /** "" is the binder's top folder. */
  folder: string;
  draft: string;
  documentCount: number | null;
  onUpload?: (folder: string) => void;
  onNew?: (folder: string) => void;
  onOpenDocument: (slugPath: string) => void;
  onOpenFolder: (folder: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inset, setInset] = useState({ left: 0, right: 0 });

  // The two panels float over the desk; measure them, and keep the list in
  // the space they leave.
  useLayoutEffect(() => {
    const desk = ref.current;
    const body = desk?.closest(".bs-doc-body");
    if (!desk || !body) return;
    const measure = () => {
      const box = desk.getBoundingClientRect();
      const left = body.querySelector(".doc-files-float");
      const right = body.querySelector(".doc-signoff-float");
      const l = left ? left.getBoundingClientRect().right - box.left : 0;
      const r = right ? box.right - right.getBoundingClientRect().left : 0;
      setInset({ left: Math.max(0, l), right: Math.max(0, r) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(desk);
    for (const panel of body.querySelectorAll(
      ".doc-files-float, .doc-signoff-float, .doc-files-anchor, .doc-signoff-anchor",
    )) {
      observer.observe(panel);
    }
    const mutations = new MutationObserver(measure);
    mutations.observe(body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  const name =
    folder === ""
      ? binderName
      : formatDocumentName(folder.slice(folder.lastIndexOf("/") + 1));

  return (
    <div
      className="doc-folder-desk"
      ref={ref}
      style={{
        paddingLeft: `calc(${inset.left}px + var(--brand-space-4))`,
        paddingRight: `calc(${inset.right}px + var(--brand-space-4))`,
      }}
    >
      <section className="bs-panel doc-folder-head" aria-label={name}>
        <span className="doc-folder-icon" aria-hidden="true">
          <AppIcon icon={ICON.folder} size="lg" />
        </span>
        <span className="doc-folder-text">
          <strong className="doc-folder-name">{name}</strong>
          <span className="bs-row-meta">
            {folder === "" ? "The whole binder" : "Folder"}
            {documentCount === null
              ? ""
              : ` · ${documentCount === 1 ? "1 document" : `${documentCount} documents`}`}
          </span>
        </span>
        <span className="doc-folder-actions">
          {onUpload ? (
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn-secondary"
              onClick={() => onUpload(folder)}
            >
              <AppIcon icon={ICON.upload} size="sm" />
              Upload files here
            </button>
          ) : null}
          {onNew ? (
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn-primary"
              onClick={() => onNew(folder)}
            >
              <AppIcon icon={ICON.newDocument} size="sm" />
              New document here
            </button>
          ) : null}
        </span>
      </section>

      <BinderDocuments
        org={org}
        binder={binder}
        atRef={draft}
        folder={folder === "" ? null : folder}
        onOpenDocument={onOpenDocument}
        documentHref={(slugPath) =>
          buildDocumentUrl({
            org,
            binder,
            documentPath: slugPath,
            version: null,
          })
        }
        onOpenFolder={onOpenFolder}
        folderHref={(path) => buildBinderUrl({ org, binder, folder: path })}
      />
    </div>
  );
}
