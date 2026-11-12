import { describe, expect, test } from "bun:test";

import { formatPageTitle, routeTitle } from "./pageTitle";
import { getRoute } from "./routes";

const titleAt = (path: string) => routeTitle(getRoute(path));

describe("the browser tab's title", () => {
  test("the app's own pages say what they list", () => {
    expect(titleAt("/")).toBe("Home · Bindersnap");
    expect(titleAt("/-/changes")).toBe("Change requests · Bindersnap");
    expect(titleAt("/-/drafts")).toBe("Drafts · Bindersnap");
    expect(titleAt("/-/binders")).toBe("Binders · Bindersnap");
    expect(titleAt("/-/user_settings/profile")).toBe(
      "Your account · Bindersnap",
    );
    expect(titleAt("/-/admin/users")).toBe("People · Admin · Bindersnap");
  });

  test("an organization's pages name the organization last", () => {
    expect(titleAt("/riverside-health")).toBe("Riverside Health · Bindersnap");
    expect(titleAt("/riverside-health/-/people")).toBe(
      "People & access · Riverside Health · Bindersnap",
    );
    expect(titleAt("/riverside-health/-/billing")).toBe(
      "Billing · Riverside Health · Bindersnap",
    );
  });

  test("a binder's pages put the page before the binder", () => {
    expect(titleAt("/riverside-health/corporate")).toBe(
      "Corporate · Riverside Health · Bindersnap",
    );
    expect(titleAt("/riverside-health/corporate/-/changes")).toBe(
      "Change requests · Corporate · Bindersnap",
    );
    expect(titleAt("/riverside-health/corporate/-/changes/16")).toBe(
      "Change 16 · Corporate · Bindersnap",
    );
    expect(titleAt("/riverside-health/corporate/-/changes/16/diffs")).toBe(
      "Changes in change 16 · Corporate · Bindersnap",
    );
    expect(titleAt("/riverside-health/corporate/-/history")).toBe(
      "History · Corporate · Bindersnap",
    );
    expect(titleAt("/riverside-health/corporate/-/settings/people")).toBe(
      "People & access · Settings · Corporate · Bindersnap",
    );
  });

  test("a folder and a document are named as a person says them", () => {
    expect(
      titleAt("/riverside-health/clinical/-/tree/main/nursing/wards"),
    ).toBe("Wards · Clinical · Bindersnap");
    expect(
      titleAt(
        "/riverside-health/corporate/-/blob/main/finance/expenses-policy",
      ),
    ).toBe("Expenses Policy · Corporate · Bindersnap");
    // The identity and the file type are the file's, not the document's name.
    expect(
      titleAt(
        "/riverside-health/clinical/-/blob/main/nursing/hand-hygiene.01J8XZ4K7MQ9V3B0RN7YHS2E1D.json",
      ),
    ).toBe("Hand Hygiene · Clinical · Bindersnap");
  });

  test("a page's own title drops blanks and never says a name twice", () => {
    expect(formatPageTitle(["Clinical", "Clinical"])).toBe(
      "Clinical · Bindersnap",
    );
    expect(formatPageTitle([" ", null, "Travel Policy"])).toBe(
      "Travel Policy · Bindersnap",
    );
    expect(formatPageTitle([])).toBe("Bindersnap");
  });
});
