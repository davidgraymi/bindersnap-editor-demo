import { GiteaApiError, type GiteaClient } from './client';
import { createPullRequest } from './pullRequests';
import type { PullRequestWithApprovalState } from './pullRequests';

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

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildUploadBranchName(
  docSlug: string,
  uploaderSlug: string,
  contentHash8: string,
  now: Date = new Date()
): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const date = `${year}${month}${day}`;
  const time = `${hours}${minutes}${seconds}Z`;
  return `upload/${docSlug}/${date}/${time}-${uploaderSlug}-${contentHash8}`;
}

export function buildUploadCommitMessage(params: UploadCommitMessageParams): string {
  const { docSlug, canonicalFile, sourceFilename, uploadBranch, uploaderSlug, fileHashSha256 } = params;
  return [
    `Upload: ${sourceFilename}`,
    '',
    `Bindersnap-Document-Id: ${docSlug}`,
    `Bindersnap-Canonical-File: ${canonicalFile}`,
    `Bindersnap-Source-Filename: ${sourceFilename}`,
    `Bindersnap-Upload-Branch: ${uploadBranch}`,
    `Bindersnap-Uploaded-By: ${uploaderSlug}`,
    `Bindersnap-File-Hash-SHA256: ${fileHashSha256}`,
  ].join('\n');
}

function toGiteaApiError(error: unknown): GiteaApiError {
  if (error instanceof GiteaApiError) {
    return error;
  }
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Gitea request failed.';
  return new GiteaApiError(Number.isFinite(status) ? status : 0, message);
}

export async function createUploadBranch(params: CreateUploadBranchParams): Promise<void> {
  const { client, owner, repo, branchName, from = 'main' } = params;
  try {
    await client.repos.repoCreateBranch(owner, repo, {
      new_branch_name: branchName,
      old_branch_name: from,
    });
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function commitBinaryFile(params: CommitBinaryFileParams): Promise<{ sha: string }> {
  const { client, owner, repo, branch, filePath, base64Content, message } = params;
  try {
    const response = await client.repos.repoCreateFile(owner, repo, filePath, {
      content: base64Content,
      message,
      branch,
    });
    return { sha: response.data.commit?.sha ?? '' };
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file as base64.'));
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadFile(params: UploadFileParams): Promise<UploadResult> {
  const { client, owner, repo, file, docSlug, uploaderSlug, nextVersion, baseBranch = 'main' } = params;

  // Client-side validation
  const validation = validateUploadFile(file);
  if (!validation.valid) {
    throw new GiteaApiError(0, validation.reason ?? 'Invalid file.');
  }

  // Compute hash
  const fullHash = await computeFileHash(file);
  const contentHash8 = fullHash.slice(0, 8);

  // Read as base64
  const base64Content = await readFileAsBase64(file);

  // Build names
  const branchName = buildUploadBranchName(docSlug, uploaderSlug, contentHash8);
  const ext = file.name.split('.').pop()!.toLowerCase();
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
  await createUploadBranch({ client, owner, repo, branchName, from: baseBranch });

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
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const prTitle = `Upload v${nextVersion}: ${docTitle}`;
  const prBody = [
    `Automated upload from Bindersnap file vault.`,
    ``,
    `Source file: ${file.name}`,
    `Document: ${docSlug}`,
    `Uploaded by: ${uploaderSlug}`,
    `File hash (SHA-256): ${fullHash}`,
  ].join('\n');

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
