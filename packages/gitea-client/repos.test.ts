import { afterEach, expect, mock, test } from 'bun:test';
import type { Repository, Tag } from 'gitea-js';

import { GiteaApiError, type GiteaClient } from './client';

const repoSearchMock = mock(async () => ({
  data: {
    data: [
      {
        id: 1,
        name: 'quarterly-report',
        full_name: 'alice/quarterly-report',
        description: 'Q2 financial report',
        updated_at: '2026-03-15T10:00:00Z',
        owner: { login: 'alice' },
      },
      {
        id: 2,
        name: 'product-spec',
        full_name: 'bob/product-spec',
        description: 'Product specification document',
        updated_at: '2026-03-20T14:30:00Z',
        owner: { login: 'bob' },
      },
    ] as Repository[],
  },
}));

const repoListTagsMock = mock(async () => ({
  data: [
    {
      name: 'doc/v0001',
      commit: {
        sha: 'abc123',
        created: '2026-03-01T09:00:00Z',
      },
    },
    {
      name: 'doc/v0003',
      commit: {
        sha: 'def456',
        created: '2026-03-15T11:00:00Z',
      },
    },
    {
      name: 'doc/v0002',
      commit: {
        sha: 'ghi789',
        created: '2026-03-10T10:00:00Z',
      },
    },
    {
      name: 'release-v1.0.0',
      commit: {
        sha: 'jkl012',
        created: '2026-03-20T12:00:00Z',
      },
    },
  ] as Tag[],
}));

const client = {
  repos: {
    repoSearch: repoSearchMock,
    repoListTags: repoListTagsMock,
  },
} as unknown as GiteaClient;

afterEach(() => {
  repoSearchMock.mockReset();
  repoListTagsMock.mockReset();

  repoSearchMock.mockImplementation(async () => ({
    data: {
      data: [
        {
          id: 1,
          name: 'quarterly-report',
          full_name: 'alice/quarterly-report',
          description: 'Q2 financial report',
          updated_at: '2026-03-15T10:00:00Z',
          owner: { login: 'alice' },
        },
        {
          id: 2,
          name: 'product-spec',
          full_name: 'bob/product-spec',
          description: 'Product specification document',
          updated_at: '2026-03-20T14:30:00Z',
          owner: { login: 'bob' },
        },
      ] as Repository[],
    },
  }));

  repoListTagsMock.mockImplementation(async () => ({
    data: [
      {
        name: 'doc/v0001',
        commit: {
          sha: 'abc123',
          created: '2026-03-01T09:00:00Z',
        },
      },
      {
        name: 'doc/v0003',
        commit: {
          sha: 'def456',
          created: '2026-03-15T11:00:00Z',
        },
      },
      {
        name: 'doc/v0002',
        commit: {
          sha: 'ghi789',
          created: '2026-03-10T10:00:00Z',
        },
      },
      {
        name: 'release-v1.0.0',
        commit: {
          sha: 'jkl012',
          created: '2026-03-20T12:00:00Z',
        },
      },
    ] as Tag[],
  }));
});

test('listWorkspaceRepos returns typed WorkspaceRepo array from API response', async () => {
  const { listWorkspaceRepos } = await import('./repos');

  const repos = await listWorkspaceRepos(client);

  expect(repoSearchMock).toHaveBeenCalledTimes(1);
  expect(repoSearchMock).toHaveBeenCalledWith({ limit: 100 });
  expect(repos).toHaveLength(2);
  expect(repos[0]).toEqual({
    id: 1,
    name: 'quarterly-report',
    full_name: 'alice/quarterly-report',
    description: 'Q2 financial report',
    updated_at: '2026-03-15T10:00:00Z',
    owner: { login: 'alice' },
  });
  expect(repos[1]).toEqual({
    id: 2,
    name: 'product-spec',
    full_name: 'bob/product-spec',
    description: 'Product specification document',
    updated_at: '2026-03-20T14:30:00Z',
    owner: { login: 'bob' },
  });
});

test('listWorkspaceRepos handles empty array', async () => {
  const { listWorkspaceRepos } = await import('./repos');

  repoSearchMock.mockImplementation(async () => ({
    data: {
      data: [] as Repository[],
    },
  }));

  const repos = await listWorkspaceRepos(client);

  expect(repos).toEqual([]);
});

test('listWorkspaceRepos handles missing data field', async () => {
  const { listWorkspaceRepos } = await import('./repos');

  repoSearchMock.mockImplementation(async () => ({
    data: {},
  }));

  const repos = await listWorkspaceRepos(client);

  expect(repos).toEqual([]);
});

test('listWorkspaceRepos throws GiteaApiError on network failure', async () => {
  const { listWorkspaceRepos } = await import('./repos');

  repoSearchMock.mockImplementation(async () => {
    throw new Error('Network error');
  });

  await expect(listWorkspaceRepos(client)).rejects.toThrow(GiteaApiError);
});

test('getLatestDocTag returns null when no tags exist', async () => {
  const { getLatestDocTag } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => ({
    data: [] as Tag[],
  }));

  const tag = await getLatestDocTag(client, 'alice', 'quarterly-report');

  expect(repoListTagsMock).toHaveBeenCalledTimes(1);
  expect(repoListTagsMock).toHaveBeenCalledWith('alice', 'quarterly-report', { limit: 100 });
  expect(tag).toBeNull();
});

test('getLatestDocTag returns null when tags exist but none match doc/v* pattern', async () => {
  const { getLatestDocTag } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => ({
    data: [
      {
        name: 'release-v1.0.0',
        commit: {
          sha: 'jkl012',
          created: '2026-03-20T12:00:00Z',
        },
      },
      {
        name: 'v2.0.0',
        commit: {
          sha: 'mno345',
          created: '2026-03-21T12:00:00Z',
        },
      },
    ] as Tag[],
  }));

  const tag = await getLatestDocTag(client, 'alice', 'quarterly-report');

  expect(tag).toBeNull();
});

test('getLatestDocTag returns tag with highest version number when multiple doc/v* tags exist', async () => {
  const { getLatestDocTag } = await import('./repos');

  const tag = await getLatestDocTag(client, 'alice', 'quarterly-report');

  expect(tag).not.toBeNull();
  expect(tag?.name).toBe('doc/v0003');
  expect(tag?.version).toBe(3);
  expect(tag?.sha).toBe('def456');
  expect(tag?.created).toBe('2026-03-15T11:00:00Z');
});

test('getLatestDocTag returns correct DocTag shape', async () => {
  const { getLatestDocTag } = await import('./repos');

  const tag = await getLatestDocTag(client, 'alice', 'quarterly-report');

  expect(tag).toEqual({
    name: 'doc/v0003',
    version: 3,
    sha: 'def456',
    created: '2026-03-15T11:00:00Z',
  });
});

test('getLatestDocTag throws GiteaApiError on network failure', async () => {
  const { getLatestDocTag } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => {
    throw new Error('Network error');
  });

  await expect(getLatestDocTag(client, 'alice', 'quarterly-report')).rejects.toThrow(GiteaApiError);
});

test('listDocTags returns empty array when no doc/v* tags exist', async () => {
  const { listDocTags } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => ({
    data: [
      {
        name: 'release-v1.0.0',
        commit: {
          sha: 'jkl012',
          created: '2026-03-20T12:00:00Z',
        },
      },
    ] as Tag[],
  }));

  const tags = await listDocTags(client, 'alice', 'quarterly-report');

  expect(tags).toEqual([]);
});

test('listDocTags returns tags sorted by version number (highest first)', async () => {
  const { listDocTags } = await import('./repos');

  const tags = await listDocTags(client, 'alice', 'quarterly-report');

  expect(tags).toHaveLength(3);
  expect(tags[0].version).toBe(3);
  expect(tags[1].version).toBe(2);
  expect(tags[2].version).toBe(1);
  expect(tags[0].name).toBe('doc/v0003');
  expect(tags[1].name).toBe('doc/v0002');
  expect(tags[2].name).toBe('doc/v0001');
});

test('listDocTags filters out non-doc/v* tags', async () => {
  const { listDocTags } = await import('./repos');

  const tags = await listDocTags(client, 'alice', 'quarterly-report');

  expect(tags).toHaveLength(3);
  expect(tags.every((tag) => tag.name.startsWith('doc/v'))).toBe(true);
  expect(tags.every((tag) => /^doc\/v\d{4}$/.test(tag.name))).toBe(true);
});

test('listDocTags throws GiteaApiError on network failure', async () => {
  const { listDocTags } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => {
    throw new Error('Network error');
  });

  await expect(listDocTags(client, 'alice', 'quarterly-report')).rejects.toThrow(GiteaApiError);
});

test('listDocTags handles empty tag array', async () => {
  const { listDocTags } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => ({
    data: [] as Tag[],
  }));

  const tags = await listDocTags(client, 'alice', 'quarterly-report');

  expect(tags).toEqual([]);
});

test('getLatestDocTag handles tags with missing commit data gracefully', async () => {
  const { getLatestDocTag } = await import('./repos');

  repoListTagsMock.mockImplementation(async () => ({
    data: [
      {
        name: 'doc/v0001',
        commit: {},
      },
      {
        name: 'doc/v0002',
      },
    ] as Tag[],
  }));

  const tag = await getLatestDocTag(client, 'alice', 'quarterly-report');

  expect(tag).not.toBeNull();
  expect(tag?.name).toBe('doc/v0002');
  expect(tag?.version).toBe(2);
  expect(tag?.sha).toBe('');
  expect(tag?.created).toBe('');
});
