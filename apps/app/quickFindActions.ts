import { HELP_GUIDES } from "./helpGuides";
import type { AppRoute } from "./routes";
import { siteUrl } from "./siteLink";

/**
 * Bindersnap's own pages and controls, as things quick find can reach.
 *
 * Quick find searched what is in the binders — documents, change requests,
 * binders, people — and nothing about the product around them. Typing "help"
 * found nothing, and so did "billing", "dark" and "collapse": the answer was
 * always somewhere in a menu, and the reader who opened search had already
 * said they would rather type than hunt (issue 648). So the menus' entries are
 * searchable too, each matched by its name and by the words somebody would
 * type looking for it.
 *
 * Decided here so the panel only renders: what is on offer depends on where
 * the reader is (an organization's pages need an organization, a binder's
 * settings need a binder) and on what they may do (only a site admin has the
 * console). Nothing here touches the page; a control is named, and the shell
 * carries it out.
 */

/** Something the shell does rather than somewhere it goes. */
export type QuickFindCommand =
  | "toggleTheme"
  | "toggleSidebar"
  | "sendFeedback"
  | "showGuide"
  | "newBinder"
  | "signOut";

export type QuickFindActionTarget =
  | { kind: "route"; route: AppRoute }
  /** On the public site, which opens beside the app, as the menus open it. */
  | { kind: "link"; href: string }
  | { kind: "command"; command: QuickFindCommand };

export interface QuickFindAction {
  /** Unique among actions; becomes the row's key. */
  id: string;
  /** What the row says: the name the menu or the page already uses. */
  name: string;
  /** The one line under it: where it is, or what it is about. */
  meta: string;
  /**
   * Words somebody might type instead of the name. "Plan" for Billing, "dark"
   * for the theme — the question as asked, not as the menu answers it.
   */
  keywords: string;
  target: QuickFindActionTarget;
}

/** Where the reader is and what they may do: what decides the list. */
export interface QuickFindActionContext {
  /** The organization on screen, or null when none is known yet. */
  org: string | null;
  /** Its display name, for a row to say which organization it is about. */
  orgName: string;
  /** The binder on screen, if the page is inside one. */
  binder: { org: string; binder: string; name: string } | null;
  isSiteAdmin: boolean;
  theme: "light" | "dark";
  /** Whether the sidebar is shut, or null where there is no sidebar. */
  sidebarCollapsed: boolean | null;
  canSendFeedback: boolean;
  /** The getting-started guide is hidden but not finished. */
  canShowGuide: boolean;
}

const ADMIN_PAGES: ReadonlyArray<{
  section: Exclude<Extract<AppRoute, { kind: "admin" }>["section"], "overview">;
  name: string;
  keywords: string;
}> = [
  { section: "users", name: "Users", keywords: "accounts people new account" },
  {
    section: "organizations",
    name: "Organizations",
    keywords: "free access grant",
  },
  { section: "binders", name: "Binders", keywords: "workspaces" },
  { section: "signups", name: "Signups", keywords: "sources marketing" },
  { section: "growth", name: "Growth", keywords: "trials activity funnel" },
  {
    section: "system",
    name: "System",
    keywords: "versions images memory disk maintenance",
  },
  { section: "config", name: "Configuration", keywords: "settings secrets" },
];

const LEGAL_PAGES: ReadonlyArray<{
  slug: string;
  name: string;
  keywords: string;
}> = [
  { slug: "terms", name: "Terms of Service", keywords: "legal agreement" },
  { slug: "privacy", name: "Privacy Policy", keywords: "legal data" },
  { slug: "security", name: "Security", keywords: "legal" },
  {
    slug: "dpa",
    name: "Data Processing Addendum",
    keywords: "legal dpa",
  },
  {
    slug: "subprocessors",
    name: "Subprocessors",
    keywords: "legal third parties",
  },
];

/** Everything the reader can reach from here, in the order menus list it. */
export function listQuickFindActions(
  context: QuickFindActionContext,
): QuickFindAction[] {
  const { org, binder } = context;
  const orgName = context.orgName || org || "";
  const actions: QuickFindAction[] = [
    {
      id: "home",
      name: "Home",
      meta: "Your work, and what is waiting on you",
      keywords: "dashboard start overview",
      target: { kind: "route", route: { kind: "workspace" } },
    },
    {
      id: "changes",
      name: "Change requests",
      meta: "Every change in flight, across your binders",
      keywords: "reviews approvals queue waiting",
      target: { kind: "route", route: { kind: "changes" } },
    },
    {
      id: "binders",
      name: "Binders",
      meta: "Every binder you can open",
      keywords: "workspaces manuals",
      target: { kind: "route", route: { kind: "binders" } },
    },
    {
      id: "documents",
      name: "Documents",
      meta: "Every document in every binder",
      keywords: "library policies procedures files all",
      target: { kind: "route", route: { kind: "documents" } },
    },
    {
      id: "account",
      name: "Your account",
      meta: "Your name, email address and password",
      keywords: "profile settings password email user delete",
      target: { kind: "route", route: { kind: "accountSettings" } },
    },
    {
      id: "billing",
      name: "Billing",
      meta: orgName ? `Plan and payment for ${orgName}` : "Plan and payment",
      keywords:
        "plan subscription payment card invoice pay trial seats writers price upgrade",
      target: {
        kind: "route",
        route: org ? { kind: "billing", org } : { kind: "billing" },
      },
    },
  ];

  if (org) {
    actions.push(
      {
        id: "org-people",
        name: "People & access",
        meta: `Who is in ${orgName}, and their groups`,
        keywords: "members invite invitations team groups users add person",
        target: {
          kind: "route",
          route: { kind: "organization", org, tab: "people" },
        },
      },
      {
        id: "org-settings",
        name: "Organization settings",
        meta: orgName,
        keywords: "rename delete",
        target: {
          kind: "route",
          route: { kind: "organization", org, tab: "settings" },
        },
      },
    );
  }

  if (binder) {
    const at = (tab: Extract<AppRoute, { kind: "binder" }>["tab"]) => ({
      kind: "route" as const,
      route: {
        kind: "binder" as const,
        org: binder.org,
        binder: binder.binder,
        tab,
      },
    });
    actions.push(
      {
        id: "binder-history",
        name: "History",
        meta: `Every version published in ${binder.name}`,
        keywords: "versions published record audit trail log",
        target: at("history"),
      },
      {
        id: "binder-settings",
        name: "Binder settings",
        meta: binder.name,
        keywords: "general rename delete",
        target: at("settings"),
      },
      {
        id: "binder-people",
        name: "People & access",
        meta: `Who can read ${binder.name}, and who can change it`,
        keywords: "members groups readers writers add person",
        target: at("people"),
      },
      {
        id: "binder-approvals",
        name: "Change request settings",
        meta: `Who approves a change in ${binder.name}`,
        keywords:
          "approvers approvals approve sign-off signoff rules required reviewers",
        target: at("change-requests"),
      },
    );
  }

  if (org) {
    actions.push({
      id: "new-binder",
      name: "New binder",
      meta: `In ${orgName}`,
      keywords: "create add make",
      target: { kind: "command", command: "newBinder" },
    });
  }

  actions.push(
    {
      id: "new-organization",
      name: "New organization",
      meta: "Create one, or ask to join one",
      keywords: "create add make join",
      target: { kind: "route", route: { kind: "createOrganization" } },
    },
    {
      id: "theme",
      name:
        context.theme === "dark"
          ? "Switch to the light theme"
          : "Switch to the dark theme",
      meta: "Appearance",
      keywords: "theme dark light mode appearance color colour night toggle",
      target: { kind: "command", command: "toggleTheme" },
    },
  );

  if (context.sidebarCollapsed !== null) {
    actions.push({
      id: "sidebar",
      name: context.sidebarCollapsed
        ? "Expand the navigation"
        : "Collapse the navigation",
      meta: "The sidebar on the left",
      keywords: "sidebar navigation nav menu left panel hide show toggle",
      target: { kind: "command", command: "toggleSidebar" },
    });
  }

  if (context.canShowGuide) {
    actions.push({
      id: "guide",
      name: "Getting-started guide",
      meta: "Pick up where you left off",
      keywords: "onboarding setup steps tour",
      target: { kind: "command", command: "showGuide" },
    });
  }

  if (context.isSiteAdmin) {
    actions.push(
      {
        id: "admin",
        name: "Site admin",
        meta: "Health checks and the whole deployment",
        keywords: "console administration",
        target: {
          kind: "route",
          route: { kind: "admin", section: "overview" },
        },
      },
      ...ADMIN_PAGES.map((page): QuickFindAction => ({
        id: `admin-${page.section}`,
        name: `Site admin: ${page.name}`,
        meta: "Site admin",
        keywords: `console administration ${page.keywords}`,
        target: {
          kind: "route",
          route: { kind: "admin", section: page.section },
        },
      })),
    );
  }

  actions.push({
    id: "help",
    name: "Help and guides",
    meta: "Opens in a new tab",
    keywords: "support documentation docs how questions faq manual",
    target: { kind: "link", href: siteUrl("/help") },
  });

  for (const guide of HELP_GUIDES) {
    actions.push({
      id: `help-${guide.slug}`,
      name: guide.title,
      meta: "Help guide · opens in a new tab",
      keywords: `help guide ${guide.summary}`,
      target: { kind: "link", href: siteUrl(`/help/${guide.slug}`) },
    });
  }

  if (context.canSendFeedback) {
    actions.push({
      id: "feedback",
      name: "Send feedback",
      meta: "Tell us what is wrong, or what is missing",
      keywords: "bug report problem contact suggestion idea support",
      target: { kind: "command", command: "sendFeedback" },
    });
  }

  for (const page of LEGAL_PAGES) {
    actions.push({
      id: `legal-${page.slug}`,
      name: page.name,
      meta: "Legal · opens in a new tab",
      keywords: page.keywords,
      target: { kind: "link", href: siteUrl(`/legal/${page.slug}`) },
    });
  }

  actions.push({
    id: "sign-out",
    name: "Sign out",
    meta: "End this session",
    keywords: "log out logout signout leave",
    target: { kind: "command", command: "signOut" },
  });

  return actions;
}

/** Lowercase words, so "People & access" is "people", "access". */
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Every typed word starts some word here. */
function everyWordStarts(typed: string[], haystack: string[]): boolean {
  return typed.every((word) =>
    haystack.some((candidate) => candidate.startsWith(word)),
  );
}

/**
 * How well one action answers what was typed: 0 is not at all.
 *
 * **Word starts, not substrings.** Documents are matched anywhere in their
 * name, because the server does; a short list of controls matched that way
 * turns "in" into half the menu. A typed word has to begin a word of the
 * name, or of the words somebody might type instead, and the name counts for
 * more — "billing" should find Billing before it finds a guide that mentions
 * a bill.
 */
export function scoreQuickFindAction(
  action: QuickFindAction,
  query: string,
): number {
  const typed = words(query);
  if (typed.length === 0) return 0;
  const name = words(action.name);
  const asked = typed.join(" ");
  if (name.join(" ").startsWith(asked)) return 3;
  if (everyWordStarts(typed, name)) return 2;
  if (everyWordStarts(typed, [...name, ...words(action.keywords)])) return 1;
  return 0;
}

/** The actions matching a query, best first, at most `limit` of them. */
export function matchQuickFindActions(
  actions: QuickFindAction[],
  query: string,
  limit: number,
): QuickFindAction[] {
  return actions
    .map((action, index) => ({
      action,
      index,
      score: scoreQuickFindAction(action, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.action);
}
