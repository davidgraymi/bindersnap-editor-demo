import { expect, test } from "@playwright/test";

import { signInAsBob } from "./helpers";

// A browser test that signs in, navigates and waits on the network does not
// fit the suite-wide 10s budget on a loaded runner — it passes alone in ~7s,
// which leaves nothing spare. Same treatment every other heavy file here
// already gets.
test.describe.configure({ timeout: 60_000 });

test.describe("top nav new policy button", () => {
  test("opens the add-a-policy modal from the documents page", async ({
    page,
  }) => {
    await signInAsBob(page);

    // The sidebar, not the top bar: at this viewport the top bar's links are
    // hidden because the sidebar carries the same destinations.
    await page
      .locator(".app-sidebar")
      .getByRole("button", { name: "Documents" })
      .click();
    await expect(page.locator(".docs-page")).toBeVisible();

    // Subtle by design: the nav's create action is an icon with an accessible
    // name, not a coral button competing with the page's own primary action.
    const newDocButton = page.locator("#topnav-new-doc-btn");
    await expect(newDocButton).toBeVisible();
    await expect(newDocButton).toHaveAccessibleName("New policy");
    await expect(newDocButton).toHaveText("");
    await newDocButton.click();

    // The nav has no binder in scope, so it asks which one first — the one
    // question `AddPolicyModal` cannot ask, because the binder page always
    // knows the answer.
    await expect(
      page.getByRole("heading", { name: "Which binder?" }),
    ).toBeVisible();
    await page.locator(".docs-list-item").first().click();

    await expect(
      page.getByRole("heading", { name: "Add a policy" }),
    ).toBeVisible();
    await expect(page.locator("#add-policy-file")).toBeVisible();
  });
});
