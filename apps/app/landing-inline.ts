import {
  bindSignupEnterKeys,
  hideLandingContent,
  installScrollReveal,
  restoreTheme,
  routeLandingSignup,
  shouldShowLanding,
  showLandingContent,
  toggleTheme,
  type SignupSource,
} from "./landing";
import { mountLandingIcons } from "./landing-icons";
import logoMarkSpriteUrl from "../../packages/ui-tokens/img/logo-mark.svg";

declare global {
  interface Window {
    signup?: (source: SignupSource) => void;
    toggleTheme?: () => void;
    __bindersnapLandingDemoPromise?: Promise<void>;
  }
}

const landingContent = document.getElementById("landing-content");

restoreTheme();
for (const logoUse of document.querySelectorAll<SVGUseElement>(
  "[data-bindersnap-logo-mark] use",
)) {
  logoUse.setAttribute("href", `${logoMarkSpriteUrl}#bindersnap-logo-mark`);
}
mountLandingIcons();

if (shouldShowLanding(window.location.pathname)) {
  showLandingContent(landingContent);
} else {
  hideLandingContent(landingContent);
}

installScrollReveal();

window.toggleTheme = () => {
  toggleTheme();
};

window.signup = (source: SignupSource) => {
  routeLandingSignup(document, source);
};

bindSignupEnterKeys(document, (source) => {
  window.signup?.(source);
});

function isLandingVisible(): boolean {
  return Boolean(
    landingContent &&
    landingContent.style.display !== "none" &&
    landingContent.getAttribute("aria-hidden") !== "true",
  );
}

async function loadLandingDemo(): Promise<void> {
  if (!isLandingVisible()) {
    return;
  }

  if (!window.__bindersnapLandingDemoPromise) {
    window.__bindersnapLandingDemoPromise = import("./landing-demo").then(
      ({ mountLandingDemo }) => mountLandingDemo(),
    );
  }

  await window.__bindersnapLandingDemoPromise;
}

const intentHandler = () => {
  void loadLandingDemo();
};

window.addEventListener("pointerdown", intentHandler, { capture: true });
window.addEventListener("keydown", intentHandler, { capture: true });
window.addEventListener("scroll", intentHandler, {
  capture: true,
  passive: true,
});

document.getElementById("editor-load-btn")?.addEventListener("click", () => {
  void loadLandingDemo();
});
