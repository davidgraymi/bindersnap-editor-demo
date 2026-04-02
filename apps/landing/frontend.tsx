/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Missing #root element for editor mount.");
}

const win = window as typeof window & {
  __bindersnapRoot?: ReturnType<typeof createRoot>;
};
const root = win.__bindersnapRoot ?? createRoot(elem);
win.__bindersnapRoot = root;

const render = async () => {
  const { App } = await import("./App");
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
};

if (import.meta.hot) {
  render();
  import.meta.hot.accept("./App", render);
} else {
  render();
}
