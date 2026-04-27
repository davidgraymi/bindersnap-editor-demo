/**
 * Structured JSON logger for the Bindersnap API service.
 *
 * Outputs one JSON line per entry to stdout so log aggregators (CloudWatch,
 * Docker json-file driver, Loki, etc.) can ingest and query structured fields.
 *
 * Log levels (lowest → highest severity):
 *   debug < info < warn < error
 *
 * The active level is controlled by the LOG_LEVEL env var.
 * Default: "info" in production (NODE_ENV=production), "debug" otherwise.
 */

import { config, type LogLevel } from "./config";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const activeLevelRank: number = LEVEL_RANK[config.logLevel];

export type LogMeta = Record<string, unknown>;

function emit(level: LogLevel, message: string, meta?: LogMeta): void {
  if (LEVEL_RANK[level] < activeLevelRank) {
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  // console.log writes to stdout; console.error writes to stderr.
  // We keep everything on stdout so a single log stream is captured by Docker /
  // CloudWatch without mixing channels.
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    emit("debug", message, meta);
  },

  info(message: string, meta?: LogMeta): void {
    emit("info", message, meta);
  },

  warn(message: string, meta?: LogMeta): void {
    emit("warn", message, meta);
  },

  error(message: string, meta?: LogMeta): void {
    emit("error", message, meta);
  },
};
