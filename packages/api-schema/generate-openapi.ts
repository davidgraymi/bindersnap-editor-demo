import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { writeFileSync } from "fs";
import { join } from "path";
import registry from "./registry";

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Bindersnap BFF API",
    version: "1.0.0",
  },
  servers: [{ url: "/" }],
});

const outputPath = join(import.meta.dir, "openapi.json");
writeFileSync(outputPath, JSON.stringify(document, null, 2));
console.log("Generated packages/api-schema/openapi.json");
