import { followInApp, navigateToHref } from "../appLink";
import { buildLocationTrail } from "../locationTrail";
import type { AppRoute } from "../routes";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

interface LocationTrailProps {
  route: AppRoute;
  /** The organization the page belongs to, or the one the app settled on. */
  org: string | null;
  onNavigate: (route: AppRoute) => void;
}

/**
 * `Riverside Health / Clinical / Nursing / Hand Hygiene`, in the top bar.
 *
 * What it says is decided in `locationTrail.ts`. This draws it: the
 * organization first, as the switcher it already was, then one step per level
 * down to the page you are on. Every step above the last is a real link.
 *
 * Re-rendered on every navigation because the shell is: the app re-reads its
 * route on `popstate`, which every in-app move dispatches, so reading the
 * query here at render time is reading the address the page is showing.
 */
export function LocationTrail({ route, org, onNavigate }: LocationTrailProps) {
  const { steps, organizationIsCurrent } = buildLocationTrail(
    route,
    window.location.search,
  );

  return (
    <nav className="app-trail" aria-label="Breadcrumb">
      <ol className="app-trail-list">
        {/* Kept as its own box with its old name, because it is wanted at
            every width even where the rest of the trail folds away. */}
        <li className="app-trail-org app-topnav-org">
          <OrganizationSwitcher
            currentOrg={org ?? undefined}
            isCurrentPage={organizationIsCurrent}
            onSelect={(next) => onNavigate({ kind: "organization", org: next })}
          />
        </li>
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li
              key={`${index}-${step.label}`}
              className={`app-trail-step${last ? " app-trail-step--last" : ""}`}
            >
              <span className="app-trail-sep" aria-hidden="true">
                /
              </span>
              {step.href ? (
                <a
                  className="app-trail-link"
                  href={step.href}
                  onClick={(event) =>
                    followInApp(event, () => navigateToHref(step.href!))
                  }
                >
                  {step.label}
                </a>
              ) : (
                <span
                  className={`app-trail-text${last ? " app-trail-text--current" : ""}`}
                  aria-current={last ? "page" : undefined}
                  title={step.label}
                >
                  {step.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
