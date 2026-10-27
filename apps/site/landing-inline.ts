import { retargetAppLinks } from "./appLink";
import { tagSignupLinks } from "./signupSource";
import {
  bindSignupEnterKeys,
  installScrollReveal,
  restoreTheme,
  routeLandingSignup,
  toggleTheme,
  type SignupSource,
} from "./landing";

declare global {
  interface Window {
    signup?: (source: SignupSource) => void;
    toggleTheme?: () => void;
  }
}

// Stand down the inline no-JS fallback timer in index.html: this module is
// running, so it owns showing the content from here.
document.documentElement.setAttribute("data-landing-ready", "");

restoreTheme();
retargetAppLinks();
tagSignupLinks(window);

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
