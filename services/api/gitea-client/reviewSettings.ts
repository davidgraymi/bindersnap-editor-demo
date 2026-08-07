import { GiteaApiError, unwrap, type GiteaClient } from "./client";

/**
 * Per-document review policy that Gitea's branch protection cannot express.
 *
 * Gitea has no equivalent of GitHub's "require conversation resolution", so
 * `blockOnUnresolvedThreads` is enforced by the BFF at publish time. It is
 * stored as a committed file rather than repo metadata for a reason: changing
 * the approval policy of a controlled document is itself an auditable event,
 * and a commit records who changed it, when, and to what — for free.
 *
 * The companion setting, "reset approvals when a new version is uploaded",
 * maps onto Gitea's native `dismiss_stale_approvals` branch protection flag
 * and lives there instead, so that Gitea enforces it during merge rather than
 * the BFF re-implementing it. Both are surfaced as one settings panel.
 *
 * The file lives on a dedicated `bindersnap-config` branch rather than on
 * `main`. Every document repo protects `main` with `enable_push: false`
 * (see `createMainBranchProtection`), so a settings toggle cannot commit
 * there without either opening a pull request for a checkbox or punching a
 * hole in the protection that exists to guarantee the document's integrity.
 * A side branch keeps full commit history for the policy while leaving the
 * document's own branch protection untouched.
 *
 * It also lives under a dot-directory so it can never be mistaken for the
 * document itself: `inferStoredDocumentFileName` only considers entries of
 * type `file` at the repo root, and this is a directory on another branch.
 */

export const REVIEW_SETTINGS_PATH = ".bindersnap/config.json";
export const REVIEW_SETTINGS_BRANCH = "bindersnap-config";

export interface ReviewSettings {
  /** Refuse to publish while any review thread is still unresolved. */
  blockOnUnresolvedThreads: boolean;
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  blockOnUnresolvedThreads: false,
};

interface StoredConfig {
  version: number;
  review: ReviewSettings;
}

export interface GetReviewSettingsParams {
  client: GiteaClient;
  owner: string;
  repo: string;
}

export interface UpdateReviewSettingsParams extends GetReviewSettingsParams {
  settings: Partial<ReviewSettings>;
  actor: string;
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function parseReviewSettings(raw: string): ReviewSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed config must not make the document unreadable. Fall back to
    // defaults, which are the permissive (non-blocking) option, matching how
    // an absent file behaves.
    return { ...DEFAULT_REVIEW_SETTINGS };
  }

  const review = (parsed as { review?: unknown })?.review;
  if (typeof review !== "object" || review === null) {
    return { ...DEFAULT_REVIEW_SETTINGS };
  }

  const candidate = review as Record<string, unknown>;
  return {
    blockOnUnresolvedThreads:
      typeof candidate.blockOnUnresolvedThreads === "boolean"
        ? candidate.blockOnUnresolvedThreads
        : DEFAULT_REVIEW_SETTINGS.blockOnUnresolvedThreads,
  };
}

export function serializeReviewSettings(settings: ReviewSettings): string {
  const config: StoredConfig = { version: 1, review: settings };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function readSettingsFile(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<{ settings: ReviewSettings; sha: string | null }> {
  const { data, error, response } = await client.GET(
    "/repos/{owner}/{repo}/contents/{filepath}",
    {
      params: {
        path: { owner, repo, filepath: REVIEW_SETTINGS_PATH },
        query: { ref: REVIEW_SETTINGS_BRANCH },
      },
    },
  );

  // 404 covers both "no config branch yet" and "branch exists, no file yet".
  if (response.status === 404) {
    return { settings: { ...DEFAULT_REVIEW_SETTINGS }, sha: null };
  }

  if (error !== undefined || data === undefined) {
    throw new GiteaApiError(
      response.status,
      "Unable to read document review settings.",
    );
  }

  const file = data as { content?: string; sha?: string };
  if (!file.content) {
    return { settings: { ...DEFAULT_REVIEW_SETTINGS }, sha: file.sha ?? null };
  }

  return {
    settings: parseReviewSettings(decodeBase64(file.content)),
    sha: file.sha ?? null,
  };
}

/**
 * Create the config branch off main the first time a policy is saved.
 * Tolerates a concurrent creator (409/422) rather than failing the save.
 */
async function ensureConfigBranch(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<void> {
  const existing = await client.GET("/repos/{owner}/{repo}/branches/{branch}", {
    params: { path: { owner, repo, branch: REVIEW_SETTINGS_BRANCH } },
  });

  if (existing.response.ok) {
    return;
  }

  if (existing.response.status !== 404) {
    throw new GiteaApiError(
      existing.response.status,
      "Unable to read the document configuration branch.",
    );
  }

  const created = await client.POST("/repos/{owner}/{repo}/branches", {
    params: { path: { owner, repo } },
    body: {
      new_branch_name: REVIEW_SETTINGS_BRANCH,
      old_ref_name: "main",
    },
  });

  if (
    created.response.ok ||
    created.response.status === 409 ||
    created.response.status === 422
  ) {
    return;
  }

  throw new GiteaApiError(
    created.response.status,
    "Unable to create the document configuration branch.",
  );
}

export async function getReviewSettings(
  params: GetReviewSettingsParams,
): Promise<ReviewSettings> {
  const { client, owner, repo } = params;
  const { settings } = await readSettingsFile(client, owner, repo);
  return settings;
}

export async function updateReviewSettings(
  params: UpdateReviewSettingsParams,
): Promise<ReviewSettings> {
  const { client, owner, repo, settings, actor } = params;
  const { settings: current, sha } = await readSettingsFile(
    client,
    owner,
    repo,
  );

  const next: ReviewSettings = {
    blockOnUnresolvedThreads:
      settings.blockOnUnresolvedThreads ?? current.blockOnUnresolvedThreads,
  };

  if (next.blockOnUnresolvedThreads === current.blockOnUnresolvedThreads) {
    return current;
  }

  const message = `Update review policy (${actor})`;
  const content = encodeBase64(serializeReviewSettings(next));

  await ensureConfigBranch(client, owner, repo);

  if (sha) {
    await unwrap(
      client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
        params: { path: { owner, repo, filepath: REVIEW_SETTINGS_PATH } },
        body: { content, message, branch: REVIEW_SETTINGS_BRANCH, sha },
      }),
    );
  } else {
    await unwrap(
      client.POST("/repos/{owner}/{repo}/contents/{filepath}", {
        params: { path: { owner, repo, filepath: REVIEW_SETTINGS_PATH } },
        body: { content, message, branch: REVIEW_SETTINGS_BRANCH },
      }),
    );
  }

  return next;
}
