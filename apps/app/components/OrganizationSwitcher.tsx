import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown } from "lucide-react";

import { fetchOrganizations } from "../api";
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
  onSelect: (org: string) => void;
}

export function OrganizationSwitcher({
  currentOrg,
  onSelect,
}: OrganizationSwitcherProps) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  if (organizations.length === 0) return null;

  const label =
    organizations.find((organization) => organization.name === currentOrg)
      ?.displayName ??
    currentOrg ??
    organizations[0]?.displayName ??
    "";

  // One organization is not a choice. Show where you are, without pretending
  // there is somewhere else to go.
  if (organizations.length === 1) {
    return (
      <button
        type="button"
        className="app-topnav-link"
        onClick={() => onSelect(organizations[0]!.name)}
      >
        <Building2 size={14} strokeWidth={1.5} aria-hidden="true" /> {label}
      </button>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="app-topnav-link"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Building2 size={14} strokeWidth={1.5} aria-hidden="true" /> {label}{" "}
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="app-menu" role="menu">
          {organizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              role="menuitem"
              className="app-menu-item"
              onClick={() => {
                setIsOpen(false);
                onSelect(organization.name);
              }}
            >
              {organization.displayName}
              {organization.name === currentOrg ? " ·" : ""}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
