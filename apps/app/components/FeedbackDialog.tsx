import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  FEEDBACK_LIMITS,
  type FeedbackKind,
} from "../../../packages/utils/feedbackReport";
import {
  mountTurnstile,
  sendFeedback,
  type TurnstileHandle,
} from "../feedback";
import { captureFeedbackTrace, type FeedbackContext } from "../feedbackTrace";

/**
 * **Send feedback**: a few words from the person, and what the app knew when
 * they opened this. It goes to the feedback Worker and becomes an issue in a
 * private repository (ADR 0006).
 *
 * The trace is taken once, as the dialog opens — what was on screen when
 * something went wrong, not what typing the report then did — and shown in
 * full under "What we'll send" before anything leaves. Nothing in it is a
 * document's text, and the note asks people to keep patient details out of
 * what they write, because the dialog cannot.
 */

interface FeedbackDialogProps {
  context: Omit<FeedbackContext, "queryClient">;
  onClose: () => void;
}

const KINDS: { kind: FeedbackKind; label: string }[] = [
  { kind: "bug", label: "Something’s broken" },
  { kind: "idea", label: "An idea" },
  { kind: "other", label: "Something else" },
];

const COPY: Record<
  FeedbackKind,
  { title: string; description: string; placeholder: string }
> = {
  bug: {
    title: "Publishing does nothing",
    description: "What happened?",
    placeholder: "What you did, what you expected, and what happened instead.",
  },
  idea: {
    title: "Let me sort documents by owner",
    description: "Tell us more",
    placeholder: "What would it help you do?",
  },
  other: {
    title: "A question about approvals",
    description: "Tell us more",
    placeholder: "Whatever's on your mind.",
  },
};

export function FeedbackDialog({ context, onClose }: FeedbackDialogProps) {
  const queryClient = useQueryClient();
  const [trace] = useState(() =>
    captureFeedbackTrace({ ...context, queryClient }),
  );
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    const box = turnstileBox.current;
    if (!box) return;
    mountTurnstile(box, (next) => {
      if (!cancelled) setToken(next);
    })
      .then((handle) => {
        if (cancelled) handle.remove();
        else turnstile.current = handle;
      })
      .catch(() => {
        if (!cancelled) setCheckFailed(true);
      });
    return () => {
      cancelled = true;
      turnstile.current?.remove();
      turnstile.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const ready =
    title.trim() !== "" && description.trim() !== "" && token !== null;

  const handleSend = async () => {
    if (!ready || !token) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback({
        kind,
        title: title.trim(),
        description: description.trim(),
        trace,
        turnstileToken: token,
      });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't send that. Try again.",
      );
      // A token works once, sent or not.
      turnstile.current?.reset();
    } finally {
      setSending(false);
    }
  };

  const copy = COPY[kind];
  const failed = trace.apiCalls.filter(
    (call) => call.status === 0 || call.status >= 400,
  ).length;

  return (
    <div
      className="upload-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <div
        className="upload-modal feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onClick={(event) => event.stopPropagation()}
      >
        {sent ? (
          <>
            <h2 id="feedback-title">Thanks — it’s with us.</h2>
            <p className="feedback-dialog-lede">
              We read every report, and what the app knew when you opened this
              went with it, so you don’t have to explain where you were.
            </p>
            <div className="upload-modal-actions">
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                onClick={onClose}
                autoFocus
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="feedback-title">Send feedback</h2>

            <div className="create-document-form">
              <div
                className="bs-segmented feedback-dialog-kinds"
                role="group"
                aria-label="What kind of feedback"
              >
                {KINDS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    className="bs-seg"
                    aria-pressed={kind === option.kind}
                    onClick={() => setKind(option.kind)}
                    disabled={sending}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <label
                htmlFor="feedback-summary"
                className="create-document-field"
              >
                <span className="bs-field-label">In a few words</span>
                <input
                  id="feedback-summary"
                  className="bs-input"
                  type="text"
                  value={title}
                  maxLength={FEEDBACK_LIMITS.title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={copy.title}
                  disabled={sending}
                  autoFocus
                />
              </label>

              <label
                htmlFor="feedback-description"
                className="create-document-field"
              >
                <span className="bs-field-label">{copy.description}</span>
                <textarea
                  id="feedback-description"
                  className="bs-input"
                  rows={5}
                  value={description}
                  maxLength={FEEDBACK_LIMITS.description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={copy.placeholder}
                  disabled={sending}
                />
              </label>

              <p className="add-policy-note">
                Please leave out patient names and other health information.
                Reports go to the Bindersnap team and nobody else.
              </p>

              <details className="feedback-dialog-trace">
                <summary>What we’ll send with it</summary>
                <ul>
                  <li>
                    You:{" "}
                    {trace.user
                      ? `${trace.user.name ?? trace.user.username} (${trace.user.username})`
                      : "not signed in"}
                    {trace.organization
                      ? `, in ${trace.organization.displayName ?? trace.organization.name}`
                      : ""}
                  </li>
                  <li>
                    This page: <code>{trace.url}</code>
                  </li>
                  <li>
                    The app’s version and your browser: {trace.app.version},{" "}
                    {trace.environment.viewport}
                  </li>
                  <li>
                    Your last {trace.apiCalls.length} requests to Bindersnap
                    {failed > 0 ? ` (${failed} failed)` : ""} and{" "}
                    {trace.errors.length} errors the app noticed, with no
                    document text in any of them
                  </li>
                </ul>
                <pre className="feedback-dialog-json">
                  {JSON.stringify(trace, null, 2)}
                </pre>
              </details>

              {/* Turnstile draws itself here only when it needs a click. */}
              <div ref={turnstileBox} className="feedback-dialog-check" />
              {checkFailed ? (
                <p className="upload-error-message" role="alert">
                  We couldn’t load the check that keeps out spam. Reload the
                  page and try again.
                </p>
              ) : null}

              {error ? (
                <p className="upload-error-message" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="upload-modal-actions">
                <button
                  type="button"
                  className="bs-btn bs-btn-primary"
                  onClick={() => void handleSend()}
                  disabled={!ready || sending}
                >
                  {sending
                    ? "Sending…"
                    : token === null && !checkFailed
                      ? "Checking your browser…"
                      : "Send"}
                </button>
                <button
                  type="button"
                  className="bs-btn bs-btn-secondary"
                  onClick={onClose}
                  disabled={sending}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
