/**
 * Tests for the per-worktree stack allocator.
 *
 * The interesting property is the concurrent one: several agents, each in its
 * own worktree, running `stack ensure` at the same moment must end up with
 * disjoint port blocks and must never adopt each other's compose project.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  LEGACY_PORTS,
  canonicalPath,
  PORT_KEYS,
  type Registry,
  ensureStackEnv,
  parseEnv,
  portsForSlot,
  pruneMissing,
  renderEnv,
  stackNameFor,
  withLock,
} from "./stack";

const STACK_SCRIPT = resolve(import.meta.dir, "stack.ts");

let sandbox: string;
let stackHome: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "bindersnap-stack-"));
  stackHome = join(sandbox, "registry");
  process.env.BINDERSNAP_STACK_HOME = stackHome;
});

afterEach(() => {
  delete process.env.BINDERSNAP_STACK_HOME;
  rmSync(sandbox, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/** A real git repo with `count` real worktrees — the shape being defended. */
function makeRepoWithWorktrees(count: number): {
  main: string;
  worktrees: string[];
} {
  const main = join(sandbox, "main");
  spawnSync("mkdir", ["-p", main]);
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "test@example.com");
  git(main, "config", "user.name", "Test");
  Bun.write(join(main, "README.md"), "seed\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "seed");

  const worktrees: string[] = [];
  for (let i = 1; i <= count; i++) {
    const path = join(sandbox, `wt${i}`);
    git(main, "worktree", "add", "-q", "-b", `wt${i}`, path);
    worktrees.push(path);
  }
  return { main, worktrees };
}

function readRegistryFile(): Registry {
  return JSON.parse(readFileSync(join(stackHome, "stacks.json"), "utf8"));
}

describe("port blocks", () => {
  test("slot 0 keeps the historical ports", () => {
    expect(portsForSlot(0)).toEqual(LEGACY_PORTS);
  });

  test("every slot gets a disjoint block", () => {
    const seen = new Set<number>();
    for (let slot = 0; slot <= 64; slot++) {
      for (const key of PORT_KEYS) {
        const port = portsForSlot(slot)[key];
        expect(seen.has(port)).toBe(false);
        seen.add(port);
        expect(port).toBeGreaterThan(1023);
        expect(port).toBeLessThan(65536);
      }
    }
  });
});

describe("stack names", () => {
  test("the main checkout keeps the historical project name", () => {
    expect(stackNameFor("/anywhere/bindersnap-editor-demo", 0)).toBe(
      "bindersnap",
    );
  });

  test("a worktree name is a legal compose project name", () => {
    const name = stackNameFor(
      "/repo/.claude/worktrees/Agent_Stack Setup--77E33C",
      7,
    );
    expect(name).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(name).toContain("-7");
  });

  test("same-named worktrees in different places stay distinct", () => {
    expect(stackNameFor("/a/feature", 3)).not.toBe(
      stackNameFor("/b/feature", 4),
    );
  });
});

describe(".env rendering", () => {
  const managed = { STACK_NAME: "bindersnap-wt-1", APP_PORT: "21010" };

  test("writes a managed block and keeps unmanaged keys", () => {
    const out = renderEnv("STRIPE_SECRET_KEY=sk_test_x\n", managed);
    expect(parseEnv(out).STRIPE_SECRET_KEY).toBe("sk_test_x");
    expect(parseEnv(out).STACK_NAME).toBe("bindersnap-wt-1");
    expect(parseEnv(out).APP_PORT).toBe("21010");
  });

  test("neutralises a stray copy of a managed key", () => {
    // A leftover `APP_PORT=5173` would otherwise beat the managed block and
    // point this worktree at the main checkout's stack.
    const out = renderEnv("APP_PORT=5173\nOTHER=1\n", managed);
    expect(parseEnv(out).APP_PORT).toBe("21010");
    expect(out).toContain("# superseded by the managed stack block below");
    expect(parseEnv(out).OTHER).toBe("1");
  });

  test("re-rendering is stable", () => {
    const once = renderEnv("KEEP=1\n", managed);
    const twice = renderEnv(once, managed);
    expect(twice).toBe(once);
    expect(parseEnv(twice)).toEqual(parseEnv(once));
  });
});

describe("registry", () => {
  test("prunes records whose worktree is gone", () => {
    const registry: Registry = {
      version: 1,
      stacks: [
        {
          path: sandbox,
          slot: 1,
          stackName: "a",
          ports: portsForSlot(1),
          createdAt: "now",
        },
        {
          path: join(sandbox, "deleted"),
          slot: 2,
          stackName: "b",
          ports: portsForSlot(2),
          createdAt: "now",
        },
      ],
    };
    expect(pruneMissing(registry).stacks.map((s) => s.slot)).toEqual([1]);
  });

  test("the lock serialises concurrent read-modify-write", async () => {
    // Same-process contention only proves reentrancy is not assumed; the
    // cross-process case is covered by the spawned test below.
    const order: string[] = [];
    withLock(() => order.push("first"));
    withLock(() => order.push("second"));
    expect(order).toEqual(["first", "second"]);
    expect(existsSync(join(stackHome, "stacks.lock"))).toBe(false);
  });
});

describe("ensureStackEnv", () => {
  test("gives the main checkout slot 0 and each worktree its own", async () => {
    const { main, worktrees } = makeRepoWithWorktrees(2);

    const mainStack = await ensureStackEnv(main);
    expect(mainStack.slot).toBe(0);
    expect(mainStack.stackName).toBe("bindersnap");

    const first = await ensureStackEnv(worktrees[0]!);
    const second = await ensureStackEnv(worktrees[1]!);

    expect(first.slot).not.toBe(second.slot);
    expect(first.stackName).not.toBe(second.stackName);
    expect(first.ports.APP_PORT).not.toBe(second.ports.APP_PORT);
  });

  test("is idempotent — a worktree keeps its slot across runs", async () => {
    const { worktrees } = makeRepoWithWorktrees(1);
    const first = await ensureStackEnv(worktrees[0]!);
    const again = await ensureStackEnv(worktrees[0]!);

    expect(again.slot).toBe(first.slot);
    expect(again.ports).toEqual(first.ports);
    expect(again.allocated).toBe(false);
    expect(readRegistryFile().stacks).toHaveLength(1);
  });

  test("writes a .env that compose can read", async () => {
    const { worktrees } = makeRepoWithWorktrees(1);
    const stack = await ensureStackEnv(worktrees[0]!);
    const env = parseEnv(readFileSync(join(worktrees[0]!, ".env"), "utf8"));

    expect(env.STACK_NAME).toBe(stack.stackName);
    for (const key of PORT_KEYS) {
      expect(env[key]).toBe(String(stack.ports[key]));
    }
  });

  test("a second clone does not also claim slot 0", async () => {
    const { main } = makeRepoWithWorktrees(0);
    const clone = join(sandbox, "clone");
    spawnSync("git", ["clone", "-q", main, clone]);

    const original = await ensureStackEnv(main);
    const copy = await ensureStackEnv(clone);

    expect(original.slot).toBe(0);
    expect(copy.slot).not.toBe(0);
    expect(copy.ports.APP_PORT).not.toBe(original.ports.APP_PORT);
  });
});

describe("concurrent agents", () => {
  /** Allocate from a separate OS process, as a second agent session would. */
  function allocateInChildProcess(root: string): Promise<{
    slot: number;
    stackName: string;
    ports: Record<string, number>;
  }> {
    const source = `
      const { ensureStackEnv } = await import(${JSON.stringify(STACK_SCRIPT)});
      const c = await ensureStackEnv(process.argv[process.argv.length - 1]);
      console.log(JSON.stringify({ slot: c.slot, stackName: c.stackName, ports: c.ports }));
    `;
    return new Promise((done, fail) => {
      const child = spawn("bun", ["-e", source, root], {
        env: { ...process.env, BINDERSNAP_STACK_HOME: stackHome },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => {
        if (code !== 0) return fail(new Error(`child failed: ${err}`));
        try {
          done(JSON.parse(out.trim().split("\n").pop() ?? "{}"));
        } catch (e) {
          fail(new Error(`unparseable child output: ${out}\n${err}`));
        }
      });
    });
  }

  test("six sessions starting at once get six disjoint stacks", async () => {
    const { worktrees } = makeRepoWithWorktrees(6);

    // No staggering: every process races for the registry at once.
    const results = await Promise.all(
      worktrees.map((root) => allocateInChildProcess(root)),
    );

    const slots = results.map((r) => r.slot);
    expect(new Set(slots).size).toBe(slots.length);

    const names = results.map((r) => r.stackName);
    expect(new Set(names).size).toBe(names.length);

    const everyPort = results.flatMap((r) =>
      PORT_KEYS.map((key) => r.ports[key]),
    );
    expect(new Set(everyPort).size).toBe(everyPort.length);

    // And the registry agrees with what each process was told.
    const registry = readRegistryFile();
    expect(registry.stacks).toHaveLength(6);
    for (const result of results) {
      const record = registry.stacks.find(
        (s) => s.stackName === result.stackName,
      );
      expect(record?.slot).toBe(result.slot);
    }
  }, 60_000);

  test("a repeat race re-uses slots instead of exhausting them", async () => {
    const { worktrees } = makeRepoWithWorktrees(3);
    const first = await Promise.all(worktrees.map(allocateInChildProcess));
    const second = await Promise.all(worktrees.map(allocateInChildProcess));

    expect(second.map((r) => r.slot).sort()).toEqual(
      first.map((r) => r.slot).sort(),
    );
    expect(readRegistryFile().stacks).toHaveLength(3);
  }, 60_000);
});

describe("the CLI never touches another worktree's stack", () => {
  test("`status` reports the worktree's own project, not the shared default", () => {
    // Run the CLI against a throwaway worktree rather than this checkout: the
    // script resolves its root from its own location, and pointing it at the
    // real repo would rewrite a developer's .env as a side effect of running
    // the tests. It imports nothing but builtins, so a copy runs anywhere.
    const { worktrees } = makeRepoWithWorktrees(1);
    const worktree = worktrees[0]!;
    spawnSync("mkdir", ["-p", join(worktree, "scripts")]);
    spawnSync("cp", [STACK_SCRIPT, join(worktree, "scripts", "stack.ts")]);

    const result = spawnSync(
      "bun",
      [join(worktree, "scripts", "stack.ts"), "status", "--json"],
      {
        cwd: worktree,
        encoding: "utf8",
        env: { ...process.env, BINDERSNAP_STACK_HOME: stackHome },
      },
    );

    expect(result.status).toBe(0);
    const status = JSON.parse(result.stdout) as {
      stackName: string;
      slot: number;
      path: string;
      ports: Record<string, number>;
    };

    // `status --json` reports exactly the project name every compose command
    // in this script is given, so asserting on it asserts on the blast radius.
    expect(status.path).toBe(canonicalPath(worktree));
    expect(status.slot).toBeGreaterThan(0);
    expect(status.stackName).not.toBe("bindersnap");
    expect(status.ports.APP_PORT).not.toBe(LEGACY_PORTS.APP_PORT);

    // Builds a git repo and a worktree, then starts a whole `bun` process:
    // 6.3s on a cold CI runner against the 5s default, which is how this
    // arrived red. The races below take 60s because they spawn six of these;
    // one process gets a fifth of that, still ~5x the observed cost.
  }, 30_000);

  test("`status` leaves the main checkout on the historical ports", () => {
    const { main } = makeRepoWithWorktrees(0);
    spawnSync("mkdir", ["-p", join(main, "scripts")]);
    spawnSync("cp", [STACK_SCRIPT, join(main, "scripts", "stack.ts")]);

    const result = spawnSync(
      "bun",
      [join(main, "scripts", "stack.ts"), "status", "--json"],
      {
        cwd: main,
        encoding: "utf8",
        env: { ...process.env, BINDERSNAP_STACK_HOME: stackHome },
      },
    );

    expect(result.status).toBe(0);
    const status = JSON.parse(result.stdout) as {
      stackName: string;
      ports: Record<string, number>;
    };
    expect(status.stackName).toBe("bindersnap");
    expect(status.ports.APP_PORT).toBe(LEGACY_PORTS.APP_PORT);

    // Same shape as its neighbour, and it only passed by doing slightly less
    // work — one fewer worktree. Left on the default it is a flake waiting
    // for a slower runner.
  }, 30_000);
});
