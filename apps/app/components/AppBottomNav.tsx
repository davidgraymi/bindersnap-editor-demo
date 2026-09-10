import { FilePen, FileText, Home, Library } from "lucide-react";

import type { AppRoute } from "../routes";

/**
 * Navigation on a phone, where the sidebar is not rendered.
 *
 * The sidebar is `display: none` below 768px, so until this existed a small
 * screen navigated from links squeezed into the top bar — which had
 * `overflow: hidden` and three links to fit, so search, notifications and the
 * account control were pushed off the right edge and simply could not be
 * reached. A person on a phone could not search.
 *
 * A bottom bar rather than more of the top bar, and not only because it is the
 * platform convention: it is the half of the screen a thumb reaches, and it
 * gives the top bar back to search and the account. The review that asked for
 * this said the two navigations want different architectures, which is exactly
 * what makes cramming the sidebar's nine entries in here the wrong move — this
 * carries the four destinations somebody navigates *between*, and everything
 * under Manage and Settings stays one level in, on the pages that own it.
 *
 * **Binders needs an organization**, and a page that names none has to be told
 * which. It is dropped rather than disabled when there is no answer yet: a
 * dead tab in a bar of four is worse than a bar of three.
 */

interface AppBottomNavProps {
  route: AppRoute;
  /** The organization Binders points at, or null before one is known. */
  org: string | null;
  onNavigate: (route: AppRoute) => void;
}

export function AppBottomNav({ route, org, onNavigate }: AppBottomNavProps) {
  const entries: Array<{
    key: string;
    label: string;
    icon: typeof Home;
    to: AppRoute;
    isActive: boolean;
  }> = [
    {
      key: "home",
      label: "Home",
      icon: Home,
      to: { kind: "workspace" },
      isActive: route.kind === "workspace" || route.kind === "home",
    },
    {
      key: "changes",
      label: "Changes",
      icon: FilePen,
      to: { kind: "changes" },
      isActive: route.kind === "changes",
    },
    {
      key: "documents",
      label: "Policies",
      icon: FileText,
      to: { kind: "documents" },
      isActive: route.kind === "documents",
    },
  ];

  if (org) {
    entries.push({
      key: "binders",
      label: "Binders",
      icon: Library,
      to: { kind: "organization", org },
      // A binder, and a document inside one, are both reached through here.
      isActive:
        route.kind === "organization" ||
        route.kind === "binder" ||
        route.kind === "binderDocument",
    });
  }

  return (
    <nav className="app-bottom-nav" aria-label="Sections">
      {entries.map((entry) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.key}
            type="button"
            className={`app-bottom-nav-item${
              entry.isActive ? " app-bottom-nav-item--active" : ""
            }`}
            aria-current={entry.isActive ? "page" : undefined}
            onClick={() => onNavigate(entry.to)}
          >
            <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
            <span className="app-bottom-nav-label">{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
