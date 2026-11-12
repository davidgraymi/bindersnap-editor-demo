import { HelpLink } from "./HelpLink";
import type { ReactNode } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { describeGroupName } from "../../../packages/utils/groupName";
import type { AppRoute } from "../routes";
import type { PanelOrigin, PanelRow, SignOffPanelView } from "../signOffPanel";
import { GroupLink } from "./GroupLink";
import { PersonAvatar } from "./PersonAvatar";

/** How many faces a row shows before it says "+N". */
const FACES = 4;

/**
 * "Who signs off here": the rail panel on the binder, folder and document
 * pages, and the editor's right-hand panel. See `signOffPanel.ts` for what
 * goes in it.
 *
 * **A row is not a link.** The group's name is one link (to its page) and
 * the origin is another (to where the rule is set); links cannot nest, so the
 * row itself stays plain.
 */
export function SignOffPanel({
  org,
  view,
  onNavigate,
  onOpenOrigin,
  originHref,
  editing,
  headingId = "sign-off-panel",
  framed = true,
}: {
  org: string;
  view: SignOffPanelView;
  onNavigate: (route: AppRoute) => void;
  /** Go to where a rule from above is set. */
  onOpenOrigin: (origin: PanelOrigin) => void;
  /** The address of an origin, so the link is a real one. */
  originHref: (origin: PanelOrigin) => string;
  /** In the editor: Set here rows can be removed, and a control adds one. */
  editing?: {
    onRemove: (row: PanelRow) => void;
    add: ReactNode;
    busy?: boolean;
  };
  headingId?: string;
  /** False in the editor's panel, which draws its own head. */
  framed?: boolean;
}) {
  const body = (
    <>
      <p className="signoff-lead">{view.lead}</p>

      <h3 className="signoff-section">Set here</h3>
      {view.here.length === 0 ? (
        <p className="doc-rail-empty">{view.hereEmpty}</p>
      ) : (
        <ul className="bs-row-list">
          {view.here.map((row) => (
            <li key={row.key}>
              <SignOffRow
                org={org}
                row={row}
                onNavigate={onNavigate}
                onOpenOrigin={onOpenOrigin}
                originHref={originHref}
                {...(editing && row.rule
                  ? {
                      onRemove: () => editing.onRemove(row),
                      busy: editing.busy ?? false,
                    }
                  : {})}
              />
            </li>
          ))}
        </ul>
      )}
      {editing ? <div className="signoff-add">{editing.add}</div> : null}

      {view.above.length > 0 ? (
        <>
          <h3 className="signoff-section">
            From above
            {editing ? (
              <span className="signoff-section-note">Read only here</span>
            ) : null}
          </h3>
          <ul className="bs-row-list">
            {view.above.map((row) => (
              <li key={row.key}>
                <SignOffRow
                  org={org}
                  row={row}
                  onNavigate={onNavigate}
                  onOpenOrigin={onOpenOrigin}
                  originHref={originHref}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {view.foot ? <p className="signoff-foot">{view.foot}</p> : null}
      <p className="signoff-help">
        <HelpLink
          guide="approvals"
          section="Who signs off on a folder or a document"
        >
          How sign-off works
        </HelpLink>
      </p>
    </>
  );

  if (!framed) return <div className="signoff">{body}</div>;

  return (
    <section className="bs-panel signoff" aria-labelledby={headingId}>
      <div className="bs-panel-bar">
        <h2 className="bs-panel-bar-title" id={headingId}>
          Who signs off here
        </h2>
      </div>
      {body}
    </section>
  );
}

function SignOffRow({
  org,
  row,
  onNavigate,
  onOpenOrigin,
  originHref,
  onRemove,
  busy = false,
}: {
  org: string;
  row: PanelRow;
  onNavigate: (route: AppRoute) => void;
  onOpenOrigin: (origin: PanelOrigin) => void;
  originHref: (origin: PanelOrigin) => string;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const context =
    row.kind === "group"
      ? `${describeGroupName(row.group!)} · ${row.detail}`
      : row.detail;
  const faces = row.kind === "person" ? [] : row.people.slice(0, FACES);
  const more = row.kind === "person" ? 0 : row.people.length - faces.length;

  return (
    <div className="bs-row bs-row--tall signoff-row">
      {/* A person's face stands where a group's icon does, so every name
          in the list starts at the same place. */}
      {row.kind === "person" ? (
        <span className="bs-row-icon signoff-row-lead">
          <PersonAvatar person={row.people[0]!} size="sm" card={row.detail} />
        </span>
      ) : (
        <span className="bs-row-icon signoff-row-lead" aria-hidden="true">
          <AppIcon
            icon={
              row.kind === "group" && !row.isRulesRule
                ? ICON.people
                : ICON.rules
            }
            size="sm"
          />
        </span>
      )}
      <span className="bs-row-body">
        <span className="signoff-row-top">
          <span className="bs-row-name bs-row-name--wrap">
            {row.kind === "group" ? (
              <GroupLink org={org} group={row.group!} onNavigate={onNavigate} />
            ) : (
              row.title
            )}
            {!row.hasAccess ? (
              <span className="bs-status bs-status--sm bs-status--changes signoff-noaccess">
                No access to this binder
              </span>
            ) : null}
          </span>
          {faces.length > 0 ? (
            <span className="signoff-faces">
              {faces.map((person) => (
                <PersonAvatar
                  key={person.login}
                  person={person}
                  size="sm"
                  card={context}
                />
              ))}
              {more > 0 ? <span className="signoff-more">+{more}</span> : null}
            </span>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn--quiet signoff-remove"
              aria-label={`Take ${row.title} off who signs off here`}
              title={`Take ${row.title} off`}
              disabled={busy}
              onClick={onRemove}
            >
              <AppIcon icon={ICON.close} size="sm" />
            </button>
          ) : null}
        </span>
        <span className="bs-row-meta">
          {row.detail}
          {row.origin ? (
            <>
              {" · "}
              <a
                className="signoff-origin"
                href={originHref(row.origin.to)}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onOpenOrigin(row.origin!.to);
                }}
              >
                {row.origin.label}
                <AppIcon icon={ICON.chevronRight} size="xs" />
              </a>
            </>
          ) : null}
        </span>
      </span>
    </div>
  );
}
