import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "./data/queryClient";

const elem = document.getElementById("root");

if (!elem) {
  throw new Error("Missing #root element for app mount.");
}

const win = window as typeof window & {
  __bindersnapAppRoot?: ReturnType<typeof createRoot>;
};

const root = win.__bindersnapAppRoot ?? createRoot(elem);
win.__bindersnapAppRoot = root;

const appEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

const render = async () => {
  const { App } = await import("./App");
  const isProd = appEnv?.NODE_ENV === "production";

  const app = (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );

  root.render(isProd ? app : <StrictMode>{app}</StrictMode>);
};

if (import.meta.hot) {
  render();
  import.meta.hot.accept("./App", render);
} else {
  render();
}
