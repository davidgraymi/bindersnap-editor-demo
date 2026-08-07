export * from "./client";
export * from "./auth";
export * from "./discussions";
export * from "./documents";
export * from "./pullRequests";
export * from "./reviewSettings";
export * from "./repos";
export * from "./uploads";

// Re-export generated types for consumers that need raw Gitea API types
export type { components, operations, paths } from "./spec/gitea";
