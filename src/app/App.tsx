import { useState } from "react";

import { AppShell } from "./components/AppShell";
import { TokenGate } from "./components/TokenGate";
import { clearToken, getStoredToken } from "../services/gitea/auth";

const GITEA_URL = process.env.BUN_PUBLIC_GITEA_URL ?? process.env.VITE_GITEA_URL ?? "http://localhost:3000";

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
