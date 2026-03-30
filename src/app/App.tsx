import { useState } from "react";

import { AppShell } from "./components/AppShell";
import { TokenGate } from "./components/TokenGate";
import { clearToken, getStoredToken } from "../services/gitea/auth";

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const GITEA_URL = appEnv?.BUN_PUBLIC_GITEA_URL ?? appEnv?.VITE_GITEA_URL ?? "http://localhost:3000";

export function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());

  if (!token) {
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
