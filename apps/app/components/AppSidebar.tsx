import { guideForRoute, guideTitle, helpHref } from "../helpLinks";
import { useQuery } from "@tanstack/react-query";
import { AppIcon, ICON, type IconGlyph } from "./AppIcon";

import type { BinderTab } from "../binderShell";
import type { DocumentRefView } from "../documentRefs";
import { followInApp } from "../appLink";
import {
  BINDER_SETTINGS_PAGES,
  binderSettingsSection,
} from "../binderSettings";
import { organizationBindersQuery, organizationsQuery } from "../data/queries";
import { routeToPath, type AppRoute, type OrganizationTab } from "../routes";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

/**
 * The map of the product, always on screen.
 *
 * Before this, the whole of global navigation was "Home · Documents · [org
 * switcher]". Everything else — people, billing, an organization's
 * own page — was reachable only by first entering a binder or by typing a URL,
 * so a new reader had no way to learn what the product contained.
 *
 * **It shows one level at a time, the level you are in** — the way GitLab's
 * is the project's once you are in a project, and the group's in a group. It
 * used to stack all three, so a binder showed two "Change requests" entries
 * and two highlighted rows, and every level's own pages were tabs on the page
 * as well, a second navigation under the first. Now:
 *
 * - **Your work**, everywhere that is nobody's but yours: Home, Change
 *   requests, Documents, and the organizations you are in.
 * - **An organization**: a step back to Home, its name, and its Binders,
 *   People & access, Billing and Settings.
 * - **A binder**: a step back to its organization, its name, and its
 *   Documents, Change requests, History and Settings, with Settings' pages
 *   listed under it while one is open.
 *
 * Each level is titled for its kind — Your work, Organization, Binder — the
 * same label in the same type, so the sidebar always says what kind of place
 * it is showing before it says which one.
 *
 * Each level names the place it is in and offers one step back up, because
 * breadcrumbs alone are not read as a way out by somebody who has never used
 * GitLab. Home is also the logo, and every other place is the search.
 *
 * **The binder you are in is a section of this, and it was a tab bar** (D1,
 * the customer's call). A binder is still a place — one set of rules, one set
 * of people, which is ADR 0004's whole reason for the level — and owning a
 * labelled section of the map is a stronger statement of that than a strip of
 * tabs was. What it buys is the page's one title: with the binder named here,
 * a policy's page is titled by the policy and a change's by what it asks for,
 * instead of both sitting under a heading naming the binder they are visibly
 * inside.
 *
 * **Its contents are an entry, Documents, like its other screens.** The
 * binder's name used to be the way in to them, which read as a heading
 * rather than a place to go.
 *
 * **Below 768px this is not rendered at all** (`.app-sidebar` is
 * `display: none`); the bottom bar carries the places people move between
 * there. Neither is duplicated at any width.
 */

/**
 * Which of the organization's pages is open, or null when none is.
 *
 * The route carries the tab only when the app navigated there itself; an
 * address that was typed, reloaded or opened in a new tab says it in the query.
 */
function organizationTab(route: AppRoute): OrganizationTab | null {
  if (route.kind !== "organization") return null;
  const tab =
    route.tab ?? new URLSearchParams(window.location.search).get("tab");
  return tab === "people" ||
    tab === "settings" ||
    tab === "changes" ||
    tab === "drafts"
    ? tab
    : "binders";
}

/** The binder on screen, as its own section of the map. */
export interface SidebarBinder {
  org: string;
  binder: string;
  /** What it is called, not the slug it is addressed by. */
  name: string;
  /** Which of its screens is open. */
  section: BinderTab;
  /** Changes waiting on a decision, once the binder has counted them. */
  openChangeCount?: number | null;
  /**
   * The binder's contents, while a policy is open.
   *
   * **So you can keep moving while you read**, which is the thing a reader
   * loses the moment a document takes over the page: the binder's own tree is
   * on the binder's page, and opening a policy replaced it. Every other file
   * browser keeps the tree beside the file, and a policy manual is read by
   * looking rather than by navigating — going back to the list to open the
   * next one is the clunk.
   *
   * Null on every screen that already shows the tree, which is most of them.
   * Two trees on one page is one too many.
   */
  contents?: SidebarBinderContents | null;
}

export interface SidebarBinderContents {
  /**
   * The binder's documents, as its own list gives them.
   *
   * Whole entries rather than three fields of each, so the explorer can build
   * its tree with `buildBinderTree` — the same function the binder's own page
   * uses. Two tree builders would disagree about nesting within a month.
   */
  documents: readonly WorkspaceDocumentListEntry[];
  /** Folders the tree read named, so an empty one is still in the tree. */
  folders: readonly string[];
  /** The one being read, so its row is marked. */
  active: string | null;
  /** The folder whose page is open, so its row is marked. */
  activeFolder?: string | null;
  /**
   * The ref these contents were read at, so a row leads somewhere that exists.
   *
   * Clicking through a change's tree stays on that change: the addresses are
   * the branch's, and following one back to `main` would be following a policy
   * to a name it does not have there.
   */
  change?: number | null;
  /** The branch they were read at, so a row leads to the same branch. */
  ref?: string | null;
  /**
   * Which version of this document you are reading, and the others on offer.
   *
   * **The panel is where this belongs**, and the customer said so: *"GitHub
   * handles this by putting a branch selector in the file explorer so that
   * it's clear what branch the user is viewing."* The rows of this panel are
   * addresses on one version of the binder, so the thing naming that version
   * sits at the top of them rather than in a strip over the page.
   *
   * Reported by the document's own page, because the open changes touching a
   * document are something only the document read knows. Empty until it has.
   */
  reading?: DocumentRefView | null;
}

interface AppSidebarProps {
  route: AppRoute;
  /** The organization the org-scoped entries point at. */
  org: string | null;
  /**
   * The binder you are inside, if you are inside one.
   *
   * It appears when you enter a binder and goes when you leave, which is what
   * makes the level visible without it costing a page's title.
   */
  binder?: SidebarBinder | null;
  /**
   * Open Send feedback. Null in a build that cannot send it, and then the
   * foot holds only the collapse toggle.
   */
  onSendFeedback?: (() => void) | null;
  /** How many changes are in flight, once the queue has counted them. */
  changeCount?: number | null;
  /**
   * Whether the map is down to its icons, and the way to change it — held by
   * the shell (`useCollapsedSidebar`) because quick find can change it too.
   */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (route: AppRoute) => void;
}

type Entry = {
  key: string;
  label: string;
  icon: IconGlyph;
  route: AppRoute | null;
  isActive: (route: AppRoute) => boolean;
  count?: number | null;
  /** One of Settings' pages, drawn under it without an icon of its own. */
  sub?: boolean;
  /** Settings, whose pages are listed under it while one is open. */
  expanded?: boolean;
};

export function AppSidebar({
  route,
  org,
  binder = null,
  onSendFeedback = null,
  changeCount = null,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: AppSidebarProps) {
  // Help opens the guide about the page on screen — "Reviewing a change"
  // from a change request — and the list of every guide from anywhere else.
  // Each guide's page lists the others beside it.
  const helpGuide = guideForRoute(route, window.location.search);
  const helpLabel = helpGuide
    ? `Help: ${guideTitle(helpGuide)}`
    : "Help and guides";
  // The org-scoped entries have nowhere to point until we know which
  // organization is on screen. Rendered muted and inert rather than hidden:
  // a map that changes shape as you walk around it is not a map.
  const orgName = useOrganizationDisplayName(org ?? "");
  const organizations = useQuery(organizationsQuery()).data ?? [];
  // The organization's open change requests, counted from the binder list its
  // own page already reads — Gitea carries each binder's count on it.
  const orgBinders = useQuery({
    ...organizationBindersQuery(org ?? ""),
    enabled: org !== null && route.kind === "organization",
  }).data;
  const orgOpenChanges = orgBinders
    ? orgBinders.reduce((sum, binder) => sum + binder.openChangeCount, 0)
    : null;
  const orgRoute = (tab?: OrganizationTab): AppRoute | null =>
    org === null
      ? null
      : { kind: "organization", org, ...(tab ? { tab } : {}) };

  const work: Entry[] = [
    {
      key: "home",
      label: "Home",
      icon: ICON.home,
      route: { kind: "workspace" },
      isActive: (r) => r.kind === "workspace" || r.kind === "home",
    },
    {
      key: "changes",
      label: "Change requests",
      icon: ICON.changeRequest,
      route: { kind: "changes" },
      isActive: (r) => r.kind === "changes",
      count: changeCount,
    },
    {
      // Saved work nobody has been asked to review yet — easy to leave behind
      // in a binder you moved on from, so it has a place to be found.
      key: "drafts",
      label: "Drafts",
      icon: ICON.draft,
      route: { kind: "drafts" },
      isActive: (r) => r.kind === "drafts",
    },
    {
      // Binders, not documents: a binder is one scope, with its own rules and
      // people, and a list mixing every binder's files answered nothing.
      key: "binders",
      label: "Binders",
      icon: ICON.binder,
      route: { kind: "binders" },
      isActive: (r) => r.kind === "binders",
    },
  ];

  /**
   * The binder on screen. Named from the address until the binder has been
   * read, so the sidebar is the binder's from the first frame rather than
   * the organization's for one and the binder's after.
   */
  const scope: SidebarBinder | null =
    binder ??
    (route.kind === "binder" || route.kind === "binderDocument"
      ? {
          org: route.org,
          binder: route.binder,
          name: route.binder,
          section:
            route.kind === "binder" ? (route.tab ?? "documents") : "documents",
        }
      : null);
  const settingsPage = scope ? binderSettingsSection(scope.section) : null;

  /** The binder's own screens, and Settings' pages under it. */
  const binderEntries: Entry[] = scope
    ? [
        {
          key: "binder-documents",
          label: "Documents",
          icon: ICON.document,
          route: { kind: "binder", org: scope.org, binder: scope.binder },
          // A policy open in the binder is one of its documents.
          isActive: (r) =>
            r.kind === "binderDocument" || scope.section === "documents",
        },
        {
          key: "binder-changes",
          // What the page it opens is titled, and what the same list is
          // called under Your work — GitLab's project sidebar says "Merge
          // requests" too, not a shorter word for the same thing.
          label: "Change requests",
          icon: ICON.changeRequest,
          route: {
            kind: "binder",
            org: scope.org,
            binder: scope.binder,
            tab: "changes",
          },
          isActive: (r) => r.kind === "binder" && scope.section === "changes",
          count: scope.openChangeCount ?? null,
        },
        {
          key: "binder-drafts",
          label: "Drafts",
          icon: ICON.draft,
          route: {
            kind: "binder",
            org: scope.org,
            binder: scope.binder,
            tab: "drafts",
          },
          isActive: (r) => r.kind === "binder" && scope.section === "drafts",
        },
        {
          key: "binder-history",
          label: "History",
          icon: ICON.history,
          route: {
            kind: "binder",
            org: scope.org,
            binder: scope.binder,
            tab: "history",
          },
          isActive: (r) => r.kind === "binder" && scope.section === "history",
        },
        {
          key: "binder-settings",
          label: "Settings",
          icon: ICON.settings,
          route: {
            kind: "binder",
            org: scope.org,
            binder: scope.binder,
            tab: "settings",
          },
          // Never marked itself: open, the page under it is the one marked,
          // as GitLab marks Settings › Merge requests and not Settings.
          isActive: () => false,
          expanded: settingsPage !== null,
        },
        // **Its pages, in the sidebar, while one of them is open.** They
        // were tabs on the page, a second navigation under the first.
        ...(settingsPage !== null
          ? BINDER_SETTINGS_PAGES.map((page): Entry => ({
              key: `binder-settings-${page.section}`,
              label: page.label,
              icon: ICON.settings,
              sub: true,
              route: {
                kind: "binder",
                org: scope.org,
                binder: scope.binder,
                tab: page.tab,
              },
              isActive: () => settingsPage === page.section,
            }))
          : []),
      ]
    : [];

  /**
   * The organization on screen, when the page is one of its own: its binders,
   * its people, its billing or its settings.
   */
  const orgScope: string | null =
    route.kind === "organization"
      ? route.org
      : route.kind === "billing" && route.org
        ? route.org
        : null;

  /** The organization's own pages, which were also tabs on its page. */
  const organization: Entry[] = [
    {
      key: "binders",
      label: "Binders",
      icon: ICON.binder,
      route: orgRoute(),
      isActive: (r) => organizationTab(r) === "binders",
    },
    {
      // Every change request in its binders — the binder's own list, one
      // level up, the way a GitLab group lists its projects' merge requests.
      key: "org-changes",
      label: "Change requests",
      icon: ICON.changeRequest,
      route: orgRoute("changes"),
      isActive: (r) => organizationTab(r) === "changes",
      count: orgOpenChanges,
    },
    {
      key: "org-drafts",
      label: "Drafts",
      icon: ICON.draft,
      route: orgRoute("drafts"),
      isActive: (r) => organizationTab(r) === "drafts",
    },
    {
      key: "people",
      label: "People & access",
      icon: ICON.people,
      route: orgRoute("people"),
      isActive: (r) => organizationTab(r) === "people",
    },
    {
      key: "billing",
      label: "Billing",
      icon: ICON.billing,
      // This organization's billing, not the reader's oldest: billing is per
      // organization, and the entry sits under this one's name.
      route: org === null ? null : { kind: "billing", org },
      isActive: (r) => r.kind === "billing",
    },
    {
      key: "settings",
      label: "Settings",
      icon: ICON.settings,
      route: orgRoute("settings"),
      isActive: (r) => organizationTab(r) === "settings",
    },
  ];

  /**
   * **The organizations you are in, as places to go.** Your work spans all of
   * them, so from here an organization is somewhere you go into rather than a
   * heading over its pages. With none, the one thing to do is make one.
   */
  const yourOrganizations: Entry[] =
    organizations.length > 0
      ? organizations.map((organization): Entry => ({
          key: `org-${organization.name}`,
          label: organization.displayName || organization.name,
          icon: ICON.organization,
          route: { kind: "organization", org: organization.name },
          isActive: () => false,
        }))
      : [
          {
            key: "new-organization",
            label: "New organization",
            icon: ICON.add,
            route: { kind: "createOrganization" },
            isActive: (r) => r.kind === "createOrganization",
          },
        ];

  const renderEntry = (entry: Entry) => {
    const Icon = entry.icon;
    const active = entry.isActive(route);
    const disabled = entry.route === null;

    // **A link, not a button**, so it can be opened in a new tab, middle-
    // clicked, and shows its address on hover — everything a reader expects
    // of a place they can go. A plain click still navigates in-app. An entry
    // with nowhere to go yet has no `href`, which is how a link says so.
    return (
      <a
        key={entry.key}
        href={entry.route ? routeToPath(entry.route) : undefined}
        aria-disabled={disabled || undefined}
        className={`app-sidebar-item${entry.sub ? " app-sidebar-item--sub" : ""}${
          active ? " app-sidebar-item--active" : ""
        }${disabled ? " app-sidebar-item--muted" : ""}`}
        aria-current={active ? "page" : undefined}
        // Collapsed, the icon is the whole of the row, so the name has to be
        // reachable some other way. The label stays in the DOM and is hidden
        // in CSS rather than removed — a screen reader still reads the same
        // navigation whichever width it is at — and the title puts it back for
        // a pointer.
        title={collapsed ? entry.label : undefined}
        onClick={(event) => {
          const to = entry.route;
          if (to) followInApp(event, () => onNavigate(to));
        }}
      >
        {entry.sub ? null : <AppIcon icon={Icon} size="md" />}
        <span className="app-sidebar-item-label">{entry.label}</span>
        {typeof entry.count === "number" && entry.count > 0 ? (
          <span className="app-sidebar-item-count">{entry.count}</span>
        ) : null}
        {entry.expanded === undefined ? null : (
          <span className="app-sidebar-item-chevron" aria-hidden="true">
            {entry.expanded ? (
              <AppIcon icon={ICON.chevronDown} size="sm" />
            ) : (
              <AppIcon icon={ICON.chevronRight} size="sm" />
            )}
          </span>
        )}
      </a>
    );
  };

  return (
    <aside
      className={`app-sidebar${collapsed ? " app-sidebar--collapsed" : ""}`}
    >
      {scope ? (
        <nav
          className="app-sidebar-section app-sidebar-section--scoped"
          aria-label={scope.name}
        >
          {/* **One step back up**, to the organization the binder is in.
              GitLab leaves it to the breadcrumbs, which a person who has
              never used GitLab does not read as a way out. */}
          <a
            className="app-sidebar-back"
            href={routeToPath({ kind: "organization", org: scope.org })}
            title={collapsed ? orgName || scope.org : undefined}
            onClick={(event) =>
              followInApp(event, () =>
                onNavigate({ kind: "organization", org: scope.org }),
              )
            }
          >
            <AppIcon icon={ICON.back} size="sm" />
            <span className="app-sidebar-back-label">
              {orgName || scope.org}
            </span>
          </a>

          {/* **Titled for the level, as Your work is**, so each of the three
              says what kind of place it is before it says which one. */}
          <div className="app-sidebar-label">Binder</div>

          {/* The binder's name, as the heading of everything under it. A
              heading and not a link: Documents is the way to its contents. */}
          <div className="app-sidebar-binder">
            <span className="app-sidebar-binder-mark" aria-hidden="true">
              <AppIcon icon={ICON.binder} size="sm" />
            </span>
            <span className="app-sidebar-binder-name">{scope.name}</span>
          </div>

          {binderEntries.map(renderEntry)}
        </nav>
      ) : orgScope ? (
        <nav
          className="app-sidebar-section app-sidebar-section--scoped"
          aria-label={orgName || orgScope}
        >
          <a
            className="app-sidebar-back"
            href={routeToPath({ kind: "workspace" })}
            title={collapsed ? "Home" : undefined}
            onClick={(event) =>
              followInApp(event, () => onNavigate({ kind: "workspace" }))
            }
          >
            <AppIcon icon={ICON.back} size="sm" />
            <span className="app-sidebar-back-label">Home</span>
          </a>

          <div className="app-sidebar-label">Organization</div>

          <div className="app-sidebar-scope">
            <span className="app-sidebar-scope-mark" aria-hidden="true">
              <AppIcon icon={ICON.organization} size="sm" />
            </span>
            <span className="app-sidebar-scope-name">
              {orgName || orgScope}
            </span>
          </div>

          {organization.map(renderEntry)}
        </nav>
      ) : (
        <>
          <nav className="app-sidebar-section" aria-label="Your work">
            <div className="app-sidebar-label">Your work</div>
            {work.map(renderEntry)}
          </nav>

          <nav className="app-sidebar-section" aria-label="Your organizations">
            <div className="app-sidebar-label">Organizations</div>
            {yourOrganizations.map(renderEntry)}
          </nav>
        </>
      )}

      <div className="app-sidebar-spacer" />

      <div className="app-sidebar-foot">
        {/* **Help and feedback, where the eye ends up when it is looking for
            a way out.** This was the signed-in person's name, which the
            avatar at the top right already says. Neither is a destination,
            so neither is among them: help opens beside the app, and feedback
            opens a dialog over wherever you are. */}
        <div className="app-sidebar-foot-actions">
          {/* Ordinary pages anybody can read, signed in or not (apps/help),
              in a new tab, so reading about a step keeps the place where you
              were doing it. */}
          <a
            className="app-sidebar-foot-item"
            href={helpHref(helpGuide ?? undefined)}
            target="_blank"
            rel="noopener"
            aria-label={`${helpLabel} (opens in a new tab)`}
            title={collapsed || helpGuide ? helpLabel : undefined}
          >
            <span className="app-sidebar-foot-icon" aria-hidden="true">
              <AppIcon icon={ICON.help} size="md" />
            </span>
            <span className="app-sidebar-foot-label">Help and guides</span>
          </a>
          {onSendFeedback ? (
            <button
              type="button"
              className="app-sidebar-foot-item"
              title={collapsed ? "Send feedback" : undefined}
              onClick={onSendFeedback}
            >
              <span className="app-sidebar-foot-icon" aria-hidden="true">
                <AppIcon icon={ICON.feedback} size="md" />
              </span>
              <span className="app-sidebar-foot-label">Send feedback</span>
            </button>
          ) : null}
        </div>
        {/* **In the foot, at the far end**, which is where a control that acts
            on the panel itself belongs — not among the destinations, which are
            about where you are going rather than about the furniture. The
            glyph is the state it will produce, the way every panel toggle
            behaves. */}
        <button
          type="button"
          className="app-sidebar-collapse"
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? "Expand the navigation" : "Collapse the navigation"
          }
          title={collapsed ? "Expand" : "Collapse"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <AppIcon icon={ICON.showPanel} size="md" />
          ) : (
            <AppIcon icon={ICON.hidePanel} size="md" />
          )}
        </button>
      </div>
    </aside>
  );
}
