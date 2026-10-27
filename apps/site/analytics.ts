// Every page of bindersnap.com carries the Google tag: the landing page
// (scripts/build.ts writes it in after bundling), the marketing pages, help
// and legal. The app, at app.bindersnap.com, never does; the Privacy Policy
// says so, and changes first if that ever moves.

/** A GA4 measurement ID, as Google issues them. Anything else is ignored. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

/**
 * The section of the site a page belongs to, as GA4's `content_group`: the
 * first segment of its path (`glossary`, `templates`, `help`), `home` for the
 * landing page. Reports can then compare whole sections, not single pages.
 */
export function contentGroup(path: string): string {
  if (path === "/404") return "not-found";
  const first = path.split("/")[1] ?? "";
  return /^[a-z][a-z0-9-]*$/.test(first) ? first : "home";
}

/**
 * The attributes that make a link or button send an event when clicked:
 * `data-track` names the event, and each `data-track-*` becomes one of its
 * parameters. The tag's one click listener reads them, so a page needs no
 * script of its own, and without the tag they do nothing.
 */
export function trackAttributes(
  event: string,
  params: Record<string, string> = {},
): string {
  const attributes = [` data-track="${event}"`];
  for (const [name, value] of Object.entries(params)) {
    attributes.push(
      ` data-track-${name.replace(/_/g, "-")}="${value.replace(/[&"<>]/g, "")}"`,
    );
  }
  return attributes.join("");
}

/**
 * Sends an event from a script of our own (the landing page's sign-up form,
 * the checklist), if the tag is on the page. Without it, nothing happens.
 */
export function trackEvent(
  event: string,
  params: Record<string, string> = {},
): void {
  const gtag = (
    globalThis as { gtag?: (...args: unknown[]) => void } | undefined
  )?.gtag;
  gtag?.("event", event, params);
}

/**
 * The Google tag, configured the way the Privacy Policy promises: no Google
 * signals and no ad personalization, and not loaded at all when the browser
 * sends Global Privacy Control. `id` comes from `BINDERSNAP_GA_MEASUREMENT_ID`
 * at build time; without one there is no tag. `path` is the page's own, for
 * its `content_group`.
 *
 * The events it sends beyond page views come from `data-track` attributes
 * (`trackAttributes`) and `trackEvent`, and name a place on the page, never
 * anything a person typed.
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
export function analyticsTag(id: string | undefined, path = "/"): string {
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
  gtag("config","${id}",{allow_google_signals:false,allow_ad_personalization_signals:false,content_group:"${contentGroup(path)}"});
  document.addEventListener("click",function(e){
    var t=e.target&&e.target.closest?e.target.closest("[data-track]"):null;
    if(!t)return;
    var p={};
    for(var i=0;i<t.attributes.length;i++){var a=t.attributes[i];if(a.name.indexOf("data-track-")===0)p[a.name.slice(11).replace(/-/g,"_")]=a.value;}
    gtag("event",t.getAttribute("data-track"),p);
  });
})();
</script>`;
}

/**
 * The landing page with the tag in its head. Bun bundles `index.html` itself,
 * so the tag is written in afterwards rather than templated like the others.
 */
export function withAnalyticsTag(html: string, id: string | undefined): string {
  const tag = analyticsTag(id, "/");
  if (!tag) return html;
  if (!html.includes("</head>")) throw new Error("The page has no </head>.");
  return html.replace("</head>", `${tag}\n</head>`);
}
