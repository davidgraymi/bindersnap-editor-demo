import { ArrowLeft, BookOpen } from "lucide-react";

import { findGuide, HELP_GUIDES } from "../helpGuides";
import { AppIcon } from "./AppIcon";

/**
 * Help, in the product: the guides, one page each.
 *
 * Without a topic it lists them, with the getting-started guide first and a
 * way to bring the guide on Home back for somebody who hid it.
 */
export function HelpPage({
  topic,
  onOpen,
  guideHidden,
  onShowGuide,
}: {
  topic?: string;
  onOpen: (href: string) => void;
  guideHidden: boolean;
  onShowGuide: () => void;
}) {
  const guide = findGuide(topic);

  if (topic && guide) {
    return (
      <article className="docw-page help-page">
        <a
          className="help-back"
          href="/help"
          onClick={(event) => {
            event.preventDefault();
            onOpen("/help");
          }}
        >
          <AppIcon icon={ArrowLeft} size="sm" /> All guides
        </a>
        <h1 className="bs-title">{guide.title}</h1>
        <p className="bs-subtitle">{guide.summary}</p>
        {guide.sections.map((section) => (
          <section className="help-section" key={section.heading}>
            <h2 className="help-heading">{section.heading}</h2>
            {section.steps ? (
              <ol className="help-steps">
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
            {(section.paragraphs ?? []).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    );
  }

  return (
    <div className="docw-page help-page">
      <h1 className="bs-title">Help and guides</h1>
      <p className="bs-subtitle">
        Short answers to the questions everybody asks in their first week.
      </p>
      {guideHidden ? (
        <p className="help-guide-back">
          <button
            type="button"
            className="bs-btn bs-btn--sm bs-btn-secondary"
            onClick={onShowGuide}
          >
            Show the getting-started guide again
          </button>
        </p>
      ) : null}
      <ul className="bs-panel bs-row-list help-list">
        {HELP_GUIDES.map((entry) => (
          <li key={entry.slug}>
            <a
              className="bs-row"
              href={`/help/${entry.slug}`}
              onClick={(event) => {
                event.preventDefault();
                onOpen(`/help/${entry.slug}`);
              }}
            >
              <span className="bs-row-icon" aria-hidden="true">
                <AppIcon icon={BookOpen} size="sm" />
              </span>
              <span className="bs-row-body">
                <span className="bs-row-name">{entry.title}</span>
                <span className="bs-row-meta">{entry.summary}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
