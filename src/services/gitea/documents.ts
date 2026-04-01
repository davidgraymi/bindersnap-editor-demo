import type { JSONContent } from '@tiptap/core';

import { GiteaApiError, type GiteaClient } from './client';

export type ProseMirrorJSON = JSONContent;

export interface CommitDocumentParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  filePath: string;
  branch: string;
  content: ProseMirrorJSON;
  message: string;
  sha?: string;
}

export interface FetchDocumentAtShaParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  filePath: string;
  sha: string;
}

export interface ListDocumentCommitsParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  filePath: string;
  page?: number;
  limit?: number;
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface DocumentWriteResult {
  sha: string;
  fileSha: string | null;
}

type RawProseMirrorCandidate = {
  type?: unknown;
  content?: unknown;
};

function isProseMirrorDocument(value: unknown): value is ProseMirrorJSON {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as RawProseMirrorCandidate;
  return candidate.type === 'doc' && Array.isArray(candidate.content);
}

function assertProseMirrorDocument(value: unknown, filePath: string): ProseMirrorJSON {
  if (isProseMirrorDocument(value)) {
    return value;
  }

  throw new GiteaApiError(0, `Document at ${filePath} is not valid ProseMirror JSON.`);
}

function toBase64(value: string): string {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  return Buffer.from(value, 'utf8').toString('base64');
}

function toGiteaApiError(error: unknown): GiteaApiError {
  if (error instanceof GiteaApiError) {
    return error;
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;

  const message = readErrorMessage(error);
  return new GiteaApiError(Number.isFinite(status) ? status : 0, message);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const responseLike = error as {
      error?: unknown;
      message?: unknown;
      statusText?: unknown;
    };

    if (typeof responseLike.message === 'string' && responseLike.message.trim() !== '') {
      return responseLike.message;
    }

    if (typeof responseLike.error === 'string' && responseLike.error.trim() !== '') {
      return responseLike.error;
    }

    if (
      typeof responseLike.error === 'object' &&
      responseLike.error !== null &&
      'message' in responseLike.error &&
      typeof (responseLike.error as { message?: unknown }).message === 'string'
    ) {
      return (responseLike.error as { message: string }).message;
    }

    if (typeof responseLike.statusText === 'string' && responseLike.statusText.trim() !== '') {
      return responseLike.statusText;
    }
  }

  return 'Gitea request failed.';
}

async function readRawResponseBody(raw: unknown): Promise<string> {
  if (typeof raw === 'string') {
    return raw;
  }

  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(raw);
  }

  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new TextDecoder().decode(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  if (raw instanceof Blob) {
    return raw.text();
  }

  if (
    typeof raw === 'object' &&
    raw !== null &&
    'text' in raw &&
    typeof (raw as { text?: unknown }).text === 'function'
  ) {
    return (raw as { text: () => Promise<string> }).text();
  }

  if (
    typeof raw === 'object' &&
    raw !== null &&
    'arrayBuffer' in raw &&
    typeof (raw as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  ) {
    const buffer = await (raw as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  throw new Error('Gitea raw file response was not readable text.');
}

export async function commitDocument(params: CommitDocumentParams): Promise<DocumentWriteResult> {
  const { client, owner, repo, filePath, branch, content, message, sha } = params;
  const encodedContent = toBase64(JSON.stringify(content));

  try {
    const response = sha
      ? await client.repos.repoUpdateFile(owner, repo, filePath, {
          content: encodedContent,
          message,
          branch,
          sha,
        })
      : await client.repos.repoCreateFile(owner, repo, filePath, {
          content: encodedContent,
          message,
          branch,
        });

    return {
      sha: response.data.commit?.sha ?? '',
      fileSha: response.data.content?.sha ?? null,
    };
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function fetchDocumentAtSha(params: FetchDocumentAtShaParams): Promise<ProseMirrorJSON> {
  const { client, owner, repo, filePath, sha } = params;

  try {
    const response = await client.repos.repoGetRawFileOrLfs(owner, repo, filePath, { ref: sha });
    const rawBody = response.data;

    // Some gitea-js runtimes deserialize JSON responses for us.
    if (typeof rawBody === 'object' && rawBody !== null) {
      return assertProseMirrorDocument(rawBody, filePath);
    }

    const rawText = await readRawResponseBody(rawBody);
    const parsed = JSON.parse(rawText) as unknown;
    return assertProseMirrorDocument(parsed, filePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new GiteaApiError(0, `Unable to parse document JSON at ${filePath}.`);
    }

    throw toGiteaApiError(error);
  }
}

export interface FetchDocumentParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  filePath: string;
  branch?: string;
}

export interface FetchDocumentResult {
  content: ProseMirrorJSON;
  sha: string;
}

/**
 * Fetch a document's current content and its file SHA (needed for subsequent updates).
 */
export async function fetchDocument(params: FetchDocumentParams): Promise<FetchDocumentResult> {
  const { client, owner, repo, filePath, branch } = params;

  try {
    const response = await client.repos.repoGetContents(owner, repo, filePath, { ref: branch });
    const file = response.data as { content?: string; sha?: string; type?: string };

    if (file.type !== 'file' || !file.content) {
      throw new GiteaApiError(0, `Path ${filePath} is not a file.`);
    }

    const decoded = atob(file.content.replace(/\n/g, ''));
    const parsed = JSON.parse(decoded) as unknown;
    return {
      content: assertProseMirrorDocument(parsed, filePath),
      sha: file.sha ?? '',
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new GiteaApiError(0, `Unable to parse document JSON at ${filePath}.`);
    }
    throw toGiteaApiError(error);
  }
}

export async function listDocumentCommits(params: ListDocumentCommitsParams): Promise<CommitSummary[]> {
  const { client, owner, repo, filePath, page, limit } = params;

  try {
    const response = await client.repos.repoGetAllCommits(owner, repo, {
      path: filePath,
      page,
      limit,
    });

    return response.data.map((commit) => ({
      sha: commit.sha ?? '',
      message: commit.commit?.message ?? '',
      author: commit.commit?.author?.name ?? commit.author?.full_name ?? commit.author?.login ?? 'Unknown',
      timestamp: commit.commit?.author?.date ?? commit.created ?? '',
    }));
  } catch (error) {
    throw toGiteaApiError(error);
  }
}
