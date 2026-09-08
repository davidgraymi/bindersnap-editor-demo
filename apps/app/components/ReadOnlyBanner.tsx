import { describeReadOnly } from "../readOnly";
import { useReadOnly } from "../readOnlyContext";

/**
 * The one thing that explains a read-only app.
 *
 * It sits above every page rather than beside the controls it explains,
 * because the controls are *gone* — a customer whose publish button has
 * vanished has nowhere to look for a tooltip. Persistent and not dismissable
 * for the same reason: dismissing it would leave an app that refuses to write
 * and no longer says why.
 *
 * The wording leads with what still works. ADR 0004 is emphatic that reads and
 * exports stay open forever, and a customer who reads "your account is
 * suspended" will assume their approval history is gone — which is the one
 * impression that would poison a compliance reference permanently.
 */
export function ReadOnlyBanner({
  onManageBilling,
}: {
  onManageBilling: () => void;
}) {
  const state = useReadOnly();

  if (!state.readOnly) {
    return null;
  }

  return (
    <div
      className="read-only-banner"
      role="status"
      data-testid="read-only-banner"
    >
      <p className="read-only-banner__message">{describeReadOnly(state)}</p>
      <button
        type="button"
        className="read-only-banner__action"
        onClick={onManageBilling}
      >
        Restore access
      </button>
    </div>
  );
}
