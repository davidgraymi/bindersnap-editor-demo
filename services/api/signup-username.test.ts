import { describe, expect, test } from "bun:test";

import {
  MAX_USERNAME_ATTEMPTS,
  createWithFreeUsername,
  isUsernameRefusal,
  usernameCandidates,
  usernameFromName,
} from "./signup-username";

/** Gitea 28's rule for a user name, as `IsValidUsername` checks it. */
const GITEA_USERNAME = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;

describe("usernameFromName", () => {
  test("is the person's name, as a login", () => {
    expect(usernameFromName("Jordan", "Kim", "jk@clinic.org")).toBe(
      "jordan.kim",
    );
  });

  test("drops accents and apostrophes, and dashes everything else", () => {
    expect(usernameFromName("José", "O'Neil", "x@y.org")).toBe("jose.oneil");
    expect(usernameFromName("Mary Jane", "Smith-Jones", "x@y.org")).toBe(
      "mary-jane.smith-jones",
    );
    expect(usernameFromName("  Dr. Ana ", "Ruiz, RN", "x@y.org")).toBe(
      "dr-ana.ruiz-rn",
    );
  });

  test("falls back to the address when the name has nothing Gitea takes", () => {
    expect(usernameFromName("美咲", "佐藤", "misaki.sato@clinic.jp")).toBe(
      "misaki-sato",
    );
    expect(usernameFromName("美咲", "佐藤", "@")).toBe("member");
  });

  test("leaves room for a suffix and never ends on a separator", () => {
    const name = usernameFromName(
      "Bartholomew-Alexander",
      "Featherstonehaugh-Montgomery",
      "x@y.org",
    );
    expect(name.length).toBeLessThanOrEqual(35);
    expect(name).toMatch(GITEA_USERNAME);
  });

  test("is always a name Gitea accepts", () => {
    for (const [first, last, email] of [
      ["Jordan", "Kim", "a@b.c"],
      ["--", "..", "a.b@c.d"],
      ["Zoë", "D'Arcy-Évans", "z@d.e"],
      ["A", "B", "a@b.c"],
      ["", "", "___@x.y"],
    ] as const) {
      expect(usernameFromName(first, last, email)).toMatch(GITEA_USERNAME);
    }
  });
});

describe("usernameCandidates", () => {
  test("tries the plain name, then numbered ones, then random digits", () => {
    const candidates = usernameCandidates("jordan.kim", () => 0.5);
    expect(candidates).toHaveLength(MAX_USERNAME_ATTEMPTS);
    expect(candidates.slice(0, 5)).toEqual([
      "jordan.kim",
      "jordan.kim2",
      "jordan.kim3",
      "jordan.kim4",
      "jordan.kim5",
    ]);
    expect(candidates[5]).toBe("jordan.kim5500");
  });
});

describe("isUsernameRefusal", () => {
  test("is a taken or reserved name", () => {
    expect(
      isUsernameRefusal(422, "user already exists [name: jordan.kim]"),
    ).toBe(true);
    expect(isUsernameRefusal(422, "name is reserved [name: admin]")).toBe(true);
    expect(
      isUsernameRefusal(422, "name pattern is not allowed [pattern: *.keys]"),
    ).toBe(true);
  });

  test("is not a taken email, or any other failure", () => {
    expect(
      isUsernameRefusal(422, "e-mail already in use [email: jk@clinic.org]"),
    ).toBe(false);
    expect(isUsernameRefusal(500, "user already exists [name: x]")).toBe(false);
    expect(isUsernameRefusal(422, "password is too short")).toBe(false);
  });
});

describe("createWithFreeUsername", () => {
  test("moves past a taken name to the next free one", async () => {
    const tried: string[] = [];
    const taken = new Set(["jordan.kim", "jordan.kim2"]);
    const outcome = await createWithFreeUsername(
      ["jordan.kim", "jordan.kim2", "jordan.kim3"],
      async (name) => {
        tried.push(name);
        return taken.has(name)
          ? { status: 422, error: `user already exists [name: ${name}]` }
          : { created: true as const };
      },
    );
    expect(tried).toEqual(["jordan.kim", "jordan.kim2", "jordan.kim3"]);
    expect(outcome).toEqual({
      username: "jordan.kim3",
      result: { created: true },
    });
  });

  test("stops at a refusal another name would not fix", async () => {
    const tried: string[] = [];
    const outcome = await createWithFreeUsername(
      ["jordan.kim", "jordan.kim2"],
      async (name) => {
        tried.push(name);
        return { status: 422, error: "e-mail already in use [email: x]" };
      },
    );
    expect(tried).toEqual(["jordan.kim"]);
    expect(outcome.result).toEqual({
      status: 422,
      error: "e-mail already in use [email: x]",
    });
  });

  test("returns the last refusal when every name is taken", async () => {
    const outcome = await createWithFreeUsername(["a", "a2"], async (name) => ({
      status: 422,
      error: `user already exists [name: ${name}]`,
    }));
    expect(outcome.username).toBe("a2");
    expect("created" in outcome.result).toBe(false);
  });
});
