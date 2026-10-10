#!/usr/bin/env bun

import { randomUUID } from "node:crypto";

export const DEFAULT_SERVICE_ACCOUNT_USERNAME = "bindersnap-service";
export const DEFAULT_SERVICE_TOKEN_NAME = "bindersnap-api-service";
export const DEFAULT_ADMIN_TOKEN_NAME = "bindersnap-api-admin";
export const DEFAULT_SSM_PARAMETER_PATH = "/bindersnap/prod";
export const DEFAULT_SERVICE_ACCOUNT_EMAIL_DOMAIN = "users.bindersnap.local";
/**
 * The service account holds two tokens. The service token reads — branch
 * protection, teams, avatars, the email lookup at sign-in (`read:admin`) — on
 * nearly every API request, so it can write nothing. The admin token holds
 * `write:admin` alone, for the rare account acts: signup, a new password,
 * deleting an account, revoking a session's token.
 *
 * `services/api/dev-service-token.ts` mints the same two in dev, and a test
 * holds its scopes to these.
 */
export const DEFAULT_SERVICE_TOKEN_SCOPES = [
  "read:admin",
  "read:issue",
  "read:organization",
  "read:repository",
  "read:user",
] as const;
export const DEFAULT_ADMIN_TOKEN_SCOPES = ["write:admin"] as const;

/**
 * Which token to mint. `combined` is the one token a host had before the
 * split — both scope sets — minted only while SSM has no `gitea_admin_token`
 * parameter yet, so a deploy that lands before its Terraform cannot leave the
 * API without `write:admin`.
 */
export type TokenKind = "service" | "admin" | "combined";
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
  adminTokenName: string;
  adminTokenScopes: string[];
  adminSsmParameterName: string;
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

function resolveTokenScopes(
  scopesRaw: string | undefined,
  defaults: readonly string[],
): string[] {
  const configuredScopes = (scopesRaw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");

  return Array.from(new Set<string>([...configuredScopes, ...defaults]));
}

export function resolveServiceTokenScopes(scopesRaw?: string): string[] {
  return resolveTokenScopes(scopesRaw, DEFAULT_SERVICE_TOKEN_SCOPES);
}

export function resolveAdminTokenScopes(scopesRaw?: string): string[] {
  return resolveTokenScopes(scopesRaw, DEFAULT_ADMIN_TOKEN_SCOPES);
}

export function resolveSsmParameterName(
  parameterPathRaw?: string,
  leaf = "gitea_service_token",
): string {
  const trimmedPath =
    parameterPathRaw?.trim().replace(/\/+$/, "") || DEFAULT_SSM_PARAMETER_PATH;
  return `${trimmedPath}/${leaf}`;
}

function resolveParameterPath(parameterPathRaw?: string): string {
  return (
    parameterPathRaw?.trim().replace(/\/+$/, "") || DEFAULT_SSM_PARAMETER_PATH
  );
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

  const valueOf = (leaf: string) =>
    parameters.find(
      (parameter) => parameter.Name === `${parameterPath}/${leaf}`,
    )?.Value;
  const tokenValue = valueOf("gitea_service_token");
  // Absent means this host predates the split: nothing to mint for it.
  const adminTokenValue = valueOf("gitea_admin_token");
  // The first-boot admin credentials are what mint the tokens, so they stay
  // until neither token is waiting to be minted.
  const tokensMinted =
    tokenValue !== undefined &&
    tokenValue !== bootstrapPlaceholder &&
    adminTokenValue !== bootstrapPlaceholder;

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
      tokensMinted &&
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
    "trap cleanup EXIT",
    'aws ssm get-parameters-by-path --path "$PARAMETER_PATH" --recursive --with-decryption --output json > "$TMP_JSON"',
    'docker run --rm -i -v "$APP_DIR:/workspace" -w /workspace oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 bun scripts/bootstrap-gitea-service-account.ts render-env --parameter-path "$PARAMETER_PATH" < "$TMP_JSON" > "$TMP_ENV"',
    'install -m 0600 "$TMP_ENV" "$ENV_FILE"',
    "SERVICE_TOKEN=$(grep '^GITEA_SERVICE_TOKEN=' \"$ENV_FILE\" | cut -d= -f2- || true)",
    'if [ -z "$SERVICE_TOKEN" ]; then echo "GITEA_SERVICE_TOKEN is missing from $ENV_FILE"; exit 1; fi',
    // Absent until the secrets Terraform that adds it is applied.
    "ADMIN_TOKEN=$(grep '^GITEA_ADMIN_TOKEN=' \"$ENV_FILE\" | cut -d= -f2- || true)",
    'if [ "$SERVICE_TOKEN" != "$BOOTSTRAP_TOKEN_PLACEHOLDER" ] && [ "$ADMIN_TOKEN" != "$BOOTSTRAP_TOKEN_PLACEHOLDER" ]; then echo "Gitea service tokens already bootstrapped"; exit 0; fi',
    "set -a",
    '. "$ENV_FILE"',
    "set +a",
    'if [ -z "${GITEA_ADMIN_USER:-}" ] || [ -z "${GITEA_ADMIN_PASS:-}" ]; then echo "GITEA_ADMIN_USER and GITEA_ADMIN_PASS are required while a service token is still a bootstrap placeholder"; exit 1; fi',
    'cd "$APP_DIR"',
    'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d gitea',
    `for _ in $(seq 1 60); do STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' bindersnap-gitea-prod 2>/dev/null || true); if [ "$STATUS" = "healthy" ]; then break; fi; sleep 5; done`,
    `STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' bindersnap-gitea-prod 2>/dev/null || true)`,
    'if [ "$STATUS" != "healthy" ]; then echo "Gitea did not become ready in time"; exit 1; fi',
    'GITEA_ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-${GITEA_ADMIN_USER}@${BINDERSNAP_USER_EMAIL_DOMAIN:-users.bindersnap.com}}"',
    'if ! docker exec --user "${GITEA_EXEC_USER:-1000:1000}" bindersnap-gitea-prod gitea --config /data/gitea/conf/app.ini admin user create --username "$GITEA_ADMIN_USER" --password "$GITEA_ADMIN_PASS" --email "$GITEA_ADMIN_EMAIL" --admin --must-change-password=false; then docker exec --user "${GITEA_EXEC_USER:-1000:1000}" bindersnap-gitea-prod gitea --config /data/gitea/conf/app.ini admin user change-password --username "$GITEA_ADMIN_USER" --password "$GITEA_ADMIN_PASS" --must-change-password=false; fi',
    'mint() { docker run --rm --network bindersnap-prod -e GITEA_ADMIN_USER -e GITEA_ADMIN_PASS -e GITEA_INTERNAL_URL=http://gitea:3000 -e BINDERSNAP_USER_EMAIL_DOMAIN="${BINDERSNAP_USER_EMAIL_DOMAIN:-users.bindersnap.com}" -v "$APP_DIR:/workspace" -w /workspace oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 bun scripts/bootstrap-gitea-service-account.ts mint-token --kind "$1"; }',
    // Both are minted whenever either is due: the service token is re-minted
    // read-only, which takes `write:admin` off a host's pre-split token.
    'if [ -z "$ADMIN_TOKEN" ]; then SERVICE_KIND=combined; else SERVICE_KIND=service; fi',
    'SERVICE_TOKEN=$(mint "$SERVICE_KIND")',
    'if [ -z "$SERVICE_TOKEN" ]; then echo "mint-token returned an empty service token"; exit 1; fi',
    'aws ssm put-parameter --name "$PARAMETER_PATH/gitea_service_token" --type SecureString --value "$SERVICE_TOKEN" --overwrite --region "${AWS_REGION:-us-east-1}"',
    'if [ -n "$ADMIN_TOKEN" ]; then ADMIN_TOKEN=$(mint admin); if [ -z "$ADMIN_TOKEN" ]; then echo "mint-token returned an empty admin token"; exit 1; fi; aws ssm put-parameter --name "$PARAMETER_PATH/gitea_admin_token" --type SecureString --value "$ADMIN_TOKEN" --overwrite --region "${AWS_REGION:-us-east-1}"; fi',
    'aws ssm get-parameters-by-path --path "$PARAMETER_PATH" --recursive --with-decryption --output json > "$TMP_JSON"',
    'docker run --rm -i -v "$APP_DIR:/workspace" -w /workspace oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 bun scripts/bootstrap-gitea-service-account.ts render-env --parameter-path "$PARAMETER_PATH" < "$TMP_JSON" > "$TMP_ENV"',
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
    adminTokenName:
      env.GITEA_ADMIN_TOKEN_NAME?.trim() || DEFAULT_ADMIN_TOKEN_NAME,
    adminTokenScopes: resolveAdminTokenScopes(env.GITEA_ADMIN_TOKEN_SCOPES),
    adminSsmParameterName: resolveSsmParameterName(
      env.SSM_PARAMETER_PATH,
      "gitea_admin_token",
    ),
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

/** The name and scopes a kind of token is minted with. */
export function tokenSpec(
  config: BootstrapConfig,
  kind: TokenKind,
): { name: string; scopes: string[] } {
  if (kind === "admin") {
    return { name: config.adminTokenName, scopes: config.adminTokenScopes };
  }
  if (kind === "combined") {
    return {
      name: config.serviceTokenName,
      scopes: Array.from(
        new Set([...config.serviceTokenScopes, ...config.adminTokenScopes]),
      ),
    };
  }
  return { name: config.serviceTokenName, scopes: config.serviceTokenScopes };
}

async function rotateToken(
  config: BootstrapConfig,
  kind: TokenKind,
): Promise<string> {
  const { name, scopes } = tokenSpec(config, kind);
  const deleteResponse = await giteaRequest(
    config,
    `/api/v1/users/${encodeURIComponent(config.serviceUsername)}/tokens/${encodeURIComponent(name)}`,
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
      body: JSON.stringify({ name, scopes }),
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
  options?: { log?: boolean; kind?: TokenKind },
): Promise<string> {
  const log = options?.log ?? true;
  const kind = options?.kind ?? "service";
  const { name, scopes } = tokenSpec(config, kind);

  if (log) {
    console.log(
      `Ensuring Gitea service account ${config.serviceUsername} exists at ${config.giteaUrl}`,
    );
  }
  await ensureServiceUser(config);

  if (log) {
    console.log(`Rotating PAT ${name} with scopes: ${scopes.join(", ")}`);
  }
  return rotateToken(config, kind);
}

function writeTokenToSsm(
  config: BootstrapConfig,
  parameterName: string,
  token: string,
): void {
  const result = Bun.spawnSync(
    buildPutParameterArgs(parameterName, token, config.awsRegion),
    {
      stderr: "pipe",
      stdout: "pipe",
      env: process.env,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to write ${parameterName} to SSM: ${result.stderr.toString().trim() || result.stdout.toString().trim() || "aws ssm put-parameter failed"}`,
    );
  }
}

export async function bootstrapGiteaServiceAccount(
  config = resolveBootstrapConfig(),
): Promise<void> {
  const serviceToken = await ensureServiceUserAndRotateToken(config, {
    log: true,
    kind: "service",
  });
  const adminToken = await ensureServiceUserAndRotateToken(config, {
    log: true,
    kind: "admin",
  });

  console.log(`Writing ${config.ssmParameterName} to SSM Parameter Store`);
  writeTokenToSsm(config, config.ssmParameterName, serviceToken);
  console.log(`Writing ${config.adminSsmParameterName} to SSM Parameter Store`);
  writeTokenToSsm(config, config.adminSsmParameterName, adminToken);

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
    const kindIndex = args.indexOf("--kind");
    const kind = (
      kindIndex >= 0 ? args[kindIndex + 1] : "service"
    ) as TokenKind;
    if (!["service", "admin", "combined"].includes(kind)) {
      throw new Error(`Unknown token kind: ${kind}`);
    }
    const token = await ensureServiceUserAndRotateToken(
      resolveBootstrapConfig(),
      { log: false, kind },
    );
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
