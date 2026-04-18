import { useEffect } from "react";

import { showLandingContent, hideLandingContent } from "../landing";

export function LandingPage() {
  useEffect(() => {
    const landingContent = document.getElementById("landing-content");
    showLandingContent(landingContent);

    return () => {
      hideLandingContent(landingContent);
    };
  }, []);

  return null;
}
