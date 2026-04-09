import { unwrap, type GiteaClient } from "./client";
import { createPullRequest } from "./pullRequests";
import type { PullRequestWithApprovalState } from "./pullRequests";
import {
  bootstrapEmptyMainBranch,
  createMainBranchProtection,
  createPrivateCurrentUserRepo,
} from "./repos";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB

export interface UploadValidationResult {
  valid: boolean;
  reason?: string;
}

export interface UploadCommitMessageParams {
  docSlug: string;
  canonicalFile: string;
  sourceFilename: string;
  uploadBranch: string;
  uploaderSlug: string;
  fileHashSha256: string;
}

export interface CreateUploadBranchParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  branchName: string;
  from?: string;
}

export interface CommitBinaryFileParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  base64Content: string;
  message: string;
}

export interface UploadFileParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  file: File;
  docSlug: string;
  uploaderSlug: string;
  nextVersion: number;
  baseBranch?: string;
}

export interface UploadResult {
  prNumber: number;
  prTitle: string;
  branchName: string;
  commitSha: string;
}

export interface InitialDocumentUploadParams {
  client: GiteaClient;
  repoName: string;
  file: File;
  uploaderSlug: string;
  nextVersion: number;
  requiredApprovals?: number;
  description?: string;
  onProgress?: (step: InitialDocumentUploadStep) => void;
}

export interface InitialDocumentUploadResult extends UploadResult {
  owner: string;
  repo: string;
  canonicalFile: string;
}

export type InitialDocumentUploadStep =
  | "hashing"
  | "creating-repo"
  | "bootstrapping"
  | "protecting"
  | "creating-branch"
  | "committing"
  | "opening-pr";

export function validateUploadFile(file: File): UploadValidationResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMiB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      reason: `File is too large (${sizeMiB} MiB). Maximum allowed size is 25 MiB.`,
    };
  }
  return { valid: true };
}

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
}

export function buildCanonicalDocumentFileName(extension: string): string {
  const normalized = extension.replace(/^\.+/, "").trim().toLowerCase();
  return normalized === "" ? "document" : `document.${normalized}`;
}

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildUploadBranchName(
  docSlug: string,
  uploaderSlug: string,
  contentHash8: string,
  now: Date = new Date(),
): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  const date = `${year}${month}${day}`;
  const time = `${hours}${minutes}${seconds}Z`;
  return `upload/${docSlug}/${date}/${time}-${uploaderSlug}-${contentHash8}`;
}

export function buildUploadCommitMessage(
  params: UploadCommitMessageParams,
): string {
  const {
    docSlug,
    canonicalFile,
    sourceFilename,
    uploadBranch,
    uploaderSlug,
    fileHashSha256,
  } = params;
  return [
    `Upload: ${sourceFilename}`,
    "",
    `Bindersnap-Document-Id: ${docSlug}`,
    `Bindersnap-Canonical-File: ${canonicalFile}`,
    `Bindersnap-Source-Filename: ${sourceFilename}`,
    `Bindersnap-Upload-Branch: ${uploadBranch}`,
    `Bindersnap-Uploaded-By: ${uploaderSlug}`,
    `Bindersnap-File-Hash-SHA256: ${fileHashSha256}`,
  ].join("\n");
}

function humanizeRepositoryName(repoName: string): string {
  return repoName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function createUploadBranch(
  params: CreateUploadBranchParams,
): Promise<void> {
  const { client, owner, repo, branchName, from = "main" } = params;

  await unwrap(
    client.POST("/repos/{owner}/{repo}/branches", {
      params: { path: { owner, repo } },
      body: {
        new_branch_name: branchName,
        old_branch_name: from,
      },
    }),
  );
}

export async function commitBinaryFile(
  params: CommitBinaryFileParams,
): Promise<{ sha: string }> {
  const { client, owner, repo, branch, filePath, base64Content, message } =
    params;

  // Check if the file already exists on this branch so we can update (PUT)
  // instead of create (POST). Gitea requires the existing file's SHA for updates.
  let existingSha: string | undefined;
  try {
    const existing = await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner, repo, filepath: filePath },
          query: { ref: branch },
        },
      }),
    );
    if (existing && !Array.isArray(existing) && existing.sha) {
      existingSha = existing.sha;
    }
  } catch {
    // File doesn't exist on this branch — will use POST (create)
  }

  if (existingSha) {
    const result = await unwrap(
      client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
        params: { path: { owner, repo, filepath: filePath } },
        body: {
          content: base64Content,
          message,
          branch,
          sha: existingSha,
        },
      }),
    );
    return { sha: result.commit?.sha ?? "" };
  }

  const result = await unwrap(
    client.POST("/repos/{owner}/{repo}/contents/{filepath}", {
      params: { path: { owner, repo, filepath: filePath } },
      body: {
        content: base64Content,
        message,
        branch,
      },
    }),
  );

  return { sha: result.commit?.sha ?? "" };
}

export async function createInitialDocumentUpload(
  params: InitialDocumentUploadParams,
): Promise<InitialDocumentUploadResult> {
  const {
    client,
    repoName,
    file,
    uploaderSlug,
    nextVersion,
    requiredApprovals = 1,
    description,
    onProgress,
  } = params;

  const validation = validateUploadFile(file);
  if (!validation.valid) {
    const { GiteaApiError } = await import("./client");
    throw new GiteaApiError(0, validation.reason ?? "Invalid file.");
  }

  onProgress?.("hashing");
  const fullHash = await computeFileHash(file);
  const contentHash8 = fullHash.slice(0, 8);
  const base64Content = await readFileAsBase64(file);
  const extension = getFileExtension(file.name);
  const canonicalFile = buildCanonicalDocumentFileName(extension);
  const branchName = buildUploadBranchName(
    repoName,
    uploaderSlug,
    contentHash8,
  );

  onProgress?.("creating-repo");
  const createdRepo = await createPrivateCurrentUserRepo({
    client,
    name: repoName,
    description,
  });

  const owner = createdRepo.owner?.login ?? "";
  if (owner.trim() === "") {
    throw new Error(
      "Gitea did not return an owner for the created repository.",
    );
  }

  onProgress?.("bootstrapping");
  await bootstrapEmptyMainBranch({
    client,
    owner,
    repo: repoName,
  });

  onProgress?.("protecting");
  await createMainBranchProtection({
    client,
    owner,
    repo: repoName,
    requiredApprovals,
  });

  onProgress?.("creating-branch");
  await createUploadBranch({
    client,
    owner,
    repo: repoName,
    branchName,
    from: "main",
  });

  const commitMessage = buildUploadCommitMessage({
    docSlug: repoName,
    canonicalFile,
    sourceFilename: file.name,
    uploadBranch: branchName,
    uploaderSlug,
    fileHashSha256: fullHash,
  });

  onProgress?.("committing");
  const { sha: commitSha } = await commitBinaryFile({
    client,
    owner,
    repo: repoName,
    branch: branchName,
    filePath: canonicalFile,
    base64Content,
    message: commitMessage,
  });

  const prTitle = `Upload v${nextVersion}: ${humanizeRepositoryName(repoName)}`;
  const prBody = [
    `Automated upload from Bindersnap file vault.`,
    ``,
    `Source file: ${file.name}`,
    `Document: ${repoName}`,
    `Uploaded by: ${uploaderSlug}`,
    `File hash (SHA-256): ${fullHash}`,
  ].join("\n");

  onProgress?.("opening-pr");
  const pr = await createPullRequest({
    client,
    owner,
    repo: repoName,
    title: prTitle,
    head: branchName,
    base: "main",
    body: prBody,
  });

  return {
    owner,
    repo: repoName,
    canonicalFile,
    prNumber: pr.number ?? 0,
    prTitle,
    branchName,
    commitSha,
  };
}

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

export async function uploadFile(
  params: UploadFileParams,
): Promise<UploadResult> {
  const {
    client,
    owner,
    repo,
    file,
    docSlug,
    uploaderSlug,
    nextVersion,
    baseBranch = "main",
  } = params;

  // Client-side validation
  const validation = validateUploadFile(file);
  if (!validation.valid) {
    const { GiteaApiError } = await import("./client");
    throw new GiteaApiError(0, validation.reason ?? "Invalid file.");
  }

  // Compute hash
  const fullHash = await computeFileHash(file);
  const contentHash8 = fullHash.slice(0, 8);

  // Read as base64
  const base64Content = await readFileAsBase64(file);

  // Build names
  const branchName = buildUploadBranchName(docSlug, uploaderSlug, contentHash8);
  const ext = file.name.split(".").pop()!.toLowerCase();
  const canonicalFile = `${docSlug}.${ext}`;

  // Build commit message with ADR 0001 trailers
  const commitMessage = buildUploadCommitMessage({
    docSlug,
    canonicalFile,
    sourceFilename: file.name,
    uploadBranch: branchName,
    uploaderSlug,
    fileHashSha256: fullHash,
  });

  // Create branch
  await createUploadBranch({
    client,
    owner,
    repo,
    branchName,
    from: baseBranch,
  });

  // Commit file
  const { sha: commitSha } = await commitBinaryFile({
    client,
    owner,
    repo,
    branch: branchName,
    filePath: canonicalFile,
    base64Content,
    message: commitMessage,
  });

  // Build PR title/body
  const docTitle = docSlug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const prTitle = `Upload v${nextVersion}: ${docTitle}`;
  const prBody = [
    `Automated upload from Bindersnap file vault.`,
    ``,
    `Source file: ${file.name}`,
    `Document: ${docSlug}`,
    `Uploaded by: ${uploaderSlug}`,
    `File hash (SHA-256): ${fullHash}`,
  ].join("\n");

  // Open PR
  const pr = await createPullRequest({
    client,
    owner,
    repo,
    title: prTitle,
    head: branchName,
    base: baseBranch,
    body: prBody,
  });

  return {
    prNumber: pr.number ?? 0,
    prTitle,
    branchName,
    commitSha,
  };
}
