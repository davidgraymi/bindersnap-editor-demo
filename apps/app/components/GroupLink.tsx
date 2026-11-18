import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { describeGroupName } from "../../../packages/utils/groupName";
import { followInApp } from "../appLink";
import { organizationGroupQuery } from "../data/queries";
import { routeToPath, type AppRoute } from "../routes";
import { PersonAvatar } from "./PersonAvatar";

/** How long a pointer rests on a group's name before its card opens. */
const CARD_DELAY_MS = 300;
/** How many of its people the card names before "and N more". */
const CARD_PEOPLE = 6;

/**
 * A group's name, as a link to the group's page.
 *
 * One component for every group name in the app — the sign-off panel, the
 * approvals table, reviewers' tags, Settings, People — so "what does this
 * group approve?" is one click from anywhere a group is named.
 *
 * With `card`, resting on it (or focusing it) also says who is in the group,
 * the way a person's face opens a card about them: a chip in a rule's diff
 * names a group and nothing else, and "who is that?" should not cost a page.
 * The members are read when the card first opens.
 */
export function GroupLink({
  org,
  group,
  onNavigate,
  className,
  card = false,
  children,
}: {
  org: string;
  /** The group's handle, `infection-control`. */
  group: string;
  onNavigate: (route: AppRoute) => void;
  className?: string;
  card?: boolean;
  /** What the link says; the group's name by default. */
  children?: ReactNode;
}) {
  if (card) {
    return (
      <GroupCardLink
        org={org}
        group={group}
        onNavigate={onNavigate}
        className={className}
      >
        {children}
      </GroupCardLink>
    );
  }
  const to: AppRoute = { kind: "organization", org, tab: "people", group };
  return (
    <a
      className={`group-link${className ? ` ${className}` : ""}`}
      href={routeToPath(to)}
      onClick={(event) => followInApp(event, () => onNavigate(to))}
    >
      {children ?? describeGroupName(group)}
    </a>
  );
}

/** The link with its card: the only form that reads anything. */
function GroupCardLink({
  org,
  group,
  onNavigate,
  className,
  children,
}: {
  org: string;
  group: string;
  onNavigate: (route: AppRoute) => void;
  className?: string;
  children?: ReactNode;
}) {
  const to: AppRoute = { kind: "organization", org, tab: "people", group };
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const read = useQuery({
    ...organizationGroupQuery(org, group),
    enabled: asked,
  });

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    setAsked(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const members = read.data?.members ?? [];
  const shown = members.slice(0, CARD_PEOPLE);
  return (
    <span
      className="group-card-anchor"
      onMouseEnter={() => {
        clear();
        timer.current = setTimeout(() => setOpen(true), CARD_DELAY_MS);
      }}
      onMouseLeave={() => {
        clear();
        setOpen(false);
      }}
    >
      <a
        className={`group-link${className ? ` ${className}` : ""}`}
        href={routeToPath(to)}
        aria-describedby={open ? id : undefined}
        onClick={(event) => followInApp(event, () => onNavigate(to))}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children ?? describeGroupName(group)}
      </a>
      {open ? (
        <span className="person-card group-card" role="tooltip" id={id}>
          <span className="person-card-text">
            <span className="person-card-name">{describeGroupName(group)}</span>
            <span className="person-card-login">
              {read.error
                ? "Unable to read who is in it."
                : !read.data
                  ? "Reading who is in it…"
                  : members.length === 0
                    ? "Nobody is in it."
                    : members.length === 1
                      ? "1 person"
                      : `${members.length} people`}
            </span>
            {shown.length > 0 ? (
              <span className="group-card-people">
                {shown.map((person) => (
                  <span className="group-card-person" key={person.login}>
                    <PersonAvatar person={person} size="xs" />
                    {person.fullName.trim() || person.login}
                  </span>
                ))}
                {members.length > shown.length ? (
                  <span className="person-card-context">
                    and {members.length - shown.length} more
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}
    </span>
  );
}
