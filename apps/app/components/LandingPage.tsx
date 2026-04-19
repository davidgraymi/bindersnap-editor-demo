import { useEffect } from "react";

import { showLandingContent, hideLandingContent } from "../landing";

export function LandingPage() {
  useEffect(() => {
    const landingContent = document.getElementById("landing-content");
    const appRoot = document.getElementById("root");
    const previousDisplay = appRoot?.style.display ?? "";
    showLandingContent(landingContent);
    if (appRoot) {
      appRoot.style.display = "none";
    }

    return () => {
      hideLandingContent(landingContent);
      if (appRoot) {
        appRoot.style.display = previousDisplay;
      }
    };
  }, []);

  return null;
}
