import type { ReactNode } from "react";

/**
 * One of a settings page's questions, with a sentence saying which.
 *
 * **GitLab's settings page, without the accordion.** What it gets right is the
 * hierarchy: a few named groups, each saying in one line what it holds, with
 * the individual settings as subsections under it. Six headings of equal
 * weight made "Groups" and "How changes are approved" look like the same kind
 * of thing, and nothing said that the visibility choice, the people and the
 * groups are three halves of one answer. What it gets wrong for a page this
 * short is folding: six blocks read in one scroll, and a closed section is a
 * setting nobody checks.
 */
export function SettingsGroup({
  id,
  title,
  count,
  note,
  children,
}: {
  id: string;
  title: string;
  /** How many of the thing the group lists, for a group that is a list. */
  count?: number;
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bs-section bs-settings-group" aria-labelledby={id}>
      <header className="bs-settings-group-head">
        <h2 className="bs-settings-group-title" id={id}>
          {title}
          {count === undefined ? null : (
            <span className="bs-section-count">{count}</span>
          )}
        </h2>
        <p className="bs-settings-group-note">{note}</p>
      </header>
      <div className="bs-settings-group-body">{children}</div>
    </section>
  );
}
