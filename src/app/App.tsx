import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { TokenGate } from "./components/TokenGate";
import { clearToken, getStoredToken, storeToken, validateToken } from "../services/gitea/auth";

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const GITEA_URL = appEnv?.BUN_PUBLIC_GITEA_URL ?? appEnv?.VITE_GITEA_URL ?? "http://localhost:3000";
const AUTO_LOGIN_ENABLED = appEnv?.BUN_PUBLIC_DEV_AUTO_LOGIN === "true" || appEnv?.VITE_DEV_AUTO_LOGIN === "true";

let pendingAutoLoginToken: Promise<string> | null = null;

async function requestAutoLoginToken(): Promise<string> {
  if (!pendingAutoLoginToken) {
    pendingAutoLoginToken = (async () => {
      const response = await fetch("/api/dev/gitea-token", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Auto-login token request failed (${response.status}).`);
      }

      const payload = (await response.json()) as { token?: unknown };
      if (typeof payload.token !== "string" || payload.token.trim() === "") {
        throw new Error("Auto-login response did not include a valid token.");
      }

      return payload.token.trim();
    })();
  }

  try {
    return await pendingAutoLoginToken;
  } finally {
    pendingAutoLoginToken = null;
  }
}

export function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [autoLoginState, setAutoLoginState] = useState<"idle" | "loading" | "failed">(
    AUTO_LOGIN_ENABLED && !token ? "loading" : "idle",
  );

  useEffect(() => {
    if (token || !AUTO_LOGIN_ENABLED || autoLoginState !== "loading") {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextToken = await requestAutoLoginToken();
        await validateToken(GITEA_URL, nextToken);
        storeToken(nextToken);
        if (!cancelled) {
          setToken(nextToken);
          setAutoLoginState("idle");
        }
      } catch {
        if (!cancelled) {
          setAutoLoginState("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoLoginState, token]);

  if (!token) {
    if (AUTO_LOGIN_ENABLED && autoLoginState === "loading") {
      return (
        <section className="app-gate">
          <div className="app-gate-panel bs-card">
            <div className="bs-eyebrow">Developer Entry</div>
            <h1>Signing you in...</h1>
            <p className="app-gate-copy">Creating a short-lived Gitea token for local dev auto-login.</p>
          </div>
        </section>
      );
    }

    return (
      <div className="app-root">
        <TokenGate baseUrl={GITEA_URL} onAuthenticated={setToken} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <AppShell
        baseUrl={GITEA_URL}
        token={token}
        onSignOut={() => {
          clearToken();
          window.location.reload();
        }}
      />
    </div>
  );
}
