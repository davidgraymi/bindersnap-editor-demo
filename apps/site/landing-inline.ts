import { retargetAppLinks } from "./appLink";
import {
  bindSignupEnterKeys,
  installScrollReveal,
  restoreTheme,
  routeLandingSignup,
  showLandingContent,
  toggleTheme,
  type SignupSource,
} from "./landing";
import { mountLandingIcons } from "./landing-icons";

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
mountLandingIcons();
retargetAppLinks();
showLandingContent(landingContent);

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
