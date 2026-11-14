import { describe, expect, test } from "bun:test";

import { HELP_GUIDES, helpSectionId } from "./helpGuides";
import {
  guideForRoute,
  helpHref,
  helpTargetExists,
  type HelpGuideSlug,
} from "./helpLinks";
import { getRoute } from "./routes";

const guideAt = (path: string) => {
  const [pathname, search = ""] = path.split("?");
  return guideForRoute(getRoute(pathname!), search);
};

describe("help from where the question comes up", () => {
  test("a section's anchor is its heading, in lower case with hyphens", () => {
    expect(helpSectionId("Who signs off on a folder or a document")).toBe(
      "who-signs-off-on-a-folder-or-a-document",
    );
    expect(helpSectionId("PDF, Word & the audit packet")).toBe(
      "pdf-word-the-audit-packet",
    );
  });

  test("no two sections of a guide share an anchor", () => {
    for (const guide of HELP_GUIDES) {
      const ids = guide.sections.map((section) =>
        helpSectionId(section.heading),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("a link names the guide and, when asked, the section", () => {
    expect(helpHref()).toBe("/help");
    expect(helpHref("reviewing")).toBe("/help/reviewing");
    expect(helpHref("approvals", "How many approvals")).toBe(
      "/help/approvals#how-many-approvals",
    );
  });

  test("the page on screen picks its guide", () => {
    expect(guideAt("/")).toBeNull();
    expect(guideAt("/-/changes")).toBe("reviewing");
    expect(guideAt("/-/drafts")).toBe("writing");
    expect(guideAt("/riverside-health/-/people")).toBe("people");
    expect(guideAt("/riverside-health/corporate")).toBeNull();
    expect(guideAt("/riverside-health/corporate/-/changes/16")).toBe(
      "reviewing",
    );
    expect(guideAt("/riverside-health/corporate/-/changes/16/conflicts")).toBe(
      "out-of-date",
    );
    expect(guideAt("/riverside-health/corporate/-/history")).toBe("finding");
    expect(
      guideAt("/riverside-health/corporate/-/settings/change-requests"),
    ).toBe("approvals");
    expect(
      guideAt("/riverside-health/corporate/-/blob/main/finance/travel-policy"),
    ).toBe("exporting");
    expect(
      guideAt(
        "/riverside-health/corporate/-/blob/main/finance/travel-policy?edit=write&draft=d",
      ),
    ).toBe("writing");
  });

  test("every guide a page can pick exists", () => {
    const slugs = new Set(HELP_GUIDES.map((guide) => guide.slug));
    const picked: HelpGuideSlug[] = [
      "getting-started",
      "adding-documents",
      "writing",
      "approvals",
      "reviewing",
      "out-of-date",
      "exporting",
      "finding",
      "people",
      "notifications",
    ];
    for (const slug of picked) expect(slugs.has(slug)).toBe(true);
    expect(slugs.size).toBe(picked.length);
  });

  // The sections the app links to by heading. Reword one in helpGuides.ts and
  // this fails, which is the point: the link would land at the top of the page.
  test("every section the app links to is still there", () => {
    const linked: [HelpGuideSlug, string][] = [
      ["approvals", "Who signs off on a folder or a document"],
      ["approvals", "Who approves changes"],
      ["reviewing", "If you cannot approve"],
      ["out-of-date", "Resolve conflicts"],
      ["writing", "Saving"],
      ["people", "Who costs a seat"],
    ];
    for (const [guide, heading] of linked) {
      expect(helpTargetExists(guide, heading)).toBe(true);
    }
  });
});
