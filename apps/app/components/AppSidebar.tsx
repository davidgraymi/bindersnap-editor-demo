import {
  Building2,
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
import type { DocumentRefView } from "../documentRefs";
import { followInApp } from "../appLink";
import { routeToPath, type AppRoute, type OrganizationTab } from "../routes";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { useCollapsedSidebar } from "../useCollapsedSidebar";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

/**
 * The map of the product, always on screen.
 *
 * Before this, the whole of global navigation was "Home · Documents · [org
 * switcher]". Everything else — people, billing, an organization's
 * own page — was reachable only by first entering a binder or by typing a URL,
 * so a new reader had no way to learn what the product contained.
 *
 * The grouping is the teaching, and it is worth more than the links. **Each
 * group is a scope, named, outermost first**: your work across every
 * organization, then this organization's binders, people and billing, then
 * the binder you are in. A reader always knows whose page an entry opens.
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
 * `display: none`); the bottom bar carries the places people move between
 * there. Neither is duplicated at any width.
 */

/**
 * Whether the organization's People tab is the page.
 *
 * The route carries the tab only when the app navigated there itself; an
 * address that was typed, reloaded or opened in a new tab says it in the query.
 */
function isOrganizationPeople(route: AppRoute): boolean {
  if (route.kind !== "organization") return false;
  const tab =
    route.tab ?? new URLSearchParams(window.location.search).get("tab");
  return tab === "people";
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
  // A policy open in the page is three panels wide — the map, the binder's
  // files, and the policy — and the map is the one nobody is reading.
  const { collapsed, toggle } = useCollapsedSidebar(
    route.kind === "binderDocument",
  );

  // The org-scoped entries have nowhere to point until we know which
  // organization is on screen. Rendered muted and inert rather than hidden:
  // a map that changes shape as you walk around it is not a map.
  const orgName = useOrganizationDisplayName(org ?? "");
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

  /**
   * **The organization's own entries, under its name.** They were split
   * across "Manage" and "Settings" headings between the binder and the foot,
   * with nothing saying which organization they belonged to — beside Home and
   * Change requests, which span every organization you are in. Now each scope
   * is a labelled group: yours, this organization's, this binder's.
   */
  const organization: Entry[] = [
    {
      key: "binders",
      label: "Binders",
      icon: Library,
      route: orgRoute(),
      // A binder and a document inside it are both "in" the binders section —
      // you got there through it, and the sidebar should not lose your place.
      isActive: (r) =>
        (r.kind === "organization" && !isOrganizationPeople(r)) ||
        r.kind === "binder" ||
        r.kind === "binderDocument",
    },
    {
      key: "people",
      label: "People & access",
      icon: Users,
      route: orgRoute("people"),
      isActive: isOrganizationPeople,
    },
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

    // **A link, not a button**, so it can be opened in a new tab, middle-
    // clicked, and shows its address on hover — everything a reader expects
    // of a place they can go. A plain click still navigates in-app. An entry
    // with nowhere to go yet has no `href`, which is how a link says so.
    return (
      <a
        key={entry.key}
        href={entry.route ? routeToPath(entry.route) : undefined}
        aria-disabled={disabled || undefined}
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
        onClick={(event) => {
          const to = entry.route;
          if (to) followInApp(event, () => onNavigate(to));
        }}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="app-sidebar-item-label">{entry.label}</span>
        {typeof entry.count === "number" && entry.count > 0 ? (
          <span className="app-sidebar-item-count">{entry.count}</span>
        ) : null}
      </a>
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
        <div className="app-sidebar-label">Your work</div>
        {work.map(renderEntry)}
      </nav>

      {/* The organization's, under its own name — outermost to innermost:
          your work, this organization, the binder you are in. */}
      <nav
        className="app-sidebar-section"
        aria-label={orgName ? orgName : "Organization"}
      >
        <div className="app-sidebar-label app-sidebar-label--scope">
          <Building2 size={12} strokeWidth={2} aria-hidden="true" />
          <span className="app-sidebar-label-text">
            {orgName || "Organization"}
          </span>
        </div>
        {organization.map(renderEntry)}
      </nav>

      {binder ? (
        <nav
          className="app-sidebar-section app-sidebar-section--binder"
          aria-label={binder.name}
        >
          <a
            href={routeToPath({
              kind: "binder",
              org: binder.org,
              binder: binder.binder,
            })}
            className={`app-sidebar-binder${
              binder.section === "documents"
                ? " app-sidebar-binder--active"
                : ""
            }`}
            aria-current={binder.section === "documents" ? "page" : undefined}
            onClick={(event) =>
              followInApp(event, () =>
                onNavigate({
                  kind: "binder",
                  org: binder.org,
                  binder: binder.binder,
                }),
              )
            }
          >
            <span className="app-sidebar-binder-mark" aria-hidden="true">
              <Library size={14} strokeWidth={1.75} />
            </span>
            <span className="app-sidebar-binder-name">{binder.name}</span>
          </a>

          {binderEntries.map(renderEntry)}
        </nav>
      ) : null}

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
