import { Plus } from "lucide-react";

interface NewDocumentButtonProps {
  onClick: () => void;
}

/**
 * "New document", in the top nav.
 *
 * Every page already carries its own primary action, so the nav's copy of this
 * one stays quiet: a plain plus that sits with the notification bell rather
 * than a coral button competing with the action the page actually wants. The
 * label lives in `aria-label` and `title` — read by a screen reader, shown on
 * hover, and never shouted in coral.
 */
export function NewDocumentButton({ onClick }: NewDocumentButtonProps) {
  return (
    <button
      className="app-topnav-icon-btn app-topnav-new-btn"
      type="button"
      id="topnav-new-doc-btn"
      title="New document"
      aria-label="New document"
      onClick={onClick}
    >
      <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
