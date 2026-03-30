import { afterEach, expect, mock, test } from 'bun:test';
import type { Commit, FileResponse } from 'gitea-js';

import type { GiteaClient } from './client';

const repoCreateFileMock = mock(async () => ({
  data: {
    commit: {
      sha: 'create-sha',
    },
    content: {
      sha: 'file-create-sha',
    },
  } as FileResponse,
}));

const repoUpdateFileMock = mock(async () => ({
  data: {
    commit: {
      sha: 'update-sha',
    },
    content: {
      sha: 'file-update-sha',
    },
  } as FileResponse,
}));

const repoGetRawFileOrLfsMock = mock(async () => ({
  data: {
    text: async () => JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }),
  },
}));

const repoGetAllCommitsMock = mock(async () => ({
  data: [
    {
      sha: 'commit-1',
      commit: {
        message: 'seed: add draft document',
        author: {
          name: 'Alice Admin',
          date: '2026-03-30T11:00:00Z',
        },
      },
    },
    {
      sha: 'commit-2',
      commit: {
        message: 'seed: update draft document',
        author: {
          name: 'Bob Reviewer',
          date: '2026-03-30T12:00:00Z',
        },
      },
    },
  ] as Commit[],
}));

const client = {
  repos: {
    repoCreateFile: repoCreateFileMock,
    repoUpdateFile: repoUpdateFileMock,
    repoGetRawFileOrLfs: repoGetRawFileOrLfsMock,
    repoGetAllCommits: repoGetAllCommitsMock,
  },
} as unknown as GiteaClient;

afterEach(() => {
  repoCreateFileMock.mockReset();
  repoUpdateFileMock.mockReset();
  repoGetRawFileOrLfsMock.mockReset();
  repoGetAllCommitsMock.mockReset();

  repoCreateFileMock.mockImplementation(async () => ({
    data: {
      commit: { sha: 'create-sha' },
      content: { sha: 'file-create-sha' },
    } as FileResponse,
  }));

  repoUpdateFileMock.mockImplementation(async () => ({
    data: {
      commit: { sha: 'update-sha' },
      content: { sha: 'file-update-sha' },
    } as FileResponse,
  }));

  repoGetRawFileOrLfsMock.mockImplementation(async () => ({
    data: {
      text: async () => JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      }),
    },
  }));

  repoGetAllCommitsMock.mockImplementation(async () => ({
    data: [
      {
        sha: 'commit-1',
        commit: {
          message: 'seed: add draft document',
          author: { name: 'Alice Admin', date: '2026-03-30T11:00:00Z' },
        },
      },
      {
        sha: 'commit-2',
        commit: {
          message: 'seed: update draft document',
          author: { name: 'Bob Reviewer', date: '2026-03-30T12:00:00Z' },
        },
      },
    ] as Commit[],
  }));
});

test('commitDocument creates a file when sha is absent', async () => {
  const { commitDocument } = await import('./documents');

  const result = await commitDocument({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    filePath: 'documents/draft.json',
    branch: 'main',
    message: 'seed: add draft document',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    },
  });

  expect(repoCreateFileMock).toHaveBeenCalledTimes(1);
  expect(repoCreateFileMock).toHaveBeenCalledWith('alice', 'quarterly-report', 'documents/draft.json', {
    content: Buffer.from(
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      }),
      'utf8',
    ).toString('base64'),
    message: 'seed: add draft document',
    branch: 'main',
  });

  expect(result).toEqual({
    sha: 'create-sha',
    fileSha: 'file-create-sha',
  });
});

test('commitDocument updates a file when sha is present', async () => {
  const { commitDocument } = await import('./documents');

  await commitDocument({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    filePath: 'documents/draft.json',
    branch: 'main',
    sha: 'current-sha',
    message: 'seed: update draft document',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
    },
  });

  expect(repoUpdateFileMock).toHaveBeenCalledTimes(1);
  expect(repoUpdateFileMock).toHaveBeenCalledWith('alice', 'quarterly-report', 'documents/draft.json', {
    content: Buffer.from(
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
      }),
      'utf8',
    ).toString('base64'),
    message: 'seed: update draft document',
    branch: 'main',
    sha: 'current-sha',
  });
});

test('fetchDocumentAtSha returns parsed ProseMirror JSON', async () => {
  const { fetchDocumentAtSha } = await import('./documents');

  const doc = await fetchDocumentAtSha({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    filePath: 'documents/draft.json',
    sha: 'commit-1',
  });

  expect(repoGetRawFileOrLfsMock).toHaveBeenCalledWith('alice', 'quarterly-report', 'documents/draft.json', {
    ref: 'commit-1',
  });

  expect(doc).toEqual({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
  });
});

test('fetchDocumentAtSha accepts already-parsed JSON responses', async () => {
  const { fetchDocumentAtSha } = await import('./documents');

  repoGetRawFileOrLfsMock.mockImplementation(async () => ({
    data: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From parsed object' }] }],
    },
  }));

  const doc = await fetchDocumentAtSha({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    filePath: 'documents/draft.json',
    sha: 'commit-1',
  });

  expect(doc).toEqual({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From parsed object' }] }],
  });
});

test('fetchDocumentAtSha rejects malformed parsed objects', async () => {
  const { fetchDocumentAtSha } = await import('./documents');

  repoGetRawFileOrLfsMock.mockImplementation(async () => ({
    data: {
      type: 'doc',
    },
  }));

  await expect(
    fetchDocumentAtSha({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      sha: 'commit-1',
    }),
  ).rejects.toMatchObject({
    name: 'GiteaApiError',
    message: 'Gitea raw file response was not readable text.',
  });
});

test('fetchDocumentAtSha surfaces invalid JSON as GiteaApiError', async () => {
  const { fetchDocumentAtSha } = await import('./documents');

  repoGetRawFileOrLfsMock.mockImplementation(async () => ({
    data: {
      text: async () => 'not-json',
    },
  }));

  await expect(
    fetchDocumentAtSha({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/draft.json',
      sha: 'commit-1',
    }),
  ).rejects.toMatchObject({
    name: 'GiteaApiError',
    message: 'Unable to parse document JSON at documents/draft.json.',
  });
});

test('listDocumentCommits maps commit summaries', async () => {
  const { listDocumentCommits } = await import('./documents');

  const commits = await listDocumentCommits({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    filePath: 'documents/draft.json',
    page: 1,
    limit: 10,
  });

  expect(repoGetAllCommitsMock).toHaveBeenCalledWith('alice', 'quarterly-report', {
    path: 'documents/draft.json',
    page: 1,
    limit: 10,
  });

  expect(commits).toEqual([
    {
      sha: 'commit-1',
      message: 'seed: add draft document',
      author: 'Alice Admin',
      timestamp: '2026-03-30T11:00:00Z',
    },
    {
      sha: 'commit-2',
      message: 'seed: update draft document',
      author: 'Bob Reviewer',
      timestamp: '2026-03-30T12:00:00Z',
    },
  ]);
});

test('listDocumentCommits maps API failures to GiteaApiError', async () => {
  const { listDocumentCommits } = await import('./documents');

  repoGetAllCommitsMock.mockImplementation(async () => {
    throw {
      status: 404,
      error: {
        message: 'not found',
      },
    };
  });

  await expect(
    listDocumentCommits({
      client,
      owner: 'alice',
      repo: 'quarterly-report',
      filePath: 'documents/missing.json',
    }),
  ).rejects.toMatchObject({
    name: 'GiteaApiError',
    status: 404,
    message: 'not found',
  });
});
