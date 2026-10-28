import { useState } from "react";
import { Download } from "lucide-react";

import { exportAdminActivity } from "../api";

function saveFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Download the activity dataset as CSV: dates, kinds and Gitea's ids, never
 * a name or an address, for DuckDB or a spreadsheet on your own computer.
 */
export function ActivityExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, fileName } = await exportAdminActivity();
      saveFile(blob, fileName);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "The activity dataset did not download.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="bs-btn bs-btn-secondary bs-btn--sm"
        disabled={busy}
        title="Dates, kinds and ids. No names or email addresses."
        onClick={() => void download()}
      >
        <Download size={14} strokeWidth={1.6} aria-hidden="true" />
        {busy ? "Preparing…" : "Download CSV"}
      </button>
      {error ? (
        <span className="app-inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
