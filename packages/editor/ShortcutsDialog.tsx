import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { shortcutLabel } from "./ribbon/controls";
import { SHORTCUT_GROUPS } from "./shortcuts";

/**
 * Every shortcut, on one sheet: Ctrl+/ from anywhere in the editor, or
 * Keyboard shortcuts on the View tab.
 *
 * People who write in Word arrive with its keys in their fingers, and the
 * tooltips only tell them one button at a time. Escape, the close button or a
 * press outside puts them back where they were typing.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="bs-shortcuts-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="bs-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bs-shortcuts-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="bs-shortcuts-head">
          <h2 id="bs-shortcuts-title">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="bs-shortcuts-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="bs-shortcuts-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="bs-shortcuts-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.keys} className="bs-shortcuts-row">
                    <dt>{item.does}</dt>
                    <dd>
                      {shortcutLabel(item.keys)
                        .split(/(?<=[⌘⌥⇧])|\+/)
                        .filter(Boolean)
                        .map((key, index) => (
                          <kbd key={index}>{key}</kbd>
                        ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
