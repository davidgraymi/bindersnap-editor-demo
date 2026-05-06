import { defineConfig } from "orval";

export default defineConfig({
  bindersnap: {
    input: {
      target: "./packages/api-schema/openapi.json",
    },
    output: {
      mode: "tags-split",
      target: "./packages/api-client",
      schemas: "./packages/api-client/model",
      client: "fetch",
      override: {
        mutator: {
          path: "./packages/api-client/mutator.ts",
          name: "customFetch",
        },
        fetch: {
          includeHttpStatusReturnType: false,
        },
      },
    },
  },
});
