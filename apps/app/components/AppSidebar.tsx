import {
  Activity,
  CreditCard,
  FileText,
  FilePen,
  History,
  Home,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
} from "lucide-react";

import type { BinderTab } from "../binderShell";
import type { AppRoute, OrganizationTab } from "../routes";
import { useCollapsedSidebar } from "../useCollapsedSidebar";

/**
 * The map of the product, always on screen.
 *
 * Before this, the whole of global navigation was "Home · Documents · [org
 * switcher]". Everything else — people, activity, billing, an organization's
 * own page — was reachable only by first entering a binder or by typing a URL,
 * so a new reader had no way to learn what the product contained.
 *
 * The grouping is the teaching, and it is worth more than the links. The work
 * you do, then the things you manage, then the settings you rarely touch. A
 * flat list of eight would answer "where is billing" no better than the top bar
 * did.
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
 * **There is no "Policies" entry, because the binder's own name is it.** A
 * binder is its contents: pressing Clinical opens what is filed in Clinical,
 * the way pressing a folder opens the folder.
 *
 * **Below 768px this is not rendered at all** (`.app-sidebar` is
 * `display: none`), so the top bar keeps its links for small screens and they
 * are hidden where the sidebar takes over. Neither is duplicated at any width.
 * Mobile navigation is still thin — that is a known gap in the review, not
 * something this fixes.
 */

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
  /** Filed order, as the binder's own list gives it. */
  documents: ReadonlyArray<{ slugPath: string; name: string; folder: string }>;
  /** The one being read, so its row is marked. */
  active: string | null;
  /**
   * The ref these contents were read at, so a row leads somewhere that exists.
   *
   * Clicking through a change's tree stays on that change: the addresses are
   * the branch's, and following one back to `main` would be following a policy
   * to a name it does not have there.
   */
  change?: number | null;
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
  currentUsername: string;
  currentUserFullName?: string;
  /** How many changes are in flight, once the queue has counted them. */
  changeCount?: number | null;
  onNavigate: (route: AppRoute) => void;
}

type Entry = {
  key: string;
  label: string;
  icon: typeof Home;
  route: AppRoute | null;
  isActive: (route: AppRoute) => boolean;
  count?: number | null;
};

export function AppSidebar({
  route,
  org,
  binder = null,
  currentUsername,
  currentUserFullName = "",
  changeCount = null,
  onNavigate,
}: AppSidebarProps) {
  const { collapsed, toggle } = useCollapsedSidebar();

  // The org-scoped entries have nowhere to point until we know which
  // organization is on screen. Rendered muted and inert rather than hidden:
  // a map that changes shape as you walk around it is not a map.
  const orgRoute = (tab?: OrganizationTab): AppRoute | null =>
    org === null
      ? null
      : { kind: "organization", org, ...(tab ? { tab } : {}) };

  const work: Entry[] = [
    {
      key: "home",
      label: "Home",
      icon: Home,
      route: { kind: "workspace" },
      isActive: (r) => r.kind === "workspace" || r.kind === "home",
    },
    {
      key: "changes",
      label: "Change requests",
      icon: FilePen,
      route: { kind: "changes" },
      isActive: (r) => r.kind === "changes",
      count: changeCount,
    },
    {
      key: "documents",
      label: "Documents",
      icon: FileText,
      route: { kind: "documents" },
      isActive: (r) => r.kind === "documents",
    },
    {
      key: "binders",
      label: "Binders",
      icon: Library,
      route: orgRoute(),
      // A binder and a document inside it are both "in" the binders section —
      // you got there through it, and the sidebar should not lose your place.
      isActive: (r) =>
        r.kind === "organization" ||
        r.kind === "binder" ||
        r.kind === "binderDocument",
    },
  ];

  /**
   * The binder's own screens. Three, not six: People and Sign-off rules are
   * sections of Settings (D5), and its contents are the binder's own entry
   * above them rather than a child repeating its parent's name.
   */
  const binderEntries: Entry[] = binder
    ? [
        {
          key: "binder-changes",
          label: "Changes",
          icon: FilePen,
          route: {
            kind: "binder",
            org: binder.org,
            binder: binder.binder,
            tab: "changes",
          },
          isActive: () => binder.section === "changes",
          count: binder.openChangeCount ?? null,
        },
        {
          key: "binder-history",
          label: "History",
          icon: History,
          route: {
            kind: "binder",
            org: binder.org,
            binder: binder.binder,
            tab: "history",
          },
          isActive: () => binder.section === "history",
        },
        {
          key: "binder-settings",
          label: "Settings",
          icon: Settings,
          route: {
            kind: "binder",
            org: binder.org,
            binder: binder.binder,
            tab: "settings",
          },
          // People and Sign-off rules are sections of this page, and their
          // addresses still resolve — so they mark it too.
          isActive: () =>
            binder.section === "settings" ||
            binder.section === "people" ||
            binder.section === "sign-off",
        },
      ]
    : [];

  const manage: Entry[] = [
    {
      key: "people",
      label: "People & access",
      icon: Users,
      route: orgRoute("people"),
      isActive: () => false,
    },
    {
      key: "activity",
      label: "Activity",
      icon: Activity,
      route: { kind: "activity" },
      isActive: (r) => r.kind === "activity",
    },
  ];

  /**
   * **One destination per entry.**
   *
   * "Organization" pointed at the organization's page — which is the binder
   * list, which "Binders" above it already opens, which the org button in the
   * top bar also opens. Three entries, one destination, and a reader learning
   * the product from the map would conclude two of them were broken.
   *
   * It is gone rather than repointed: "Binders" is the organization's home
   * and "People & access" under Manage is the rest of it, so there was nothing
   * left for a third entry to mean. Billing is the only thing under Settings
   * that is genuinely a setting.
   */
  const settings: Entry[] = [
    {
      key: "billing",
      label: "Billing",
      icon: CreditCard,
      route: { kind: "billing" },
      isActive: (r) => r.kind === "billing",
    },
  ];

  const renderEntry = (entry: Entry) => {
    const Icon = entry.icon;
    const active = entry.isActive(route);
    const disabled = entry.route === null;

    return (
      <button
        key={entry.key}
        type="button"
        disabled={disabled}
        className={`app-sidebar-item${active ? " app-sidebar-item--active" : ""}${
          disabled ? " app-sidebar-item--muted" : ""
        }`}
        aria-current={active ? "page" : undefined}
        // Collapsed, the icon is the whole of the row, so the name has to be
        // reachable some other way. The label stays in the DOM and is hidden
        // in CSS rather than removed — a screen reader still reads the same
        // navigation whichever width it is at — and the title puts it back for
        // a pointer.
        title={collapsed ? entry.label : undefined}
        onClick={() => entry.route && onNavigate(entry.route)}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="app-sidebar-item-label">{entry.label}</span>
        {typeof entry.count === "number" && entry.count > 0 ? (
          <span className="app-sidebar-item-count">{entry.count}</span>
        ) : null}
      </button>
    );
  };

  const initials =
    (currentUserFullName || currentUsername)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || currentUsername.slice(0, 2).toUpperCase();

  return (
    <aside
      className={`app-sidebar${collapsed ? " app-sidebar--collapsed" : ""}`}
    >
      <nav className="app-sidebar-section" aria-label="Your work">
        {work.map(renderEntry)}
      </nav>

      {binder ? (
        <nav
          className="app-sidebar-section app-sidebar-section--binder"
          aria-label={binder.name}
        >
          <button
            type="button"
            className={`app-sidebar-binder${
              binder.section === "documents"
                ? " app-sidebar-binder--active"
                : ""
            }`}
            aria-current={binder.section === "documents" ? "page" : undefined}
            onClick={() =>
              onNavigate({
                kind: "binder",
                org: binder.org,
                binder: binder.binder,
              })
            }
          >
            <span className="app-sidebar-binder-mark" aria-hidden="true">
              <Library size={14} strokeWidth={1.75} />
            </span>
            <span className="app-sidebar-binder-name">{binder.name}</span>
          </button>

          {binderEntries.map(renderEntry)}
        </nav>
      ) : null}

      <nav className="app-sidebar-section" aria-label="Manage">
        <div className="app-sidebar-label">Manage</div>
        {manage.map(renderEntry)}
      </nav>

      <nav className="app-sidebar-section" aria-label="Settings">
        <div className="app-sidebar-label">Settings</div>
        {settings.map(renderEntry)}
      </nav>

      <div className="app-sidebar-spacer" />

      <div className="app-sidebar-user">
        <span className="app-sidebar-user-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="app-sidebar-user-label">
          <span className="app-sidebar-user-name">
            {currentUserFullName || currentUsername}
          </span>
        </span>
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
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeftOpen size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}
