import { useState } from "react";

import type { GiteaClient } from "../../../packages/gitea-client/client";
import type { UploadResult } from "../../../packages/gitea-client/uploads";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  commitBinaryFile,
  computeFileHash,
  createUploadBranch,
  validateUploadFile,
} from "../../../packages/gitea-client/uploads";
import { createPullRequest } from "../../../packages/gitea-client/pullRequests";

interface UploadModalProps {
  giteaClient: GiteaClient;
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

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => {
      reject(new Error("Failed to read file as base64."));
    };
    reader.readAsDataURL(file);
  });
}

export function UploadModal({
  giteaClient,
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

  const giteaBaseUrl =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env?.VITE_GITEA_BASE_URL ?? "http://localhost:3000";

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

    setSelectedFile(file);
    setValidationError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setError(null);
    const baseBranch = "main";

    try {
      // Step 1: Hash the file
      setStatus("hashing");
      const fullHash = await computeFileHash(selectedFile);
      const contentHash8 = fullHash.slice(0, 8);

      // Step 2: Read file as base64
      const base64Content = await readFileAsBase64(selectedFile);

      // Step 3: Create branch
      setStatus("creating-branch");
      const branchName = buildUploadBranchName(
        docSlug,
        uploaderSlug,
        contentHash8,
      );
      await createUploadBranch({
        client: giteaClient,
        owner,
        repo,
        branchName,
        from: baseBranch,
      });

      // Step 4: Commit file
      setStatus("committing");
      const canonicalFile =
        canonicalFileName && canonicalFileName.trim() !== ""
          ? canonicalFileName
          : `${docSlug}.${selectedFile.name.split(".").pop()!.toLowerCase()}`;

      const commitMessage = buildUploadCommitMessage({
        docSlug,
        canonicalFile,
        sourceFilename: selectedFile.name,
        uploadBranch: branchName,
        uploaderSlug,
        fileHashSha256: fullHash,
      });

      const { sha: commitSha } = await commitBinaryFile({
        client: giteaClient,
        owner,
        repo,
        branch: branchName,
        filePath: canonicalFile,
        base64Content,
        message: commitMessage,
      });

      // Step 5: Open PR
      setStatus("opening-pr");
      const docTitle = docSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      const prTitle = `Upload v${nextVersion}: ${docTitle}`;
      const prBody = [
        `Automated upload from Bindersnap file vault.`,
        ``,
        `Source file: ${selectedFile.name}`,
        `Document: ${docSlug}`,
        `Uploaded by: ${uploaderSlug}`,
        `File hash (SHA-256): ${fullHash}`,
      ].join("\n");

      const pr = await createPullRequest({
        client: giteaClient,
        owner,
        repo,
        title: prTitle,
        head: branchName,
        base: baseBranch,
        body: prBody,
      });

      // Done
      const uploadResult: UploadResult = {
        prNumber: pr.number ?? 0,
        prTitle,
        branchName,
        commitSha,
      };

      setResult(uploadResult);
      setStatus("done");
      onSuccess(uploadResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(message);
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
    if (stepStatus === "done" && status === "done")
      return "upload-step upload-step-done";

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

            {validationError && (
              <p className="upload-validation-error">{validationError}</p>
            )}

            {selectedFile && !validationError && (
              <p className="upload-file-input-label">
                <strong>Selected:</strong> {selectedFile.name} (
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MiB)
              </p>
            )}

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
          <>
            <ul className="upload-step-list">
              <li className={getStepClass("hashing")}>
                Computing file hash...
              </li>
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
          </>
        )}

        {status === "done" && result && (
          <div className="upload-success-pr">
            <p className="upload-pr-number">
              Pull request <strong>#{result.prNumber}</strong> created
              successfully.
            </p>
            <a
              className="bs-btn bs-btn-primary"
              href={`${giteaBaseUrl}/${owner}/${repo}/pulls/${result.prNumber}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View Pull Request
            </a>
            <button
              className="bs-btn bs-btn-secondary"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}

        {status === "error" && (
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
        )}
      </div>
    </div>
  );
}
