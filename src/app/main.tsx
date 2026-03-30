import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");

if (!elem) {
  throw new Error("Missing #root element for app mount.");
}

const win = window as typeof window & {
  __bindersnapAppRoot?: ReturnType<typeof createRoot>;
};

const root = win.__bindersnapAppRoot ?? createRoot(elem);
win.__bindersnapAppRoot = root;

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

