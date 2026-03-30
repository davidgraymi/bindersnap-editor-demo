import { type FormEvent, useState } from "react";

import { GiteaApiError } from "../../services/gitea/client";
import { storeToken, validateToken } from "../../services/gitea/auth";

interface TokenGateProps {
  baseUrl: string;
  onAuthenticated: (token: string) => void;
}

export function TokenGate({ baseUrl, onAuthenticated }: TokenGateProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextToken = token.trim();
    if (!nextToken) {
      setError("Enter your Gitea personal access token.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await validateToken(baseUrl, nextToken);
      storeToken(nextToken);
      onAuthenticated(nextToken);
    } catch (submitError) {
      if (submitError instanceof GiteaApiError) {
        setError(submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Unable to validate your Gitea token.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="app-gate">
      <div className="app-gate-panel bs-card">
        <div className="bs-eyebrow">Developer Entry</div>
        <h1>Welcome to Bindersnap</h1>
        <p className="app-gate-copy">
          Enter your Gitea token to open the authenticated app shell.
        </p>

        <form className="app-form" onSubmit={onSubmit}>
          <input
            className="bs-input"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Enter your Gitea personal access token"
            autoComplete="off"
            spellCheck={false}
            aria-label="Enter your Gitea personal access token"
          />

          <button className="bs-btn bs-btn-primary app-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Validating..." : "Open Workspace"}
          </button>
        </form>

        {error ? <p className="app-inline-error">{error}</p> : null}

        <p className="app-gate-url">
          Gitea URL: <code>{baseUrl}</code>
        </p>
      </div>
    </section>
  );
}
