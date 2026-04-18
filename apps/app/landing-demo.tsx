import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

export async function mountLandingDemo(): Promise<void> {
  const elem = document.getElementById("editor-demo-root");
  if (!elem) {
    return;
  }

  const win = window as typeof window & {
    __bindersnapLandingRoot?: ReturnType<typeof createRoot>;
  };
  const root = win.__bindersnapLandingRoot ?? createRoot(elem);
  win.__bindersnapLandingRoot = root;

  const { App } = await import("./landing-demo-app");
  const isProd = process.env.NODE_ENV === "production";

  root.render(
    isProd ? (
      <App />
    ) : (
      <StrictMode>
        <App />
      </StrictMode>
    ),
  );
}
