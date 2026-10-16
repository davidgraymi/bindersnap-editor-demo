import { BookOpen, Building2, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

interface CreateMenuProps {
  /** The organization a new binder would go in, or null outside one. */
  org: string | null;
  onNewBinder: (org: string) => void;
  onNewOrganization: () => void;
}

/**
 * "+", in the top bar: **the things you make from anywhere** — a binder, an
 * organization.
 *
 * It used to open "Add a document" after asking which binder. A document is
 * filed in a binder and belongs on that binder's page, where the binder is
 * already chosen and its rules are on screen; from the top bar it was a
 * detour through a list of every binder you could reach. The things that
 * have no page to be added from — a new binder, a new organization — are what
 * the top bar is for, the way GitLab's "+" offers a project and a group.
 */
export function CreateMenu({
  org,
  onNewBinder,
  onNewOrganization,
}: CreateMenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const orgName = useOrganizationDisplayName(org ?? "");

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <button
        ref={buttonRef}
        className="app-topnav-icon-btn app-topnav-new-btn"
        type="button"
        id="topnav-create-btn"
        title="Create new…"
        aria-label="Create new…"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          place();
          setOpen((was) => !was);
        }}
      >
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && anchor ? (
        <div
          ref={menuRef}
          className="app-menu create-menu"
          role="menu"
          aria-label="Create new"
          style={{ top: anchor.top, right: anchor.right }}
        >
          {org ? (
            <button
              type="button"
              role="menuitem"
              className="app-menu-item create-menu-item"
              onClick={() => choose(() => onNewBinder(org))}
            >
              <BookOpen size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>
                <span className="create-menu-name">New binder</span>
                <span className="create-menu-note">In {orgName}</span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="app-menu-item create-menu-item"
            onClick={() => choose(onNewOrganization)}
          >
            <Building2 size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>
              <span className="create-menu-name">New organization</span>
              <span className="create-menu-note">
                Its own binders, people and billing
              </span>
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
