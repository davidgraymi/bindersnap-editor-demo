#!/usr/bin/env bun

import { randomUUID } from "node:crypto";

export const DEFAULT_SERVICE_ACCOUNT_USERNAME = "bindersnap-service";
export const DEFAULT_SERVICE_TOKEN_NAME = "bindersnap-api-service";
export const DEFAULT_SSM_PARAMETER_PATH = "/bindersnap/prod";
export const DEFAULT_SERVICE_ACCOUNT_EMAIL_DOMAIN = "users.bindersnap.local";
export const DEFAULT_SERVICE_TOKEN_SCOPES = ["write:admin"] as const;
export const BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER =
  "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts";

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

type SsmParameter = {
  Name: string;
  Value: string;
};

type SsmParametersByPathPayload = {
  Parameters?: SsmParameter[];
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

function resolveParameterPath(parameterPathRaw?: string): string {
  return parameterPathRaw?.trim().replace(/\/+$/, "") || DEFAULT_SSM_PARAMETER_PATH;
}

function parameterNameToEnvName(parameterName: string): string {
  return parameterName.split("/").at(-1)!.replaceAll("-", "_").toUpperCase();
}

export function renderDockerEnvFromSsmPayload(
  payload: SsmParametersByPathPayload,
  parameterPathRaw?: string,
  bootstrapPlaceholder = BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER,
): string {
  const parameterPath = resolveParameterPath(parameterPathRaw);
  const parameters = [...(payload.Parameters ?? [])].sort((a, b) =>
    a.Name.localeCompare(b.Name),
  );

  if (parameters.length === 0) {
    throw new Error(`No SSM parameters found under ${parameterPath}`);
  }

  const tokenParameterName = `${parameterPath}/gitea_service_token`;
  const tokenValue = parameters.find(
    (parameter) => parameter.Name === tokenParameterName,
  )?.Value;

  const lines: string[] = [];
  for (const parameter of parameters) {
    if (!parameter.Name.startsWith(`${parameterPath}/`)) {
      continue;
    }

    if (parameter.Value.includes("\n")) {
      throw new Error(
        `${parameter.Name} contains a newline and cannot be written to a Docker env file`,
      );
    }

    const envName = parameterNameToEnvName(parameter.Name);
    if (
      tokenValue &&
      tokenValue !== bootstrapPlaceholder &&
      (envName === "GITEA_ADMIN_USER" || envName === "GITEA_ADMIN_PASS")
    ) {
      continue;
    }

    lines.push(`${envName}=${parameter.Value}`);
  }

  return `${lines.join("\n")}\n`;
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

export function buildRemoteBootstrapCommands(
  scriptBase64: string,
  caddyfileBase64?: string,
): string[] {
  return [
    "set -euo pipefail",
    "APP_DIR=/opt/bindersnap",
    "ENV_FILE=$APP_DIR/.env.prod",
    "COMPOSE_FILE=$APP_DIR/docker-compose.prod.yml",
    'PARAMETER_PATH="${SSM_PARAMETER_PATH:-/bindersnap/prod}"',
    `BOOTSTRAP_TOKEN_PLACEHOLDER=${BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER}`,
    'if ! command -v aws >/dev/null 2>&1; then echo "aws CLI is missing on the instance"; exit 1; fi',
    'if [ ! -f "$COMPOSE_FILE" ]; then echo "docker-compose.prod.yml is missing on the instance"; exit 1; fi',
    'mkdir -p "$APP_DIR/scripts"',
    `echo "${scriptBase64}" | base64 -d > "$APP_DIR/scripts/bootstrap-gitea-service-account.ts"`,
    'chmod 0644 "$APP_DIR/scripts/bootstrap-gitea-service-account.ts"',
    ...(caddyfileBase64
      ? [
          'if [ -d "$APP_DIR/Caddyfile.prod" ]; then rm -rf "$APP_DIR/Caddyfile.prod"; fi',
          `echo "${caddyfileBase64}" | base64 -d > "$APP_DIR/Caddyfile.prod"`,
          'chmod 0644 "$APP_DIR/Caddyfile.prod"',
        ]
      : []),
    'TMP_ENV="$(mktemp "$ENV_FILE.XXXXXX")"',
    'TMP_JSON="$(mktemp "$ENV_FILE.json.XXXXXX")"',
    'cleanup() { rm -f "$TMP_ENV" "$TMP_JSON"; }',
    'trap cleanup EXIT',
    'aws ssm get-parameters-by-path --path "$PARAMETER_PATH" --recursive --with-decryption --output json > "$TMP_JSON"',
    'docker run --rm -i -v "$APP_DIR:/workspace" -w /workspace oven/bun:1 bun scripts/bootstrap-gitea-service-account.ts render-env --parameter-path "$PARAMETER_PATH" < "$TMP_JSON" > "$TMP_ENV"',
    'install -m 0600 "$TMP_ENV" "$ENV_FILE"',
    'SERVICE_TOKEN=$(grep \'^GITEA_SERVICE_TOKEN=\' "$ENV_FILE" | cut -d= -f2- || true)',
    'if [ -z "$SERVICE_TOKEN" ]; then echo "GITEA_SERVICE_TOKEN is missing from $ENV_FILE"; exit 1; fi',
    'if [ "$SERVICE_TOKEN" != "$BOOTSTRAP_TOKEN_PLACEHOLDER" ]; then echo "Gitea service token already bootstrapped"; exit 0; fi',
    'set -a',
    '. "$ENV_FILE"',
    'set +a',
    'if [ -z "${GITEA_ADMIN_USER:-}" ] || [ -z "${GITEA_ADMIN_PASS:-}" ]; then echo "GITEA_ADMIN_USER and GITEA_ADMIN_PASS are required while the service token is still a bootstrap placeholder"; exit 1; fi',
    'cd "$APP_DIR"',
    'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d gitea',
    `for _ in $(seq 1 60); do STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' bindersnap-gitea-prod 2>/dev/null || true); if [ "$STATUS" = "healthy" ]; then break; fi; sleep 5; done`,
    `STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' bindersnap-gitea-prod 2>/dev/null || true)`,
    'if [ "$STATUS" != "healthy" ]; then echo "Gitea did not become ready in time"; exit 1; fi',
    'GITEA_ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-${GITEA_ADMIN_USER}@${BINDERSNAP_USER_EMAIL_DOMAIN:-users.bindersnap.com}}"',
    'if ! docker exec --user "${GITEA_EXEC_USER:-1000:1000}" bindersnap-gitea-prod gitea --config /data/gitea/conf/app.ini admin user create --username "$GITEA_ADMIN_USER" --password "$GITEA_ADMIN_PASS" --email "$GITEA_ADMIN_EMAIL" --admin --must-change-password=false; then docker exec --user "${GITEA_EXEC_USER:-1000:1000}" bindersnap-gitea-prod gitea --config /data/gitea/conf/app.ini admin user change-password --username "$GITEA_ADMIN_USER" --password "$GITEA_ADMIN_PASS" --must-change-password=false; fi',
    'SERVICE_TOKEN=$(docker run --rm --network bindersnap-prod -e GITEA_ADMIN_USER -e GITEA_ADMIN_PASS -e GITEA_INTERNAL_URL=http://gitea:3000 -e BINDERSNAP_USER_EMAIL_DOMAIN="${BINDERSNAP_USER_EMAIL_DOMAIN:-users.bindersnap.com}" -v "$APP_DIR:/workspace" -w /workspace oven/bun:1 bun scripts/bootstrap-gitea-service-account.ts mint-token)',
    'if [ -z "$SERVICE_TOKEN" ]; then echo "mint-token returned an empty token"; exit 1; fi',
    'aws ssm put-parameter --name "$PARAMETER_PATH/gitea_service_token" --type SecureString --value "$SERVICE_TOKEN" --overwrite --region "${AWS_REGION:-us-east-1}"',
    'aws ssm get-parameters-by-path --path "$PARAMETER_PATH" --recursive --with-decryption --output json > "$TMP_JSON"',
    'docker run --rm -i -v "$APP_DIR:/workspace" -w /workspace oven/bun:1 bun scripts/bootstrap-gitea-service-account.ts render-env --parameter-path "$PARAMETER_PATH" < "$TMP_JSON" > "$TMP_ENV"',
    'install -m 0600 "$TMP_ENV" "$ENV_FILE"',
    'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api caddy',
  ];
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
      login_name: config.serviceUsername,
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
        login_name: config.serviceUsername,
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

async function ensureServiceUserAndRotateToken(
  config: BootstrapConfig,
  options?: { log?: boolean },
): Promise<string> {
  const log = options?.log ?? true;

  if (log) {
    console.log(
      `Ensuring Gitea service account ${config.serviceUsername} exists at ${config.giteaUrl}`,
    );
  }
  await ensureServiceUser(config);

  if (log) {
    console.log(
      `Rotating PAT ${config.serviceTokenName} with scopes: ${config.serviceTokenScopes.join(", ")}`,
    );
  }
  return rotateServiceToken(config);
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
  const serviceToken = await ensureServiceUserAndRotateToken(config, {
    log: true,
  });

  console.log(`Writing ${config.ssmParameterName} to SSM Parameter Store`);
  writeTokenToSsm(config, serviceToken);

  console.log("Done.");
  console.log(
    "Next steps: rerun the env refresh on the host, restart the API service, then remove any API-side admin runtime secrets from SSM.",
  );
}

function readRequiredOption(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing required option: ${name}`);
  }

  return value;
}

async function readStdinText(): Promise<string> {
  return Bun.file("/dev/stdin").text();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    await bootstrapGiteaServiceAccount();
    return;
  }

  if (command === "render-env") {
    const parameterPath = readRequiredOption(args, "--parameter-path");
    const input = await readStdinText();
    const payload = JSON.parse(input) as SsmParametersByPathPayload;
    process.stdout.write(renderDockerEnvFromSsmPayload(payload, parameterPath));
    return;
  }

  if (command === "print-ssm-commands") {
    const scriptBase64 = readRequiredOption(args, "--script-b64");
    const caddyfileIndex = args.indexOf("--caddyfile-b64");
    const caddyfileBase64 =
      caddyfileIndex >= 0 ? args[caddyfileIndex + 1] : undefined;
    process.stdout.write(
      JSON.stringify({
        commands: buildRemoteBootstrapCommands(scriptBase64, caddyfileBase64),
      }),
    );
    return;
  }

  if (command === "mint-token") {
    const token = await ensureServiceUserAndRotateToken(resolveBootstrapConfig(), {
      log: false,
    });
    process.stdout.write(`${token}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Bootstrap failed unexpectedly.",
    );
    process.exit(1);
  });
}
