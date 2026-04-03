import type { JSONContent } from "@tiptap/core";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";

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
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as RawProseMirrorCandidate;
  return candidate.type === "doc" && Array.isArray(candidate.content);
}

function assertProseMirrorDocument(
  value: unknown,
  filePath: string,
): ProseMirrorJSON {
  if (isProseMirrorDocument(value)) {
    return value;
  }

  throw new GiteaApiError(
    0,
    `Document at ${filePath} is not valid ProseMirror JSON.`,
  );
}

function toBase64(value: string): string {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  return Buffer.from(value, "utf8").toString("base64");
}

async function readRawResponseBody(raw: unknown): Promise<string> {
  if (typeof raw === "string") {
    return raw;
  }

  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(raw);
  }

  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new TextDecoder().decode(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
    );
  }

  if (raw instanceof Blob) {
    return raw.text();
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "text" in raw &&
    typeof (raw as { text?: unknown }).text === "function"
  ) {
    return (raw as { text: () => Promise<string> }).text();
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "arrayBuffer" in raw &&
    typeof (raw as { arrayBuffer?: unknown }).arrayBuffer === "function"
  ) {
    const buffer = await (
      raw as { arrayBuffer: () => Promise<ArrayBuffer> }
    ).arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  throw new Error("Gitea raw file response was not readable text.");
}

export async function commitDocument(
  params: CommitDocumentParams,
): Promise<DocumentWriteResult> {
  const { client, owner, repo, filePath, branch, content, message, sha } =
    params;
  const encodedContent = toBase64(JSON.stringify(content));

  const result = sha
    ? await unwrap(
        client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
          params: { path: { owner, repo, filepath: filePath } },
          body: {
            content: encodedContent,
            message,
            branch,
            sha,
          },
        }),
      )
    : await unwrap(
        client.POST("/repos/{owner}/{repo}/contents/{filepath}", {
          params: { path: { owner, repo, filepath: filePath } },
          body: {
            content: encodedContent,
            message,
            branch,
          },
        }),
      );

  return {
    sha: result.commit?.sha ?? "",
    fileSha: result.content?.sha ?? null,
  };
}

export async function fetchDocumentAtSha(
  params: FetchDocumentAtShaParams,
): Promise<ProseMirrorJSON> {
  const { client, owner, repo, filePath, sha } = params;

  const response = await client.GET(
    "/repos/{owner}/{repo}/raw/{filepath}",
    {
      params: {
        path: { owner, repo, filepath: filePath },
        query: { ref: sha },
      },
      parseAs: "text",
    },
  );

  if (response.error !== undefined || response.data === undefined) {
    throw new GiteaApiError(
      response.response.status,
      `Failed to fetch document at ${filePath}`,
    );
  }

  const rawBody = response.data;

  // Some runtimes may have already deserialized the response
  if (typeof rawBody === "object" && rawBody !== null) {
    return assertProseMirrorDocument(rawBody, filePath);
  }

  try {
    const rawText = await readRawResponseBody(rawBody);
    const parsed = JSON.parse(rawText) as unknown;
    return assertProseMirrorDocument(parsed, filePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new GiteaApiError(
        0,
        `Unable to parse document JSON at ${filePath}.`,
      );
    }
    throw error;
  }
}

export async function listDocumentCommits(
  params: ListDocumentCommitsParams,
): Promise<CommitSummary[]> {
  const { client, owner, repo, filePath, page, limit } = params;

  const commits = await unwrap(
    client.GET("/repos/{owner}/{repo}/commits", {
      params: {
        path: { owner, repo },
        query: { path: filePath, page, limit, stat: false, verification: false, files: false },
      },
    }),
  );

  return commits.map((commit) => ({
    sha: commit.sha ?? "",
    message: commit.commit?.message ?? "",
    author:
      commit.commit?.author?.name ??
      commit.author?.full_name ??
      commit.author?.login ??
      "Unknown",
    timestamp: commit.commit?.author?.date ?? commit.created ?? "",
  }));
}
