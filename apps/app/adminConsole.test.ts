import { expect, test } from "bun:test";

import {
  formatAdminSeconds,
  formatRange,
  formatSize,
  overallHealth,
} from "./adminConsole";

test("overallHealth leads with the worst check", () => {
  const check = (status: "ok" | "warn" | "down") => ({
    id: status,
    label: status,
    status,
    detail: "",
  });
  expect(overallHealth([check("ok"), check("ok")])).toBe("ok");
  expect(overallHealth([check("ok"), check("warn")])).toBe("warn");
  expect(overallHealth([check("warn"), check("down")])).toBe("down");
});

test("formatRange says where in the list the page is", () => {
  expect(formatRange({ page: 1, limit: 25, shown: 25, total: 112 })).toBe(
    "1–25 of 112",
  );
  expect(formatRange({ page: 2, limit: 25, shown: 10, total: null })).toBe(
    "26–35",
  );
  expect(formatRange({ page: 1, limit: 25, shown: 0, total: 0 })).toBe(
    "0 of 0",
  );
});

test("formatSize reads Gitea's kilobytes", () => {
  expect(formatSize(12)).toBe("12 KB");
  expect(formatSize(2048)).toBe("2.0 MB");
  expect(formatSize(50 * 1024)).toBe("50 MB");
  expect(formatSize(3 * 1024 * 1024)).toBe("3.0 GB");
});

test("formatAdminSeconds reads Stripe's seconds", () => {
  expect(formatAdminSeconds(null)).toBe("—");
  expect(formatAdminSeconds(Date.UTC(2026, 2, 14, 12) / 1000)).toBe(
    "Mar 14, 2026",
  );
});
