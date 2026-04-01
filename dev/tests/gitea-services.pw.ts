import { expect, test } from '@playwright/test';

import {
  createAuthenticatedClient,
  getStoredToken,
  storeToken,
  validateToken,
} from '../../src/services/gitea/auth';
import {
  commitDocument,
  fetchDocument,
  fetchDocumentAtSha,
  listDocumentCommits,
} from '../../src/services/gitea/documents';
import {
  type ApprovalState,
  getPullRequestForBranch,
} from '../../src/services/gitea/pullRequests';
import { seedDevStack } from './seed';

const GITEA_URL = process.env.VITE_GITEA_URL ?? 'http://localhost:3000';
const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? 'alice';
const GITEA_ADMIN_PASS = process.env.GITEA_ADMIN_PASS ?? 'bindersnap-dev';
const TOKEN = process.env.VITE_GITEA_TOKEN ?? '';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  } as Storage;
}

async function waitForExpectedState(): Promise<void> {
  const client = createAuthenticatedClient(GITEA_URL);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pullRequest = await getPullRequestForBranch({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      branch: 'feature/q2-amendments',
    });

    if (pullRequest?.approvalState === 'changes_requested') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Timed out waiting for seeded pull request state.');
}

test.describe('Gitea service wrappers against the live dev stack', () => {
  test.beforeAll(async ({ request }) => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: createMemoryStorage(),
    });

    const preferredToken = TOKEN.trim();
    const usePreferredToken = preferredToken.length > 0 && (await validateToken(GITEA_URL, preferredToken).then(() => true).catch(() => false));

    const seedResult = await seedDevStack({
      baseUrl: GITEA_URL,
      adminUser: GITEA_ADMIN_USER,
      adminPass: GITEA_ADMIN_PASS,
      createToken: !usePreferredToken,
      tokenNamePrefix: 'bindersnap-services',
      log: () => {
        // Intentionally silent: avoid leaking setup noise or secrets into test output.
      },
    });

    const resolvedToken = usePreferredToken ? preferredToken : seedResult.token;
    if (!resolvedToken) {
      throw new Error('Unable to resolve a valid Gitea token for integration tests.');
    }

    storeToken(resolvedToken);
    expect(getStoredToken()).toBe(resolvedToken);

    await waitForExpectedState();
  });

  test('validateToken returns the seeded admin user', async () => {
    const token = getStoredToken();
    expect(token).toBeTruthy();

    const user = await validateToken(GITEA_URL, token!);
    expect(user.login).toBe('alice');
  });

  test('createAuthenticatedClient reads the token from sessionStorage', async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const { data: user } = await client.user.userGetCurrent();

    expect(user.login).toBe('alice');
  });

  test('listDocumentCommits and fetchDocumentAtSha read the seeded draft document', async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const commits = await listDocumentCommits({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
    });

    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]).toHaveProperty('sha');
    expect(commits[0]).toHaveProperty('message');

    const doc = await fetchDocumentAtSha({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      sha: commits[0].sha,
    });

    expect(doc.type).toBe('doc');
    expect(Array.isArray(doc.content)).toBe(true);
  });

  test('fetchDocument returns content and file sha from main branch', async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const result = await fetchDocument({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      branch: 'main',
    });

    expect(result.content.type).toBe('doc');
    expect(Array.isArray(result.content.content)).toBe(true);
    expect(typeof result.sha).toBe('string');
    expect(result.sha.length).toBeGreaterThan(0);
  });

  test('fetchDocument then commitDocument round-trips via sha tracking', async () => {
    const client = createAuthenticatedClient(GITEA_URL);

    // Fetch so we have the current SHA.
    const initial = await fetchDocument({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      branch: 'main',
    });

    // Commit an update using the SHA to avoid 409.
    const updated = { ...initial.content, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Integration test update' }] }] };
    const writeResult = await commitDocument({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      branch: 'main',
      message: 'test: fetchDocument round-trip',
      sha: initial.sha,
      content: updated,
    });

    expect(typeof writeResult.sha).toBe('string');
    expect(writeResult.sha.length).toBeGreaterThan(0);

    // Fetch again to confirm content was updated.
    const refetched = await fetchDocument({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      branch: 'main',
    });
    expect(refetched.content).toEqual(updated);
    // SHA should now be different (new commit).
    expect(refetched.sha).not.toBe(initial.sha);
  });

  test('getPullRequestForBranch returns approval state for the seeded review workflow', async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const pullRequest = await getPullRequestForBranch({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      branch: 'feature/q2-amendments',
    });

    expect(pullRequest).not.toBeNull();
    const approvalState: ApprovalState = pullRequest!.approvalState;
    expect(approvalState).toBe('changes_requested');
    expect(pullRequest?.number).toBeGreaterThan(0);
  });
});
