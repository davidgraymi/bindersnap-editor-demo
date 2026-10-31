import { X } from "lucide-react";

import { AppIcon } from "./AppIcon";

/** A row's quiet "remove" cross, labelled for a screen reader. */
export function RemoveButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="bs-rowact bs-rowact--danger"
      disabled={busy}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <AppIcon icon={X} size="sm" />
    </button>
  );
}
