import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";

import { fetchOrganizations } from "../api";
import { followInApp } from "../appLink";
import { formatDocumentName } from "../documentDisplay";
import { defaultOrganization } from "../useOrganizationDisplayName";
import type { OrganizationSummary } from "../../../packages/api-schema/schemas/organizations";

/**
 * Moving between organizations, in one click.
 *
 * A person can belong to more than one — a consultant covering two providers,
 * or somebody who has been added to a customer's organization — and until this
 * existed the app simply picked one for them, silently and by age. That was
 * the same guess the URL removed on the server side; this is the half a person
 * actually touches.
 *
 * It shows nothing at all for somebody in a single organization. A switcher
 * offering one choice is furniture, not a control.
 */

interface OrganizationSwitcherProps {
  /** The organization the current page belongs to, if any. */
  currentOrg?: string;
  /**
   * Whether the organization's own page is the one on screen.
   *
   * It is the first step of the location trail, so it is marked the way the
   * last step of any trail is.
   */
  isCurrentPage?: boolean;
  onSelect: (org: string) => void;
}

export function OrganizationSwitcher({
  currentOrg,
  isCurrentPage = false,
  onSelect,
}: OrganizationSwitcherProps) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // Where the fixed menu hangs. The nav clips its overflow, so the menu cannot
  // be positioned within it — it is placed against the viewport instead, under
  // the button it belongs to.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );

  const placeMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOrganizations()
      .then((rows) => {
        if (!cancelled) setOrganizations(rows);
      })
      // A switcher that cannot load its list is not worth an error on a page
      // about something else; it simply does not appear.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  // A resize moves the button out from under an open menu, so the menu follows.
  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener("resize", placeMenu);
    return () => window.removeEventListener("resize", placeMenu);
  }, [isOpen, placeMenu]);

  // **Named from the address while the list loads.** This is the first step
  // of the trail in the top bar, and a trail that starts with the binder and
  // then grows an organization in front of it a moment later is a trail that
  // jumps. The slug formats to the display name in the ordinary case.
  if (organizations.length === 0) {
    return currentOrg ? (
      <a
        className="app-topnav-link"
        href={`/${currentOrg}`}
        aria-current={isCurrentPage ? "page" : undefined}
        onClick={(event) => followInApp(event, () => onSelect(currentOrg))}
      >
        <Building2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className="app-topnav-link-label">
          {formatDocumentName(currentOrg)}
        </span>
      </a>
    ) : null;
  }

  // Same rule as the sidebar and the server when the page names no
  // organization: the oldest, so all three agree about which one is meant.
  const label =
    organizations.find((organization) => organization.name === currentOrg)
      ?.displayName ??
    currentOrg ??
    defaultOrganization(organizations)?.displayName ??
    "";

  // One organization is not a choice. Show where you are, without pretending
  // there is somewhere else to go.
  if (organizations.length === 1) {
    const only = organizations[0]!.name;
    return (
      <a
        className="app-topnav-link"
        href={`/${only}`}
        aria-current={isCurrentPage ? "page" : undefined}
        onClick={(event) => followInApp(event, () => onSelect(only))}
      >
        <Building2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className="app-topnav-link-label">{label}</span>
      </a>
    );
  }

  return (
    <div
      ref={containerRef}
      className="app-org-switcher"
      style={{ position: "relative" }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="app-topnav-link"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          placeMenu();
          setIsOpen((open) => !open);
        }}
      >
        <Building2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className="app-topnav-link-label">{label}</span>
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>

      {isOpen && anchor ? (
        <div
          className="app-menu"
          role="menu"
          style={{ top: anchor.top, left: anchor.left }}
        >
          {organizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              // Which one you are in is a state of the item, so it is said as
              // one — a check a reader sees and a screen reader announces.
              role="menuitemradio"
              aria-checked={organization.name === currentOrg}
              className="app-menu-item app-menu-item--check"
              onClick={() => {
                setIsOpen(false);
                onSelect(organization.name);
              }}
            >
              <span className="app-menu-item-check" aria-hidden="true">
                {organization.name === currentOrg ? (
                  <Check size={14} strokeWidth={2} />
                ) : null}
              </span>
              {organization.displayName}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
