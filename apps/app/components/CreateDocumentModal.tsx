import { useEffect, useMemo, useState } from "react";

import {
  createInitialDocumentUpload,
  type InitialDocumentUploadStep,
  validateUploadFile,
} from "../../../packages/gitea-client/uploads";
import type { GiteaClient } from "../../../packages/gitea-client/client";
import { repoExists } from "../../../packages/gitea-client/repos";

interface CreateDocumentModalProps {
  giteaClient: GiteaClient;
  owner: string;
  onClose: () => void;
  onSuccess: (owner: string, repo: string) => void;
}

type CreateDocumentStatus =
  | "idle"
  | "checking-repo"
  | InitialDocumentUploadStep
  | "done"
  | "error";

function stripExtension(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = cleanName.lastIndexOf(".");
  if (lastDot <= 0) return cleanName;
  return cleanName.slice(0, lastDot);
}

function makeFriendlyDocumentName(fileName: string): string {
  return stripExtension(fileName)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyRepoName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatFileSize(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  if (mebibytes >= 1) {
    return `${mebibytes.toFixed(2)} MiB`;
  }
  const kibibytes = bytes / 1024;
  return `${kibibytes.toFixed(0)} KiB`;
}

export function CreateDocumentModal({
  giteaClient,
  owner,
  onClose,
  onSuccess,
}: CreateDocumentModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [status, setStatus] = useState<CreateDocumentStatus>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repoSlug = useMemo(() => slugifyRepoName(documentName), [documentName]);
  const repoSlugValid = repoSlug.length > 0;
  const friendlyDocumentName = documentName.trim();
  const isBusy = status !== "idle" && status !== "error" && status !== "done";

  useEffect(() => {
    if (!selectedFile) return;
    const nextName = makeFriendlyDocumentName(selectedFile.name);
    setDocumentName(nextName);
    setValidationError(null);
    setError(null);
  }, [selectedFile]);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isBusy) {
      onClose();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
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

    setSelectedFile(file);
    setValidationError(null);
    setError(null);
  };

  const handleCreateDocument = async () => {
    if (!selectedFile) {
      setValidationError("Choose a file before creating the document.");
      return;
    }

    const trimmedName = documentName.trim();
    if (!trimmedName) {
      setValidationError("Enter a document name.");
      return;
    }

    if (!repoSlugValid) {
      setValidationError("Enter a document name with at least one letter or number.");
      return;
    }

    if (!owner) {
      setError("Your session is missing account details. Sign in again and retry.");
      setStatus("error");
      return;
    }

    try {
      setError(null);
      setValidationError(null);
      setStatus("checking-repo");

      const exists = await repoExists(giteaClient, owner, repoSlug);
      if (exists) {
        setStatus("error");
        setError(
          `A document named "${trimmedName}" already exists. Choose a different name.`,
        );
        return;
      }

      const result = await createInitialDocumentUpload({
        client: giteaClient,
        repoName: repoSlug,
        file: selectedFile,
        uploaderSlug: owner,
        nextVersion: 1,
        onProgress: setStatus,
      });
      setStatus("done");
      onSuccess(result.owner, result.repo);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to create document.";
      setStatus("error");
      setError(message);
    }
  };

  const canSubmit =
    Boolean(selectedFile) &&
    friendlyDocumentName.length > 0 &&
    repoSlugValid &&
    status !== "creating-repo" &&
    status !== "bootstrapping" &&
    status !== "protecting" &&
    status !== "creating-branch" &&
    status !== "committing" &&
    status !== "opening-pr";

  return (
    <div className="upload-modal-backdrop" onClick={handleBackdropClick}>
      <div
        className="upload-modal create-document-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bs-eyebrow">New Document</div>
        <h2>Create workspace document</h2>

        {status === "idle" || status === "error" || status === "done" ? (
          <div className="create-document-form">
            <label
              htmlFor="create-document-file"
              className="upload-file-input-label"
            >
              <span className="bs-eyebrow">Choose File</span>
              <input
                id="create-document-file"
                type="file"
                onChange={handleFileChange}
                className="upload-file-input"
              />
            </label>

            {selectedFile ? (
              <p className="create-document-file-summary">
                <strong>Selected:</strong> {selectedFile.name} (
                {formatFileSize(selectedFile.size)})
              </p>
            ) : null}

            <label
              htmlFor="create-document-name"
              className="create-document-field"
            >
              <span className="bs-eyebrow">Document Name</span>
              <input
                id="create-document-name"
                className="create-document-input"
                type="text"
                value={documentName}
                onChange={(event) => {
                  setDocumentName(event.target.value);
                  setError(null);
                  setValidationError(null);
                }}
                placeholder="Quarterly Report"
              />
            </label>

            {validationError ? (
              <p className="upload-validation-error">{validationError}</p>
            ) : null}

            {error ? (
              <p className="upload-error-message" role="alert">
                {error}
              </p>
            ) : null}

            <div className="upload-modal-actions">
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                onClick={() => void handleCreateDocument()}
                disabled={!canSubmit}
              >
                Create Document
              </button>
              <button
                className="bs-btn bs-btn-secondary"
                type="button"
                onClick={onClose}
                disabled={isBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="upload-success-pr">
            <p>Creating your workspace document...</p>
            <ul className="upload-step-list">
              <li
                className={
                  status === "checking-repo"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Checking document name...
              </li>
              <li
                className={
                  status === "hashing"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Hashing file...
              </li>
              <li
                className={
                  status === "creating-repo"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Setting up your document...
              </li>
              <li
                className={
                  status === "bootstrapping"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Preparing the first draft...
              </li>
              <li
                className={
                  status === "protecting"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Locking review rules...
              </li>
              <li
                className={
                  status === "creating-branch"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Creating the review draft...
              </li>
              <li
                className={
                  status === "committing"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Committing document...
              </li>
              <li
                className={
                  status === "opening-pr"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Opening the first review...
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
