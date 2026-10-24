// Every page of bindersnap.com carries the Google tag: the landing page
// (scripts/build.ts writes it in after bundling), the marketing pages, help
// and legal. The app, at app.bindersnap.com, never does; the Privacy Policy
// says so, and changes first if that ever moves.

/** A GA4 measurement ID, as Google issues them. Anything else is ignored. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

/**
 * The Google tag, configured the way the Privacy Policy promises: no Google
 * signals and no ad personalization, and not loaded at all when the browser
 * sends Global Privacy Control. `id` comes from `BINDERSNAP_GA_MEASUREMENT_ID`
 * at build time; without one there is no tag.
 *
 * Three settings in the Google Analytics admin keep the rest of the policy
 * true, and nothing here can check them:
 * - Data retention set to 14 months (the policy says so; GA4's default is 2).
 * - Every data-sharing setting off ("Google products & services" first), and
 *   Google's data processing terms accepted, so Google acts as our service
 *   provider and the policy's "we do not share" holds under California law.
 * - Google signals and ad personalization off for the property, as the tag
 *   asks.
 */
export function analyticsTag(id: string | undefined): string {
  if (!id || !MEASUREMENT_ID.test(id)) return "";
  return `<script>
(function(){
  if (navigator.globalPrivacyControl) return;
  var s=document.createElement("script");s.async=true;
  s.src="https://www.googletagmanager.com/gtag/js?id=${id}";
  document.head.appendChild(s);
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){dataLayer.push(arguments);};
  gtag("js",new Date());
  gtag("config","${id}",{allow_google_signals:false,allow_ad_personalization_signals:false});
})();
</script>`;
}

/**
 * The landing page with the tag in its head. Bun bundles `index.html` itself,
 * so the tag is written in afterwards rather than templated like the others.
 */
export function withAnalyticsTag(html: string, id: string | undefined): string {
  const tag = analyticsTag(id);
  if (!tag) return html;
  if (!html.includes("</head>")) throw new Error("The page has no </head>.");
  return html.replace("</head>", `${tag}\n</head>`);
}
