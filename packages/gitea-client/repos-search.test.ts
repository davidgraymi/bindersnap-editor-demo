import { expect, test, describe } from "bun:test";
import { mock } from "bun:test";
import type { components } from "./spec/gitea";
import type { GiteaClient } from "./client";
import { searchWorkspaceRepos } from "./repos";

// Use partial types for test fixtures
type Repository = Partial<
  Omit<components["schemas"]["Repository"], "owner">
> & {
  owner?: Partial<components["schemas"]["User"]>;
};

type User = Partial<components["schemas"]["User"]>;

function createMockClient(handlers: {
  GET?: Record<string, (...args: any[]) => unknown>;
}) {
  const mockGet = mock(async (path: string, init?: unknown) => {
    const handler = handlers.GET?.[path];
    if (handler) {
      const data = await handler(init);
      return {
        data,
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    return {
      data: undefined,
      error: { message: "not found" },
      response: new Response(null, { status: 404 }),
    };
  });

  return {
    GET: mockGet,
  } as unknown as GiteaClient;
}

describe("searchWorkspaceRepos", () => {
  test("searches repos with no filters", async () => {
    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
      },
      {
        id: 2,
        name: "doc-beta",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-beta",
      },
    ];

    const client = createMockClient({
      GET: {
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.q).toBeUndefined();
          expect(init?.params?.query?.uid).toBeUndefined();
          expect(init?.params?.query?.exclusive).toBeUndefined();
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({ client });

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("doc-alpha");
    expect(result[1]?.name).toBe("doc-beta");
  });

  test("searches repos with free text query", async () => {
    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
      },
    ];

    const client = createMockClient({
      GET: {
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.q).toBe("alpha");
          expect(init?.params?.query?.uid).toBeUndefined();
          expect(init?.params?.query?.exclusive).toBeUndefined();
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({ client, q: "alpha" });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("doc-alpha");
  });

  test("searches repos with ownerUsername (exclusive=true)", async () => {
    const mockUser: User = {
      id: 100,
      login: "alice",
      email: "alice@example.com",
    };

    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
      },
    ];

    const client = createMockClient({
      GET: {
        "/users/{username}": (init: any) => {
          expect(init?.params?.path?.username).toBe("alice");
          return mockUser;
        },
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.uid).toBe(100);
          expect(init?.params?.query?.exclusive).toBe(true);
          expect(init?.params?.query?.q).toBeUndefined();
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({
      client,
      ownerUsername: "alice",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("doc-alpha");
  });

  test("searches repos with memberUsername (no exclusive)", async () => {
    const mockUser: User = {
      id: 100,
      login: "alice",
      email: "alice@example.com",
    };

    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
      },
      {
        id: 2,
        name: "doc-shared",
        owner: { id: 200, login: "bob" },
        private: true,
        html_url: "https://git.bindersnap.com/bob/doc-shared",
      },
    ];

    const client = createMockClient({
      GET: {
        "/users/{username}": (init: any) => {
          expect(init?.params?.path?.username).toBe("alice");
          return mockUser;
        },
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.uid).toBe(100);
          expect(init?.params?.query?.exclusive).toBeUndefined();
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({
      client,
      memberUsername: "alice",
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("doc-alpha");
    expect(result[1]?.name).toBe("doc-shared");
  });

  test("ownerUsername takes precedence over memberUsername", async () => {
    const mockAlice: User = {
      id: 100,
      login: "alice",
      email: "alice@example.com",
    };

    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
      },
    ];

    const client = createMockClient({
      GET: {
        "/users/{username}": (init: any) => {
          // Only alice should be looked up (owner takes precedence)
          expect(init?.params?.path?.username).toBe("alice");
          return mockAlice;
        },
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.uid).toBe(100);
          expect(init?.params?.query?.exclusive).toBe(true);
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({
      client,
      ownerUsername: "alice",
      memberUsername: "bob",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("doc-alpha");
  });

  test("searches repos with ownerUsername and free text query", async () => {
    const mockUser: User = {
      id: 100,
      login: "alice",
      email: "alice@example.com",
    };

    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        owner: { id: 100, login: "alice" },
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
      },
    ];

    const client = createMockClient({
      GET: {
        "/users/{username}": (init: any) => {
          expect(init?.params?.path?.username).toBe("alice");
          return mockUser;
        },
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.uid).toBe(100);
          expect(init?.params?.query?.exclusive).toBe(true);
          expect(init?.params?.query?.q).toBe("alpha");
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({
      client,
      ownerUsername: "alice",
      q: "alpha",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("doc-alpha");
  });

  test("searches repos with memberUsername and free text query", async () => {
    const mockUser: User = {
      id: 100,
      login: "alice",
      email: "alice@example.com",
    };

    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-shared-project",
        owner: { id: 200, login: "bob" },
        private: true,
        html_url: "https://git.bindersnap.com/bob/doc-shared-project",
      },
    ];

    const client = createMockClient({
      GET: {
        "/users/{username}": (init: any) => {
          expect(init?.params?.path?.username).toBe("alice");
          return mockUser;
        },
        "/repos/search": (init: any) => {
          expect(init?.params?.query?.uid).toBe(100);
          expect(init?.params?.query?.exclusive).toBeUndefined();
          expect(init?.params?.query?.q).toBe("project");
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({
      client,
      memberUsername: "alice",
      q: "project",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("doc-shared-project");
  });

  test("returns empty array when no repos match", async () => {
    const client = createMockClient({
      GET: {
        "/repos/search": () => {
          return { ok: true, data: [] };
        },
      },
    });

    const result = await searchWorkspaceRepos({ client, q: "nonexistent" });

    expect(result).toHaveLength(0);
  });

  test("returns empty array when data is undefined", async () => {
    const client = createMockClient({
      GET: {
        "/repos/search": () => {
          return { ok: true, data: undefined };
        },
      },
    });

    const result = await searchWorkspaceRepos({ client });

    expect(result).toHaveLength(0);
  });

  test("normalizes repo data correctly", async () => {
    const mockRepos: Repository[] = [
      {
        id: 1,
        name: "doc-alpha",
        full_name: "alice/doc-alpha",
        owner: {
          id: 100,
          login: "alice",
          full_name: "Alice Smith",
          email: "alice@example.com",
        },
        description: "Test document",
        private: true,
        html_url: "https://git.bindersnap.com/alice/doc-alpha",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ];

    const client = createMockClient({
      GET: {
        "/repos/search": () => {
          return { ok: true, data: mockRepos };
        },
      },
    });

    const result = await searchWorkspaceRepos({ client });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
    expect(result[0]?.name).toBe("doc-alpha");
    expect(result[0]?.full_name).toBe("alice/doc-alpha");
    expect(result[0]?.owner.login).toBe("alice");
    expect(result[0]?.description).toBe("Test document");
    expect(result[0]?.updated_at).toBe("2024-01-01T00:00:00Z");
  });
});
