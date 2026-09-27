import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { GitBranch } from "lucide-react";

import type { WorkspaceDocumentDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  fetchBinderDocument,
  reviseBinderDocument,
} from "../api";
import { formatAge, formatDocumentName } from "../documentDisplay";
import { parseEditorDocument } from "../editorDocumentHtml";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * A document open in the editor, saving into your draft.
 *
 * **Where the words go is the whole of this page.** The editor itself is a
 * word processor and knows nothing about binders; this is what makes Save
 * mean something here. It commits the document to the draft you are editing
 * the binder in, as you, and nothing more — the version on record does not
 * move, nobody is asked to review anything, and the draft bar counts one more
 * act. Proposing is still the draft's job, from the binder, when the author
 * is ready.
 *
 * The editor is loaded on demand: Tiptap, ProseMirror and the ribbon are a
 * large download that most visits to a policy never need.
 */

const DocumentEditor = lazy(() =>
  import("../../../packages/editor/DocumentEditor").then((module) => ({
    default: module.DocumentEditor,
  })),
);

interface DocumentEditorPageProps {
  org: string;
  binder: string;
  documentPath: string;
  /** The draft to read from and save into. Null while the shell finds it. */
  draft: string | null;
  /** What the draft is called, to say where Save puts things. */
  draftName: string | null;
  /** Back to the document, still in edit mode. */
  onClose: () => void;
  /** A save landed: the draft has one more act to count. */
  onSaved: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** The file is not one the editor writes — a Word file, a PDF. */
  | { kind: "foreign"; detail: WorkspaceDocumentDetailPayload }
  | { kind: "ready"; detail: WorkspaceDocumentDetailPayload; doc: JSONContent };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

/** Nothing written yet but a title — what "Write it here" starts with. */
function isBlankPolicy(doc: JSONContent): boolean {
  const blocks = doc.content ?? [];
  const last = blocks[blocks.length - 1];
  return (
    blocks.length <= 2 &&
    last?.type === "paragraph" &&
    (last.content ?? []).length === 0
  );
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

export function DocumentEditorPage({
  org,
  binder,
  documentPath,
  draft,
  draftName,
  onClose,
  onSaved,
}: DocumentEditorPageProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [dirty, setDirty] = useState(false);
  const [closing, setClosing] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  /** The document as last saved, to tell a real change from an undo back. */
  const savedJson = useRef<string>("");
  const [, setTick] = useState(0);

  // **The whole window is the desk.** Word does not keep your file browser
  // open beside the page, and here the product's map and the binder's files
  // squeezed Letter to half size on a laptop. While a document is open in the
  // editor the shell drops both; the top bar stays, as the way out.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("bs-writing");
    return () => html.classList.remove("bs-writing");
  }, []);

  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    setLoad({ kind: "loading" });

    (async () => {
      // Read in the draft: a policy edited a minute ago is only there.
      const detail = await fetchBinderDocument(
        org,
        binder,
        documentPath,
        draft,
      );
      const blob = await downloadBinderDocument(
        org,
        binder,
        detail.document.path,
        draft,
      );
      const doc = parseEditorDocument(await blob.text());
      if (cancelled) return;
      if (doc === null) {
        setLoad({ kind: "foreign", detail });
        return;
      }
      savedJson.current = JSON.stringify(doc);
      setLoad({ kind: "ready", detail, doc });
    })().catch((err: unknown) => {
      if (!cancelled) {
        setLoad({
          kind: "error",
          message: errorMessage(err, "Unable to open this document."),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [org, binder, documentPath, draft]);

  // "Saved 3 minutes ago" has to keep counting while nobody types.
  useEffect(() => {
    if (save.kind !== "saved") return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [save.kind]);

  // Leaving with unsaved words asks first, as every word processor does. The
  // browser writes the question; all a page can do is ask for it.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const handleChange = useCallback((doc: JSONContent) => {
    setDirty(JSON.stringify(doc) !== savedJson.current);
  }, []);

  const saveNow = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor || load.kind !== "ready" || !draft) return false;
    if (save.kind === "saving") return false;

    const doc = editor.getJSON();
    const json = JSON.stringify(doc);
    if (json === savedJson.current) {
      setDirty(false);
      return true;
    }

    setSave({ kind: "saving" });
    try {
      // Stored the way the seed and every earlier save stored it, so a diff
      // between two versions is a diff of the words and not of the spacing.
      const file = new File([JSON.stringify(doc, null, 2)], "document.json", {
        type: "application/json",
      });
      await reviseBinderDocument(
        org,
        binder,
        file,
        load.detail.document.slugPath,
        { draft },
      );
      savedJson.current = json;
      // Anything typed while the save was in flight is still unsaved.
      setDirty(JSON.stringify(editor.getJSON()) !== json);
      setSave({ kind: "saved", at: new Date().toISOString() });
      onSaved();
      return true;
    } catch (err) {
      setSave({
        kind: "failed",
        message: errorMessage(
          err,
          "Unable to save. Your words are still here.",
        ),
      });
      return false;
    }
  }, [binder, draft, load, onSaved, org, save.kind]);

  const requestClose = () => {
    if (dirty) setClosing(true);
    else onClose();
  };

  if (!draft || load.kind === "loading") {
    return (
      <div className="doc-editor-page">
        <SkeletonGroup label="Opening the editor">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div className="doc-editor-page">
        <p className="bs-note bs-note--danger" role="alert">
          {load.message}
        </p>
        <p>
          <button
            type="button"
            className="bs-btn bs-btn-secondary"
            onClick={onClose}
          >
            Back to the document
          </button>
        </p>
      </div>
    );
  }

  const name = formatDocumentName(load.detail.document.name);

  if (load.kind === "foreign") {
    return (
      <div className="doc-editor-page">
        <div className="bs-empty">
          <h1 className="bs-title">{name} is not a Bindersnap document</h1>
          <p>
            It was uploaded as a file, so it is edited in the program that made
            it. Make your changes there, then use Upload new version on the
            document's page.
          </p>
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={onClose}
          >
            Back to the document
          </button>
        </div>
      </div>
    );
  }

  const status =
    save.kind === "saving"
      ? "Saving…"
      : save.kind === "failed"
        ? "Not saved"
        : dirty
          ? "Unsaved changes"
          : save.kind === "saved"
            ? `Saved ${formatAge(save.at)}`
            : "No changes yet";

  return (
    <div className="doc-editor-page">
      <header className="doc-editor-head">
        <div className="doc-editor-head-body">
          <h1 className="doc-editor-title">{name}</h1>
          {/* Where Save puts things, said before it is pressed. */}
          <p
            className="doc-editor-where"
            title="The version on record does not change until the draft is proposed and approved."
          >
            <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>
              Saving to{" "}
              {draftName ? <strong>{draftName}</strong> : "your draft"}
              <span className="doc-editor-where-more">
                {" "}
                · nothing on record changes until it is approved
              </span>
            </span>
          </p>
        </div>
        <div className="doc-editor-head-actions">
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={requestClose}
          >
            Close
          </button>
          <button
            type="button"
            className="bs-btn bs-btn-primary bs-btn--sm"
            disabled={!dirty || save.kind === "saving"}
            onClick={() => void saveNow()}
          >
            {save.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {save.kind === "failed" ? (
        <p className="bs-note bs-note--danger" role="alert">
          {save.message}
        </p>
      ) : null}

      <div className="doc-editor-frame">
        <Suspense
          fallback={
            <SkeletonGroup label="Loading the editor">
              <SkeletonLine width="medium" />
            </SkeletonGroup>
          }
        >
          <DocumentEditor
            label={name}
            initialContent={load.doc}
            // A policy just started is its title and an empty line: the
            // cursor goes on the empty line, ready to type, as Word's does.
            // Anything longer opens at the top, where it starts.
            autoFocus={isBlankPolicy(load.doc) ? "end" : "start"}
            onChange={handleChange}
            onSave={() => void saveNow()}
            onReady={(editor) => {
              editorRef.current = editor;
              // The baseline is the document as the editor holds it, not as
              // the file had it: loading normalises it (an empty paragraph at
              // the end, attributes filled in), and comparing against the file
              // called a document nobody had touched "unsaved".
              savedJson.current = JSON.stringify(editor.getJSON());
              setDirty(false);
            }}
            statusStart={
              <span
                className={`doc-editor-status${
                  dirty || save.kind === "failed"
                    ? " doc-editor-status--unsaved"
                    : ""
                }`}
                role="status"
              >
                {status}
              </span>
            }
          />
        </Suspense>
      </div>

      {closing ? (
        <div
          className="upload-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setClosing(false);
          }}
        >
          <div
            className="upload-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="doc-editor-close-title"
            aria-describedby="doc-editor-close-body"
          >
            <h2 id="doc-editor-close-title">Save your changes to {name}?</h2>
            <p id="doc-editor-close-body" className="add-policy-note">
              They go into your draft. Closing without saving loses everything
              since the last save.
            </p>
            <div className="upload-modal-actions">
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                autoFocus
                disabled={save.kind === "saving"}
                onClick={() => {
                  void saveNow().then((saved) => {
                    if (saved) onClose();
                    else setClosing(false);
                  });
                }}
              >
                {save.kind === "saving" ? "Saving…" : "Save and close"}
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-secondary"
                onClick={() => {
                  setDirty(false);
                  onClose();
                }}
              >
                Close without saving
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-secondary"
                onClick={() => setClosing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
