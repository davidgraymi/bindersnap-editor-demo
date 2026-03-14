const loadEditor = async () => {
  const w = window as typeof window & { __bindersnapEditorLoaded?: boolean };
  if (w.__bindersnapEditorLoaded) return;
  w.__bindersnapEditorLoaded = true;
  await import("./frontend.tsx");
};

const intentHandler = () => void loadEditor();

window.addEventListener("pointerdown", intentHandler, { capture: true });
window.addEventListener("keydown", intentHandler, { capture: true });
window.addEventListener("scroll", intentHandler, {
  capture: true,
  passive: true,
});

const btn = document.getElementById("editor-load-btn");
btn?.addEventListener("click", intentHandler);
