import {
  Activity,
  Building2,
  CreditCard,
  FileText,
  FilePen,
  Home,
  Library,
  Users,
} from "lucide-react";

import type { AppRoute, OrganizationTab } from "../routes";

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
 * **The binder keeps its own tabs.** This does not replace them. A binder is a
 * place — one set of rules, one set of people, which is ADR 0004's whole reason
 * for the level — and the mockups this came from had no binder-scoped screen at
 * all. Adopting that wholesale would have deleted the level the data model is
 * built on. Binders leads to the list; a binder leads to its own tabbed home.
 *
 * **Below 768px this is not rendered at all** (`.app-sidebar` is
 * `display: none`), so the top bar keeps its links for small screens and they
 * are hidden where the sidebar takes over. Neither is duplicated at any width.
 * Mobile navigation is still thin — that is a known gap in the review, not
 * something this fixes.
 */

interface AppSidebarProps {
  route: AppRoute;
  /** The organization the org-scoped entries point at. */
  org: string | null;
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
  currentUsername,
  currentUserFullName = "",
  changeCount = null,
  onNavigate,
}: AppSidebarProps) {
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

  const settings: Entry[] = [
    {
      key: "organization",
      label: "Organization",
      icon: Building2,
      route: orgRoute(),
      isActive: () => false,
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

    return (
      <button
        key={entry.key}
        type="button"
        disabled={disabled}
        className={`app-sidebar-item${active ? " app-sidebar-item--active" : ""}${
          disabled ? " app-sidebar-item--muted" : ""
        }`}
        aria-current={active ? "page" : undefined}
        onClick={() => entry.route && onNavigate(entry.route)}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        {entry.label}
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
    <aside className="app-sidebar">
      <nav className="app-sidebar-section" aria-label="Your work">
        {work.map(renderEntry)}
      </nav>

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
        <span>
          <span className="app-sidebar-user-name">
            {currentUserFullName || currentUsername}
          </span>
        </span>
      </div>
    </aside>
  );
}
