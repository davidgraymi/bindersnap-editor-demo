import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { organizationBindersQuery } from "../data/queries";
import { followInApp } from "../appLink";
import { formatDocumentName } from "../documentDisplay";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import type { AppRoute } from "../routes";

interface BinderSwitcherProps {
  org: string;
  /** The binder on screen, by slug. */
  binder: string;
  /** What to call it until the list has loaded. */
  label: string;
  /**
   * Where the name goes: the binder's contents, or null when they are the
   * page. The name stays a link — it opens in a new tab like every step of a
   * trail — and the chevron beside it is the switcher.
   */
  href: string | null;
  onNavigate: (route: AppRoute) => void;
}

/**
 * The binder in the top bar, as a way to every other binder in the
 * organization.
 *
 * The organization beside it was already a switcher, and the binder was plain
 * text — so moving from Clinical to Corporate meant going up to the
 * organization's list and back down. GitLab's breadcrumb does this for a
 * project; here it is the binder, the level people actually move between.
 *
 * The list is read when the menu first opens, not on every page: most visits
 * to a binder never switch.
 */
export function BinderSwitcher({
  org,
  binder,
  label,
  href,
  onNavigate,
}: BinderSwitcherProps) {
  const nameRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  // Asked for when first opened, and kept per organization — another
  // organization's binders are another list, and another key.
  const [asked, setAsked] = useState(false);
  const list = useQuery({
    ...organizationBindersQuery(org),
    enabled: asked,
  });
  const binders: WorkspaceSummary[] | null = list.data ?? null;
  const failed = list.isError;
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const rect = (
      nameRef.current ?? buttonRef.current
    )?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
  }, []);

  useEffect(() => {
    if (open) setAsked(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
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

  // Focus the binder you are in once the list is there, so arrows and Tab
  // start from where you are.
  useEffect(() => {
    if (open && binders) {
      const menu = menuRef.current;
      (
        menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
        menu?.querySelector<HTMLButtonElement>("button")
      )?.focus();
    }
  }, [open, binders]);

  const go = (route: AppRoute) => {
    setOpen(false);
    onNavigate(route);
  };

  const sorted = binders
    ? [...binders].sort((a, b) =>
        formatDocumentName(a.name).localeCompare(formatDocumentName(b.name)),
      )
    : null;

  return (
    <>
      {href ? (
        <a
          ref={nameRef as React.RefObject<HTMLAnchorElement>}
          className="app-trail-link"
          href={href}
          onClick={(event) =>
            followInApp(event, () =>
              onNavigate({ kind: "binder", org, binder }),
            )
          }
        >
          {label}
        </a>
      ) : (
        <span
          ref={nameRef}
          className="app-trail-text app-trail-text--current"
          aria-current="page"
          title={label}
        >
          {label}
        </span>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="app-trail-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch binder — ${label}`}
        title="Switch binder"
        onClick={() => {
          place();
          setOpen((was) => !was);
        }}
      >
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && anchor ? (
        <div
          ref={menuRef}
          className="app-menu binder-switcher"
          role="menu"
          aria-label="Binders in this organization"
          style={{ top: anchor.top, left: anchor.left }}
        >
          {sorted === null ? (
            <p className="binder-switcher-note" role="status">
              {failed ? "Could not read the binders." : "Reading binders…"}
            </p>
          ) : (
            sorted.map((row) => (
              <button
                key={row.name}
                type="button"
                role="menuitemradio"
                aria-checked={row.name === binder}
                className="app-menu-item app-menu-item--check"
                onClick={() => go({ kind: "binder", org, binder: row.name })}
              >
                <span className="app-menu-item-check" aria-hidden="true">
                  {row.name === binder ? (
                    <Check size={14} strokeWidth={2} />
                  ) : null}
                </span>
                {formatDocumentName(row.name)}
              </button>
            ))
          )}
          <div className="binder-switcher-foot">
            <button
              type="button"
              role="menuitem"
              className="app-menu-item"
              onClick={() => go({ kind: "organization", org })}
            >
              All binders
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
