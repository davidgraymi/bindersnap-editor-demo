import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";

import { DemoEditor } from "../../editor/Editor";
import { GiteaApiError, type GiteaClient } from "../../services/gitea/client";
import { commitDocument, fetchDocument } from "../../services/gitea/documents";

const AUTOSAVE_DELAY_MS = 2000;

interface DocumentEditorProps {
  client: GiteaClient;
  owner: string;
  repo: string;
  filePath: string;
  branch?: string;
  onBack: () => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function DocumentEditor({ client, owner, repo, filePath, branch = "main", onBack }: DocumentEditorProps) {
  const [content, setContent] = useState<JSONContent | null>(null);
  const [fileSha, setFileSha] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const fileShaRef = useRef(fileSha);
  fileShaRef.current = fileSha;
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load document on mount
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const result = await fetchDocument({ client, owner, repo, filePath, branch });
        if (!cancelled) {
          setContent(result.content);
          setFileSha(result.sha);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof GiteaApiError ? err.message : err instanceof Error ? err.message : "Failed to load document.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, owner, repo, filePath, branch]);

  const save = useCallback(
    async (nextContent: JSONContent, message = "Auto-save") => {
      setSaveState("saving");
      try {
        const result = await commitDocument({
          client,
          owner,
          repo,
          filePath,
          branch,
          content: nextContent,
          message,
          sha: fileShaRef.current || undefined,
        });
        setFileSha(result.fileSha ?? fileShaRef.current);
        setSaveState("saved");
        setLastSaved(new Date());
      } catch (err) {
        setSaveState("error");
        console.error("Auto-save failed:", err);
      }
    },
    [client, owner, repo, filePath, branch]
  );

  const handleChange = useCallback(
    (nextContent: JSONContent) => {
      setContent(nextContent);
      setSaveState("idle");

      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void save(nextContent, `Auto-save: ${filePath}`);
      }, AUTOSAVE_DELAY_MS);
    },
    [save, filePath]
  );

  const handleManualSave = useCallback(() => {
    if (!content) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    void save(content, `Save: ${filePath}`);
  }, [content, save, filePath]);

  const docTitle = filePath.split("/").pop()?.replace(".json", "") ?? filePath;

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? `Saved ${lastSaved?.toLocaleTimeString() ?? ""}`
        : saveState === "error"
          ? "Save failed"
          : "Save";

  if (loading) {
    return (
      <div className="app-shell">
        <header className="app-topbar">
          <button className="bs-btn bs-btn-secondary" type="button" onClick={onBack}>
            ← Back
          </button>
        </header>
        <main className="app-main">
          <div className="bs-card app-doc-empty">Loading document…</div>
        </main>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-shell">
        <header className="app-topbar">
          <button className="bs-btn bs-btn-secondary" type="button" onClick={onBack}>
            ← Back
          </button>
        </header>
        <main className="app-main">
          <section className="bs-card app-error">
            <div className="bs-eyebrow">Load Error</div>
            <h2>Could not load document</h2>
            <p>{loadError}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-logo-wrap">
          <button className="bs-btn bs-btn-secondary" type="button" onClick={onBack}>
            ← Documents
          </button>
          <span className="app-logo-text" style={{ marginLeft: "var(--brand-space-3)" }}>{docTitle}</span>
        </div>
        <div className="app-topbar-actions">
          <span style={{ fontSize: "var(--brand-text-sm)", color: "var(--bs-text-secondary)" }}>
            {saveState === "error" ? "⚠ Save failed" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : ""}
          </span>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={handleManualSave}
            disabled={saveState === "saving"}
          >
            {saveLabel}
          </button>
        </div>
      </header>

      <main className="app-main" style={{ padding: 0 }}>
        {content && (
          <DemoEditor
            initialContent={content}
            onChange={handleChange}
          />
        )}
      </main>
    </div>
  );
}
