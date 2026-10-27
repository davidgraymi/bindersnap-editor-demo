/**
 * What the site admin console says about the deployment itself: which build
 * is running, what it runs on, how much memory and disk it has, and how it is
 * configured — the parts of Gitea's own Dashboard and Configuration Summary
 * that have a Bindersnap equivalent.
 *
 * Nothing here is a secret, by construction: `describeConfig` names every key
 * of `ApiConfig`, a secret is reported only as set or not set, and a key this
 * file has never heard of is treated as a secret until somebody classifies it.
 */

import { existsSync, readFileSync, statfsSync, statSync } from "node:fs";
import { cpus, freemem, hostname, loadavg, totalmem } from "node:os";
import { dirname, resolve } from "node:path";

import type { ApiConfig } from "./config";

// ─── The build ───────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dir, "../..");

/** `package.json`'s version, which the image carries (services/api/Dockerfile). */
export function packageVersion(root: string = REPO_ROOT): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export interface ReleaseImage {
  /** The Compose service: `gitea`, `api`, `cloudflared`, … */
  service: string;
  /** `gitea/gitea` */
  name: string;
  /** `28.0.0`, or the API's commit. */
  tag: string | null;
  /** `sha256:…` when the file pins one. */
  digest: string | null;
}

/**
 * The images `deploy/files/docker-compose.prod.yml` pins, which is what a
 * deploy of this commit runs. The API's own image is tagged with the deployed
 * commit (`API_TAG`, issue #313), which is `release` here.
 *
 * Read from the file rather than from Docker: the API has no business holding
 * the Docker socket, and the file is what the deploy applied.
 */
export function parseComposeImages(
  compose: string,
  apiTag: string,
): ReleaseImage[] {
  const images: ReleaseImage[] = [];
  let service: string | null = null;
  let inServices = false;

  for (const line of compose.split("\n")) {
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      service = null;
      continue;
    }
    if (!inServices) continue;

    const serviceMatch = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (serviceMatch) {
      service = serviceMatch[1]!;
      continue;
    }

    const imageMatch = line.match(/^ {4}image:\s*["']?([^"'\s#]+)/);
    if (!service || !imageMatch) continue;

    const reference = imageMatch[1]!.replace(
      /\$\{API_TAG(?::-[^}]*)?\}/,
      apiTag || "latest",
    );
    const [withoutDigest, digest] = reference.split("@") as [
      string,
      string | undefined,
    ];
    const lastColon = withoutDigest.lastIndexOf(":");
    const lastSlash = withoutDigest.lastIndexOf("/");
    const hasTag = lastColon > lastSlash;
    images.push({
      service,
      name: hasTag ? withoutDigest.slice(0, lastColon) : withoutDigest,
      tag: hasTag ? withoutDigest.slice(lastColon + 1) : null,
      digest: digest ?? null,
    });
  }

  return images;
}

export function releaseImages(
  apiTag: string,
  path: string = resolve(REPO_ROOT, "deploy/files/docker-compose.prod.yml"),
): ReleaseImage[] | null {
  if (!existsSync(path)) return null;
  try {
    return parseComposeImages(readFileSync(path, "utf8"), apiTag);
  } catch {
    return null;
  }
}

// ─── The process and the host ────────────────────────────────────────────

export interface RuntimeStats {
  bunVersion: string;
  bunRevision: string;
  platform: string;
  arch: string;
  hostname: string;
  pid: number;
  startedAt: number;
  cpuCount: number;
  loadAverage: number[];
  /** Seconds of CPU this process has used since it started. */
  cpuUserSeconds: number;
  cpuSystemSeconds: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    hostTotal: number;
    hostFree: number;
  };
}

export function runtimeStats(startedAt: number): RuntimeStats {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    bunVersion: Bun.version,
    bunRevision: Bun.revision.slice(0, 12),
    platform: process.platform,
    arch: process.arch,
    hostname: hostname(),
    pid: process.pid,
    startedAt,
    cpuCount: cpus().length,
    loadAverage: loadavg().map((value) => Math.round(value * 100) / 100),
    cpuUserSeconds: Math.round(cpu.user / 10_000) / 100,
    cpuSystemSeconds: Math.round(cpu.system / 10_000) / 100,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      hostTotal: totalmem(),
      hostFree: freemem(),
    },
  };
}

export interface StorageStats {
  /** The SQLite database every API table lives in, and its write-ahead log. */
  databasePath: string;
  databaseBytes: number | null;
  walBytes: number | null;
  /** The volume it sits on. */
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
}

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export function storageStats(databasePath: string): StorageStats {
  let diskTotalBytes: number | null = null;
  let diskFreeBytes: number | null = null;
  try {
    const disk = statfsSync(dirname(databasePath));
    diskTotalBytes = disk.blocks * disk.bsize;
    diskFreeBytes = disk.bavail * disk.bsize;
  } catch {
    // A path that does not exist yet (a fresh stack) has no volume to report.
  }
  return {
    databasePath,
    databaseBytes: sizeOf(databasePath),
    walBytes: sizeOf(`${databasePath}-wal`),
    diskTotalBytes,
    diskFreeBytes,
  };
}

// ─── Configuration ───────────────────────────────────────────────────────

export type ConfigValue = string | number | boolean | string[] | null;

export interface ConfigEntry {
  key: string;
  label: string;
  /** Absent for a secret: only whether it is set is ever said. */
  value?: ConfigValue;
  secret: boolean;
  isSet: boolean;
}

export interface ConfigSection {
  title: string;
  entries: ConfigEntry[];
}

type Classification =
  | { section: string; label: string }
  | { section: string; label: string; secret: true };

/**
 * Every key of `ApiConfig`, where the console shows it and whether it is a
 * secret. Typed as a full record so adding a key to the config without
 * deciding here does not compile — and at run time, a key missing from this
 * table is shown as a secret all the same.
 */
export const CONFIG_CLASSIFICATION: Record<keyof ApiConfig, Classification> = {
  nodeEnv: { section: "Server", label: "Environment" },
  isProduction: { section: "Server", label: "Production" },
  release: { section: "Server", label: "Release (deployed commit)" },
  apiPort: { section: "Server", label: "API port" },
  appPort: { section: "Server", label: "App port" },
  logLevel: { section: "Server", label: "Log level" },
  devFeaturesEnabled: { section: "Server", label: "Development features" },
  sessionsDbPath: { section: "Server", label: "Database path" },

  defaultAppOrigin: { section: "Origins", label: "Default app origin" },
  appOrigin: { section: "Origins", label: "App origin" },
  apiOrigin: { section: "Origins", label: "API origin" },
  configuredAllowedOrigins: {
    section: "Origins",
    label: "Allowed browser origins",
  },
  hasExplicitBrowserOrigins: {
    section: "Origins",
    label: "Origins set explicitly",
  },
  enforceHttps: { section: "Origins", label: "HTTPS only" },
  behindCloudflare: { section: "Origins", label: "Behind Cloudflare" },

  giteaUrl: { section: "Gitea", label: "Gitea URL" },
  giteaAdminUsername: { section: "Gitea", label: "Admin username" },
  giteaAdminPassword: {
    section: "Gitea",
    label: "Admin password",
    secret: true,
  },
  giteaServiceToken: {
    section: "Gitea",
    label: "Service read token",
    secret: true,
  },
  giteaAdminToken: { section: "Gitea", label: "Admin token", secret: true },
  tokenScopes: { section: "Gitea", label: "Session token scopes" },
  emailDomain: { section: "Gitea", label: "Placeholder email domain" },

  sessionCookieName: { section: "Sessions", label: "Cookie name" },
  sessionCookieDomain: { section: "Sessions", label: "Cookie domain" },
  sessionCookieSameSite: { section: "Sessions", label: "Cookie SameSite" },
  sessionTtlMs: { section: "Sessions", label: "Session lifetime (ms)" },
  rememberedSessionTtlMs: {
    section: "Sessions",
    label: "Remembered session lifetime (ms)",
  },
  sessionSecret: {
    section: "Sessions",
    label: "Session sealing key",
    secret: true,
  },
  authRateLimitEnabled: { section: "Sessions", label: "Sign-in rate limit" },
  authRateLimitWindowMs: {
    section: "Sessions",
    label: "Rate limit window (ms)",
  },
  authRateLimitMax: { section: "Sessions", label: "Rate limit attempts" },
  signupTurnstileSecret: {
    section: "Sessions",
    label: "Signup Turnstile secret",
    secret: true,
  },

  stripeSecretKey: {
    section: "Billing",
    label: "Stripe secret key",
    secret: true,
  },
  stripeWebhookSecret: {
    section: "Billing",
    label: "Stripe webhook secret",
    secret: true,
  },
  stripePriceId: { section: "Billing", label: "Stripe price" },
  stripeRunTag: { section: "Billing", label: "Stripe run tag" },
  bypassSubscriptionForUsers: {
    section: "Billing",
    label: "Paywall bypass accounts",
  },

  mailTransport: { section: "Email", label: "Transport" },
  mailFrom: { section: "Email", label: "From" },
  mailpitUrl: { section: "Email", label: "Mailpit URL" },
  awsRegion: { section: "Email", label: "AWS region" },

  errorReportUrl: { section: "Error reports", label: "Report URL" },
  errorReportSecret: {
    section: "Error reports",
    label: "Report secret",
    secret: true,
  },
};

function normalize(value: unknown): ConfigValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Set) return [...value].map(String).sort();
  if (Array.isArray(value)) return value.map(String);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function isSetValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (value instanceof Set) return value.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function describeConfig(config: ApiConfig): ConfigSection[] {
  const sections = new Map<string, ConfigEntry[]>();
  const record = config as unknown as Record<string, unknown>;

  for (const key of Object.keys(record).sort()) {
    const known = (
      CONFIG_CLASSIFICATION as Record<string, Classification | undefined>
    )[key];
    const classification: Classification = known ?? {
      section: "Unclassified",
      label: key,
      secret: true,
    };
    const raw = record[key];
    const secret = "secret" in classification;
    const entry: ConfigEntry = {
      key,
      label: classification.label,
      secret,
      isSet: isSetValue(raw),
      ...(secret ? {} : { value: normalize(raw) }),
    };
    const list = sections.get(classification.section) ?? [];
    list.push(entry);
    sections.set(classification.section, list);
  }

  // The table's order, so related settings read together.
  const order = [
    ...new Set(
      Object.values(CONFIG_CLASSIFICATION).map((entry) => entry.section),
    ),
    "Unclassified",
  ];
  return order
    .filter((title) => sections.has(title))
    .map((title) => ({
      title,
      entries: (sections.get(title) ?? []).sort(
        (left, right) =>
          Object.keys(CONFIG_CLASSIFICATION).indexOf(left.key) -
          Object.keys(CONFIG_CLASSIFICATION).indexOf(right.key),
      ),
    }));
}
