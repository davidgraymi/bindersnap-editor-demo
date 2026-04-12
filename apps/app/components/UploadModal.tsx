import { useState } from "react";

import {
  uploadDocumentVersion,
  validateUploadFile,
  type UploadResult,
} from "../api";

interface UploadModalProps {
  owner: string;
  repo: string;
  docSlug: string;
  uploaderSlug: string;
  nextVersion: number;
  canonicalFileName?: string | null;
  onClose: () => void;
  onSuccess: (result: UploadResult) => void;
}

type UploadStatus =
  | "idle"
  | "hashing"
  | "creating-branch"
  | "committing"
  | "opening-pr"
  | "done"
  | "error";

export function UploadModal({
  owner,
  repo,
  docSlug,
  uploaderSlug,
  nextVersion,
  canonicalFileName,
  onClose,
  onSuccess,
}: UploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setValidationError(null);
      return;
    }

    const validation = validateUploadFile(file);
    if (!validation.valid) {
      setSelectedFile(null);
      setValidationError(validation.reason ?? "Invalid file.");
      return;
    }

    if (canonicalFileName) {
      const existingExt =
        canonicalFileName.split(".").pop()?.toLowerCase() ?? "";
      const uploadedExt = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (existingExt && uploadedExt && existingExt !== uploadedExt) {
        setSelectedFile(null);
        setValidationError(
          `File type mismatch: the current document is .${existingExt} but you selected a .${uploadedExt} file. Please upload a .${existingExt} file.`,
        );
        return;
      }
    }

    setSelectedFile(file);
    setValidationError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      return;
    }

    setError(null);

    try {
      setStatus("hashing");

      const uploadResult = await uploadDocumentVersion({
        owner,
        repo,
        docSlug,
        uploaderSlug,
        nextVersion,
        canonicalFileName,
        file: selectedFile,
      });

      setResult(uploadResult);
      setStatus("done");
      onSuccess(uploadResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStatus("error");
    }
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const getStepClass = (stepStatus: UploadStatus): string => {
    if (status === stepStatus) return "upload-step upload-step-active";
    if (stepStatus === "done" && status === "done") {
      return "upload-step upload-step-done";
    }

    const order: UploadStatus[] = [
      "hashing",
      "creating-branch",
      "committing",
      "opening-pr",
      "done",
    ];
    const currentIndex = order.indexOf(status);
    const stepIndex = order.indexOf(stepStatus);

    if (currentIndex > stepIndex) return "upload-step upload-step-done";
    return "upload-step";
  };

  return (
    <div className="upload-modal-backdrop" onClick={handleBackdropClick}>
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bs-eyebrow">Upload New Version</div>
        <h2>Upload Document</h2>

        {status === "idle" && (
          <>
            <label htmlFor="file-upload" className="upload-file-input-label">
              <span className="bs-eyebrow">Select File</span>
              <input
                id="file-upload"
                type="file"
                onChange={handleFileSelect}
                className="upload-file-input"
              />
            </label>

            {validationError ? (
              <p className="upload-validation-error">{validationError}</p>
            ) : null}

            {selectedFile && !validationError ? (
              <p className="upload-file-input-label">
                <strong>Selected:</strong> {selectedFile.name} (
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MiB)
              </p>
            ) : null}

            <div className="upload-modal-actions">
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                onClick={handleUpload}
                disabled={!selectedFile}
              >
                Upload
              </button>
              <button
                className="bs-btn bs-btn-secondary"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {(status === "hashing" ||
          status === "creating-branch" ||
          status === "committing" ||
          status === "opening-pr") && (
          <ul className="upload-step-list">
            <li className={getStepClass("hashing")}>Computing file hash...</li>
            <li className={getStepClass("creating-branch")}>
              Creating upload branch...
            </li>
            <li className={getStepClass("committing")}>
              Committing file to Gitea...
            </li>
            <li className={getStepClass("opening-pr")}>
              Opening pull request...
            </li>
          </ul>
        )}

        {status === "done" && result ? (
          <div className="upload-success-pr">
            <p className="upload-pr-number">
              Pull request <strong>#{result.prNumber}</strong> created
              successfully.
            </p>
            <button
              className="bs-btn bs-btn-secondary"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : null}

        {status === "error" ? (
          <>
            <p className="upload-error-message">{error}</p>
            <div className="upload-modal-actions">
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setError(null);
                }}
              >
                Try Again
              </button>
              <button
                className="bs-btn bs-btn-secondary"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
