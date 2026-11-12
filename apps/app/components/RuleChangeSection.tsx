import { AppIcon, ICON } from "./AppIcon";

import type { AppRoute } from "../routes";
import { routeToPath } from "../routes";
import { followInApp } from "../appLink";
import type { RuleChangeRow } from "../signOffChange";

/** The rule section's anchor, linked from the approvals table (4.9). */
export const RULE_CHANGE_ANCHOR = "who-signs-off";

/**
 * The Changes tab's first section: what this change does to who signs off
 * (4.11). One row per changed rule — where, the owners as chips (unchanged
 * neutral, added green with a plus, removed red and struck through) and what
 * it means once published — then the note that the change is counted under
 * the rules in force today.
 *
 * Colour is never the only signal: added carries a plus and the word, removed
 * a strike and the word, for a reader who cannot see the difference.
 */
export function RuleChangeSection({
  org,
  binder,
  rows,
  rulesOwners,
  startsNext,
  onNavigate,
}: {
  org: string;
  binder: string;
  rows: RuleChangeRow[];
  /** "the Policy Office", who sign off any change to who signs off. */
  rulesOwners: string | null;
  /** "The Quality Committee is not asked: …", or null. */
  startsNext: string | null;
  onNavigate: (route: AppRoute) => void;
}) {
  return (
    <section
      className="bs-panel cmp-rules"
      id={RULE_CHANGE_ANCHOR}
      aria-labelledby="cmp-rules-title"
    >
      <div className="bs-panel-bar">
        <AppIcon icon={ICON.rules} size="md" />
        <h2 className="bs-panel-bar-title" id="cmp-rules-title">
          Who signs off
        </h2>
        <span className="bs-panel-bar-spacer" />
        <span className="binder-count">
          {rows.length === 1 ? "1 rule" : `${rows.length} rules`}
        </span>
      </div>
      <ul className="bs-row-list">
        {rows.map((row) => {
          const route: AppRoute | null =
            row.kind === "folder"
              ? { kind: "binder", org, binder, folder: row.place }
              : row.kind === "document" && row.place
                ? {
                    kind: "binderDocument",
                    org,
                    binder,
                    documentPath: row.place,
                  }
                : row.kind === "binder"
                  ? { kind: "binder", org, binder }
                  : null;
          return (
            <li key={row.key} className="bs-row bs-row--tall cmp-rules-row">
              <span className="bs-row-icon" aria-hidden="true">
                <AppIcon
                  icon={
                    row.kind === "folder"
                      ? ICON.folder
                      : row.kind === "document"
                        ? ICON.document
                        : ICON.rules
                  }
                  size="sm"
                />
              </span>
              <span className="bs-row-body">
                <span className="bs-row-name">
                  {route ? (
                    <a
                      href={routeToPath(route)}
                      onClick={(event) =>
                        followInApp(event, () => onNavigate(route))
                      }
                    >
                      {row.where}
                    </a>
                  ) : (
                    row.where
                  )}
                </span>
                <span className="cmp-rules-owners">
                  {row.owners.map((owner) => (
                    <span
                      key={`${owner.kind}:${owner.name}`}
                      className={`cmp-rules-chip cmp-rules-chip--${owner.change}`}
                    >
                      {owner.change === "added" ? (
                        <AppIcon icon={ICON.add} size="xs" />
                      ) : null}
                      {owner.change === "removed" ? (
                        <del>{owner.label}</del>
                      ) : (
                        owner.label
                      )}
                      {owner.change === "unchanged" ? null : (
                        <span className="sr-only">
                          {owner.change === "added" ? ", added" : ", removed"}
                        </span>
                      )}
                    </span>
                  ))}
                </span>
                <span className="bs-row-meta cmp-rules-effect">
                  {row.effect}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="signoff-foot">
        <strong>Counted under the rules in force today.</strong>{" "}
        {rulesOwners
          ? `${rulesOwners[0]!.toUpperCase()}${rulesOwners.slice(1)} ${
              rulesOwners.includes(" and ") ? "sign" : "signs"
            } off any change to who signs off, so this change needs them whatever else it holds.`
          : "Every rule already in force applies to this change."}
        {startsNext ? ` ${startsNext}` : ""}
      </p>
    </section>
  );
}
