#!/usr/bin/env bun
// Generates TypeScript types from the local Gitea instance's OpenAPI spec.
//
// Usage:
//   bun run generate:api            (requires Gitea running at localhost:3000)
//   GITEA_URL=http://host:3000 bun run generate:api

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";

// --- Utility: Deep Merge Objects ---
function isObject(item: any) {
  return item && typeof item === "object" && !Array.isArray(item);
}

function deepMerge(target: any, source: any) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        // Arrays (like our enums) and primitives will simply overwrite the target
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return target;
}
// -----------------------------------

async function main() {
  const GITEA_URL = process.env.GITEA_URL || "http://localhost:3000";
  const SPEC_DIR = "packages/gitea-client/spec";
  const SWAGGER2_FILE = path.join(SPEC_DIR, "swagger2.json");
  const OPENAPI3_FILE = path.join(SPEC_DIR, "openapi3.json");
  const EXTENSIONS_FILE = path.join(SPEC_DIR, "extensions.json");
  const TYPES_FILE = path.join(SPEC_DIR, "gitea.d.ts");

  console.log(
    `→ Fetching Swagger 2.0 spec from ${GITEA_URL}/swagger.v1.json ...`,
  );

  // Verify Gitea is reachable
  try {
    const versionCheck = await fetch(`${GITEA_URL}/api/v1/version`);
    if (!versionCheck.ok) throw new Error("Not ok");
  } catch (error) {
    console.error(`ERROR: Cannot reach Gitea at ${GITEA_URL}`);
    console.error(`       Start the dev stack with: bun run up`);
    process.exit(1);
  }

  await fs.mkdir(SPEC_DIR, { recursive: true });

  // 1. Pull swagger spec
  const swaggerResponse = await fetch(`${GITEA_URL}/swagger.v1.json`);
  if (!swaggerResponse.ok) {
    console.error(`ERROR: Failed to download swagger.v1.json`);
    process.exit(1);
  }

  const swaggerData = await swaggerResponse.text();
  await fs.writeFile(SWAGGER2_FILE, swaggerData, "utf8");

  const parsedSwagger = JSON.parse(swaggerData);
  const GITEA_VERSION = parsedSwagger.info?.version || "unknown";
  console.log(`  Gitea version: ${GITEA_VERSION}`);

  // 2. Convert Swagger 2.0 → OpenAPI 3.0
  console.log(`→ Converting to OpenAPI 3.0 ...`);
  try {
    execSync(`npx swagger2openapi "${SWAGGER2_FILE}" -o "${OPENAPI3_FILE}"`, {
      stdio: "ignore",
    });
  } catch (error) {
    console.error(`ERROR: swagger2openapi failed`);
    process.exit(1);
  }

  // 3. Apply Custom Extensions (Enums, Overrides)
  try {
    const extensionsData = await fs.readFile(EXTENSIONS_FILE, "utf8");
    console.log(
      `→ Applying custom spec extensions from ${EXTENSIONS_FILE} ...`,
    );

    const openapiSpec = JSON.parse(await fs.readFile(OPENAPI3_FILE, "utf8"));
    const extensions = JSON.parse(extensionsData);

    const patchedSpec = deepMerge(openapiSpec, extensions);

    // Overwrite the OpenAPI 3.0 file with our patched version
    await fs.writeFile(
      OPENAPI3_FILE,
      JSON.stringify(patchedSpec, null, 2),
      "utf8",
    );
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(`  (No spec-extensions.json found. Skipping patch step.)`);
    } else {
      console.error(`ERROR: Failed to apply spec extensions:`, error);
      process.exit(1);
    }
  }

  // 4. Generate TypeScript types
  console.log(`→ Generating TypeScript types ...`);
  try {
    execSync(`npx openapi-typescript "${OPENAPI3_FILE}" -o "${TYPES_FILE}"`, {
      stdio: "pipe",
    });
  } catch (error) {
    console.error(`ERROR: openapi-typescript failed`);
    process.exit(1);
  }

  // 5. Prepend version header
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const header = `// Generated from Gitea ${GITEA_VERSION} at ${generatedAt}
// Source: ${GITEA_URL}/swagger.v1.json
// Note: Types have been extended via extensions.json
// Do not edit manually — re-run: bun run generate:api\n\n`;

  const typesContent = await fs.readFile(TYPES_FILE, "utf8");
  const finalFileContent = header + typesContent;
  await fs.writeFile(TYPES_FILE, finalFileContent, "utf8");

  // 6. Clean up intermediate files
  //   await fs.rm(SWAGGER2_FILE, { force: true });
  //   await fs.rm(OPENAPI3_FILE, { force: true });

  const lines = finalFileContent.split("\n").length;
  console.log("");
  console.log(`✓ Generated ${TYPES_FILE}`);
  console.log(`  Gitea ${GITEA_VERSION} · ${lines} lines`);
  console.log(`  Commit this file. Re-run after upgrading Gitea.`);
}

main().catch((error) => {
  console.error("Unhandled script error:", error);
  process.exit(1);
});
