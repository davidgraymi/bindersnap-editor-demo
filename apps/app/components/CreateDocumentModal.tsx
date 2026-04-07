import { useEffect, useMemo, useState } from "react";

import {
  GiteaApiError,
  unwrap,
  type GiteaClient,
} from "../../../packages/gitea-client/client";
import { createPullRequest } from "../../../packages/gitea-client/pullRequests";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  commitBinaryFile,
  computeFileHash,
  createUploadBranch,
  validateUploadFile,
} from "../../../packages/gitea-client/uploads";

interface CreateDocumentModalProps {
  giteaClient: GiteaClient;
  owner: string;
  onClose: () => void;
  onSuccess: (owner: string, repo: string) => void;
}

type CreateDocumentStatus =
  | "idle"
  | "checking-repo"
  | "hashing"
  | "creating-repo"
  | "bootstrapping"
  | "protecting"
  | "creating-branch"
  | "committing"
  | "opening-pr"
  | "done"
  | "error";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => {
      reject(new Error("Failed to read file as base64."));
    };
    reader.readAsDataURL(file);
  });
}

function stripExtension(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = cleanName.lastIndexOf(".");
  if (lastDot <= 0) return cleanName;
  return cleanName.slice(0, lastDot);
}

function getOriginalExtension(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = cleanName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === cleanName.length - 1) return "";
  return cleanName.slice(lastDot + 1).toLowerCase();
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

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatFileSize(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  if (mebibytes >= 1) {
    return `${mebibytes.toFixed(2)} MiB`;
  }
  const kibibytes = bytes / 1024;
  return `${kibibytes.toFixed(0)} KiB`;
}

async function repoExists(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    await unwrap(
      client.GET("/repos/{owner}/{repo}", {
        params: { path: { owner, repo } },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

async function deleteReadmeIfPresent(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    const readme = await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner, repo, filepath: "README.md" },
          query: { ref: "main" },
        },
      }),
    );

    const sha =
      !Array.isArray(readme) && typeof readme.sha === "string"
        ? readme.sha
        : "";

    if (!sha) return;

    await unwrap(
      client.DELETE("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner, repo, filepath: "README.md" },
        },
        body: {
          branch: "main",
          message: "Bootstrap empty repository",
          sha,
        },
      }),
    );
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return;
    }
    throw err;
  }
}

async function createMainBranchProtection(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<void> {
  await unwrap(
    client.POST("/repos/{owner}/{repo}/branch_protections", {
      params: { path: { owner, repo } },
      body: {
        rule_name: "main",
        required_approvals: 1,
        block_on_official_review_requests: true,
        block_on_outdated_branch: true,
        block_on_rejected_reviews: true,
        dismiss_stale_approvals: true,
        enable_approvals_whitelist: false,
        enable_merge_whitelist: false,
        enable_push: false,
      },
    }),
  );
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
  const originalExtension = selectedFile
    ? getOriginalExtension(selectedFile.name)
    : "";
  const canonicalFileName = originalExtension
    ? `document.${originalExtension}`
    : "document";
  const friendlyDocumentName = documentName.trim();
  const displayDocumentName = titleCase(
    (friendlyDocumentName || repoSlug.replace(/-/g, " ")).trim(),
  );
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
      setValidationError(
        "The document name must produce a valid repository name.",
      );
      return;
    }

    if (!owner) {
      setError("Missing repository owner. Sign in again and retry.");
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

      setStatus("hashing");
      const fileHashSha256 = await computeFileHash(selectedFile);
      const contentHash8 = fileHashSha256.slice(0, 8);

      const base64Content = await readFileAsBase64(selectedFile);

      setStatus("creating-repo");
      await unwrap(
        giteaClient.POST("/user/repos", {
          body: {
            name: repoSlug,
            private: true,
            auto_init: true,
            default_branch: "main",
          },
        }),
      );

      setStatus("bootstrapping");
      await deleteReadmeIfPresent(giteaClient, owner, repoSlug);

      setStatus("protecting");
      await createMainBranchProtection(giteaClient, owner, repoSlug);

      setStatus("creating-branch");
      const branchName = buildUploadBranchName(repoSlug, owner, contentHash8);
      await createUploadBranch({
        client: giteaClient,
        owner,
        repo: repoSlug,
        branchName,
        from: "main",
      });

      setStatus("committing");
      const commitMessage = buildUploadCommitMessage({
        docSlug: repoSlug,
        canonicalFile: canonicalFileName,
        sourceFilename: selectedFile.name,
        uploadBranch: branchName,
        uploaderSlug: owner,
        fileHashSha256,
      });

      await commitBinaryFile({
        client: giteaClient,
        owner,
        repo: repoSlug,
        branch: branchName,
        filePath: canonicalFileName,
        base64Content,
        message: commitMessage,
      });

      setStatus("opening-pr");
      const prTitle = `Upload v1: ${displayDocumentName}`;
      const prBody = [
        "Automated upload from Bindersnap file vault.",
        "",
        `Source file: ${selectedFile.name}`,
        `Document: ${trimmedName}`,
        `Uploaded by: ${owner}`,
        `File hash (SHA-256): ${fileHashSha256}`,
      ].join("\n");

      await createPullRequest({
        client: giteaClient,
        owner,
        repo: repoSlug,
        title: prTitle,
        head: branchName,
        base: "main",
        body: prBody,
      });

      setStatus("done");
      onSuccess(owner, repoSlug);
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

            <div className="create-document-preview">
              <div>
                <span className="create-document-preview-label">
                  Repository Slug
                </span>
                <p className="create-document-preview-value">
                  {repoSlugValid
                    ? repoSlug
                    : "Enter a name to generate the repo slug"}
                </p>
              </div>
              <div>
                <span className="create-document-preview-label">
                  Canonical File
                </span>
                <p className="create-document-preview-value">
                  {canonicalFileName}
                </p>
              </div>
            </div>

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
                Checking repository name...
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
                Creating private repository...
              </li>
              <li
                className={
                  status === "bootstrapping"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Removing bootstrap README...
              </li>
              <li
                className={
                  status === "protecting"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Protecting main branch...
              </li>
              <li
                className={
                  status === "creating-branch"
                    ? "upload-step upload-step-active"
                    : "upload-step"
                }
              >
                Creating upload branch...
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
                Opening pull request...
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
