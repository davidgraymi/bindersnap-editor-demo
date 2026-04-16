#!/usr/bin/env bun

import { randomUUID } from "node:crypto";

export const DEFAULT_SERVICE_ACCOUNT_USERNAME = "bindersnap-service";
export const DEFAULT_SERVICE_TOKEN_NAME = "bindersnap-api-service";
export const DEFAULT_SSM_PARAMETER_PATH = "/bindersnap/prod";
export const DEFAULT_SERVICE_ACCOUNT_EMAIL_DOMAIN = "users.bindersnap.local";
export const DEFAULT_SERVICE_TOKEN_SCOPES = ["write:admin"] as const;

type BootstrapConfig = {
  giteaUrl: string;
  adminUsername: string;
  adminPassword: string;
  serviceUsername: string;
  serviceEmail: string;
  servicePassword: string;
  serviceTokenName: string;
  serviceTokenScopes: string[];
  ssmParameterName: string;
  awsRegion?: string;
};

type GiteaApiErrorPayload = {
  message?: unknown;
};

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function resolveServiceTokenScopes(scopesRaw?: string): string[] {
  const configuredScopes = (scopesRaw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");

  return Array.from(
    new Set<string>([...configuredScopes, ...DEFAULT_SERVICE_TOKEN_SCOPES]),
  );
}

export function resolveSsmParameterName(parameterPathRaw?: string): string {
  const trimmedPath =
    parameterPathRaw?.trim().replace(/\/+$/, "") || DEFAULT_SSM_PARAMETER_PATH;
  return `${trimmedPath}/gitea_service_token`;
}

export function buildPutParameterArgs(
  parameterName: string,
  value: string,
  awsRegion?: string,
): string[] {
  const args = [
    "aws",
    "ssm",
    "put-parameter",
    "--name",
    parameterName,
    "--type",
    "SecureString",
    "--value",
    value,
    "--overwrite",
  ];

  if (awsRegion?.trim()) {
    args.push("--region", awsRegion.trim());
  }

  return args;
}

export function resolveBootstrapConfig(env = process.env): BootstrapConfig {
  const giteaUrl =
    env.GITEA_URL?.trim() ||
    env.GITEA_INTERNAL_URL?.trim() ||
    "http://localhost:3000";
  const serviceUsername =
    env.GITEA_SERVICE_ACCOUNT_USERNAME?.trim() ||
    DEFAULT_SERVICE_ACCOUNT_USERNAME;
  const emailDomain =
    env.GITEA_SERVICE_ACCOUNT_EMAIL_DOMAIN?.trim() ||
    env.BINDERSNAP_USER_EMAIL_DOMAIN?.trim() ||
    DEFAULT_SERVICE_ACCOUNT_EMAIL_DOMAIN;

  return {
    giteaUrl,
    adminUsername: requireEnv(env, "GITEA_ADMIN_USER"),
    adminPassword: requireEnv(env, "GITEA_ADMIN_PASS"),
    serviceUsername,
    serviceEmail:
      env.GITEA_SERVICE_ACCOUNT_EMAIL?.trim() ||
      `${serviceUsername}@${emailDomain}`,
    servicePassword:
      env.GITEA_SERVICE_ACCOUNT_PASSWORD?.trim() ||
      `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
    serviceTokenName:
      env.GITEA_SERVICE_TOKEN_NAME?.trim() || DEFAULT_SERVICE_TOKEN_NAME,
    serviceTokenScopes: resolveServiceTokenScopes(
      env.GITEA_SERVICE_TOKEN_SCOPES,
    ),
    ssmParameterName: resolveSsmParameterName(env.SSM_PARAMETER_PATH),
    awsRegion: env.AWS_REGION?.trim() || undefined,
  };
}

function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function readGiteaErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response
    .json()
    .catch(() => null)) as GiteaApiErrorPayload | null;
  if (typeof payload?.message === "string" && payload.message.trim() !== "") {
    return payload.message.trim();
  }

  return fallback;
}

async function giteaRequest(
  config: BootstrapConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(
    "Authorization",
    buildBasicAuthHeader(config.adminUsername, config.adminPassword),
  );
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(new URL(path, config.giteaUrl), {
    ...init,
    headers,
  });

  return response;
}

async function ensureServiceUser(config: BootstrapConfig): Promise<void> {
  const createResponse = await giteaRequest(config, "/api/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: config.serviceUsername,
      email: config.serviceEmail,
      password: config.servicePassword,
      must_change_password: false,
      restricted: false,
      send_notify: false,
      visibility: "private",
    }),
  });

  if (
    !createResponse.ok &&
    createResponse.status !== 409 &&
    createResponse.status !== 422
  ) {
    throw new Error(
      await readGiteaErrorMessage(
        createResponse,
        "Unable to create the Gitea service account.",
      ),
    );
  }

  const patchResponse = await giteaRequest(
    config,
    `/api/v1/admin/users/${encodeURIComponent(config.serviceUsername)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        admin: true,
        login_name: "",
        source_id: 0,
      }),
    },
  );

  if (!patchResponse.ok) {
    throw new Error(
      await readGiteaErrorMessage(
        patchResponse,
        "Unable to grant admin privileges to the Gitea service account.",
      ),
    );
  }
}

async function rotateServiceToken(config: BootstrapConfig): Promise<string> {
  const deleteResponse = await giteaRequest(
    config,
    `/api/v1/users/${encodeURIComponent(config.serviceUsername)}/tokens/${encodeURIComponent(config.serviceTokenName)}`,
    {
      method: "DELETE",
    },
  );

  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    throw new Error(
      await readGiteaErrorMessage(
        deleteResponse,
        "Unable to rotate the existing service token.",
      ),
    );
  }

  const createResponse = await giteaRequest(
    config,
    `/api/v1/users/${encodeURIComponent(config.serviceUsername)}/tokens`,
    {
      method: "POST",
      body: JSON.stringify({
        name: config.serviceTokenName,
        scopes: config.serviceTokenScopes,
      }),
    },
  );

  if (!createResponse.ok) {
    throw new Error(
      await readGiteaErrorMessage(
        createResponse,
        "Unable to create the Gitea service token.",
      ),
    );
  }

  const payload = (await createResponse.json()) as { sha1?: unknown };
  if (typeof payload.sha1 !== "string" || payload.sha1.trim() === "") {
    throw new Error("Gitea did not return the new service token value.");
  }

  return payload.sha1.trim();
}

function writeTokenToSsm(config: BootstrapConfig, serviceToken: string): void {
  const result = Bun.spawnSync(
    buildPutParameterArgs(
      config.ssmParameterName,
      serviceToken,
      config.awsRegion,
    ),
    {
      stderr: "pipe",
      stdout: "pipe",
      env: process.env,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to write ${config.ssmParameterName} to SSM: ${result.stderr.toString().trim() || result.stdout.toString().trim() || "aws ssm put-parameter failed"}`,
    );
  }
}

export async function bootstrapGiteaServiceAccount(
  config = resolveBootstrapConfig(),
): Promise<void> {
  console.log(
    `Ensuring Gitea service account ${config.serviceUsername} exists at ${config.giteaUrl}`,
  );
  await ensureServiceUser(config);

  console.log(
    `Rotating PAT ${config.serviceTokenName} with scopes: ${config.serviceTokenScopes.join(", ")}`,
  );
  const serviceToken = await rotateServiceToken(config);

  console.log(`Writing ${config.ssmParameterName} to SSM Parameter Store`);
  writeTokenToSsm(config, serviceToken);

  console.log("Done.");
  console.log(
    "Next steps: rerun the env refresh on the host, restart the API service, then remove any API-side admin runtime secrets from SSM.",
  );
}

if (import.meta.main) {
  bootstrapGiteaServiceAccount().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Bootstrap failed unexpectedly.",
    );
    process.exit(1);
  });
}
