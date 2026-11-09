import { useCallback, useState } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { DocumentPreview } from "./DocumentPreview";
import { describeFileKind } from "../documentFile";

interface EditorFileCoverProps {
  /** The file's name as stored, for its kind and for a download. */
  fileName: string;
  /**
   * The bytes, read once. The editor already fetched them to find this was
   * not one of its documents, so the preview takes those rather than asking
   * the server again.
   */
  file: Blob;
  /** Turn it into a Bindersnap document in the draft; absent, it cannot be. */
  onConvert?: () => void;
}

/**
 * **A Word file or a PDF, in the editor, as it is.** Moving to one from the
 * file panel used to leave the editor for the document's own page; now it is
 * shown on the desk where a page would be, read only, with the ribbon, the
 * panel and the status bar still around it — and, at the top right, what it
 * is and the one thing that makes it writable here.
 *
 * A file uploaded to the vault is never opened in the editor as itself
 * (`AGENTS.md`, the two workflows): this is the same preview the document's
 * page shows. Edit in Bindersnap converts it, when asked, into the draft.
 */
export function EditorFileCover({
  fileName,
  file,
  onConvert,
}: EditorFileCoverProps) {
  const loadFile = useCallback(() => Promise.resolve(file), [file]);
  const [downloading, setDownloading] = useState(false);
  const download = () => {
    setDownloading(true);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      setDownloading(false);
    }, 0);
  };
  const kind = describeFileKind(fileName);

  return (
    <div className="doc-editor-cover">
      <aside className="doc-editor-cover-note" aria-label="About this file">
        <span className="doc-editor-cover-icon" aria-hidden="true">
          <AppIcon icon={ICON.preview} size="md" />
        </span>
        <span className="doc-editor-cover-text">
          <strong>{kind} · View only</strong>
          <span>
            {onConvert
              ? "It was uploaded as a file, so it isn't edited here."
              : "It was uploaded as a file. Edit it in the program that made it, then upload a new version."}
          </span>
        </span>
        <span className="doc-editor-cover-actions">
          {onConvert ? (
            <button
              type="button"
              className="bs-btn bs-btn-primary bs-btn--sm"
              onClick={onConvert}
            >
              <AppIcon icon={ICON.edit} size="sm" />
              Edit in Bindersnap
            </button>
          ) : null}
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={download}
            disabled={downloading}
          >
            <AppIcon icon={ICON.download} size="sm" />
            Download
          </button>
        </span>
      </aside>
      <div className="doc-editor-cover-sheet">
        <DocumentPreview
          loadFile={loadFile}
          gitRef="file"
          fileName={fileName}
          downloading={downloading}
          onDownload={download}
          bare
        />
      </div>
    </div>
  );
}
