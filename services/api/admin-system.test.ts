import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONFIG_CLASSIFICATION,
  describeConfig,
  packageVersion,
  parseComposeImages,
  releaseImages,
  storageStats,
} from "./admin-system";
import { initializeConfig, type ApiConfig } from "./config";

const SHA = "2ec0a5b93e300610fd6051d349e54a25e4ec0829";

test("the production Compose file's images are read with the API's commit as its tag", () => {
  const images = releaseImages(SHA);
  expect(images).not.toBeNull();
  const byService = new Map(images!.map((image) => [image.service, image]));

  expect(byService.get("api")).toEqual({
    service: "api",
    name: "ghcr.io/davidgraymi/bindersnap-api",
    tag: SHA,
    digest: null,
  });
  // Whatever Gitea the file pins this week: the point is that it is read.
  expect(byService.get("gitea")).toMatchObject({ name: "gitea/gitea" });
  expect(byService.get("gitea")!.tag).toMatch(/^\d+\.\d+\.\d+$/);
  expect(byService.get("gitea")!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  // Every service that runs something names an image.
  const compose = readFileSync(
    resolve(import.meta.dir, "../../deploy/files/docker-compose.prod.yml"),
    "utf8",
  );
  expect(images!.length).toBe(compose.match(/^ {4}image:/gm)!.length);
});

test("parseComposeImages reads a registry with a port, and ignores volumes", () => {
  expect(
    parseComposeImages(
      [
        "services:",
        "  web:",
        "    image: registry.local:5000/team/web:1.2.3",
        "  plain:",
        '    image: "alpine"',
        "volumes:",
        "  data:",
        "    image: not-a-service:1",
      ].join("\n"),
      SHA,
    ),
  ).toEqual([
    {
      service: "web",
      name: "registry.local:5000/team/web",
      tag: "1.2.3",
      digest: null,
    },
    { service: "plain", name: "alpine", tag: null, digest: null },
  ]);
});

test("packageVersion reads the repository's version", () => {
  expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("storageStats reports nothing for a database that is not there yet", () => {
  const stats = storageStats(`/tmp/no-such-dir-${Date.now()}/sessions.db`);
  expect(stats.databaseBytes).toBeNull();
  expect(stats.diskFreeBytes).toBeNull();
});

test("every configuration key is classified, and no secret's value is described", () => {
  const config = initializeConfig({
    NODE_ENV: "development",
    BINDERSNAP_GITEA_SERVICE_TOKEN: "service-token-value",
    BINDERSNAP_GITEA_ADMIN_TOKEN: "admin-token-value",
    STRIPE_SECRET_KEY: "sk_test_value",
    STRIPE_WEBHOOK_SECRET: "whsec_value",
    BINDERSNAP_SESSION_SECRET: "session-secret-value",
    GITEA_ADMIN_PASS: "admin-password-value",
  });

  for (const key of Object.keys(config)) {
    expect(CONFIG_CLASSIFICATION).toHaveProperty(key);
  }

  const described = JSON.stringify(describeConfig(config));
  for (const secret of [
    "service-token-value",
    "admin-token-value",
    "sk_test_value",
    "whsec_value",
    "session-secret-value",
    "admin-password-value",
  ]) {
    expect(described).not.toContain(secret);
  }
});

test("a key nobody classified is treated as a secret", () => {
  const config = {
    ...initializeConfig({ NODE_ENV: "development" }),
    brandNewToken: "do-not-show-me",
  } as unknown as ApiConfig;
  const sections = describeConfig(config);
  const unclassified = sections.find(
    (section) => section.title === "Unclassified",
  );
  expect(unclassified?.entries).toEqual([
    { key: "brandNewToken", label: "brandNewToken", secret: true, isSet: true },
  ]);
  expect(JSON.stringify(sections)).not.toContain("do-not-show-me");
});
