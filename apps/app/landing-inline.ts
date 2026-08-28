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
  }
}

const landingContent = document.getElementById("landing-content");

// Stand down the inline no-JS fallback timer in index.html: this module is
// running, so it owns showing the content from here.
document.documentElement.setAttribute("data-landing-ready", "");

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

document.getElementById("hero-signup-btn")?.addEventListener("click", () => {
  routeLandingSignup(document, "hero");
});
document.getElementById("cta-signup-btn")?.addEventListener("click", () => {
  routeLandingSignup(document, "cta");
});

bindSignupEnterKeys(document, (source) => {
  window.signup?.(source);
});
