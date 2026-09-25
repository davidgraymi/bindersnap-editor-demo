import { followInApp, navigateToHref } from "../appLink";
import { buildLocationTrail, type TrailStep } from "../locationTrail";
import type { AppRoute } from "../routes";
import { BinderSwitcher } from "./BinderSwitcher";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

/**
 * One step of a trail: a link when it goes somewhere, the page's own name when
 * it is the last word, plain text otherwise (a folder has no page).
 */
function TrailStepLabel({
  step,
  current,
  prefix,
}: {
  step: TrailStep;
  current: boolean;
  prefix: string;
}) {
  if (step.href) {
    const href = step.href;
    return (
      <a
        className={`${prefix}-link`}
        href={href}
        onClick={(event) => followInApp(event, () => navigateToHref(href))}
      >
        {step.label}
      </a>
    );
  }
  return (
    <span
      className={`${prefix}-text${current ? ` ${prefix}-text--current` : ""}`}
      aria-current={current ? "page" : undefined}
      title={step.label}
    >
      {step.label}
    </span>
  );
}

interface LocationTrailProps {
  route: AppRoute;
  /** The organization the page belongs to, or the one the app settled on. */
  org: string | null;
  /**
   * The address names a binder that is not there. The trail stops at the
   * organization rather than naming a binder the page says does not exist.
   */
  binderMissing?: boolean;
  onNavigate: (route: AppRoute) => void;
}

/**
 * `Riverside Health / Clinical`, in the top bar: the scope, never the page.
 *
 * The organization is the switcher it already was; the binder follows when the
 * page is inside one. Where in the binder is `PagePath`'s job, inside the page.
 *
 * Re-rendered on every navigation because the shell is: the app re-reads its
 * route on `popstate`, which every in-app move dispatches, so reading the
 * query here at render time is reading the address the page is showing.
 */
export function LocationTrail({
  route,
  org,
  binderMissing = false,
  onNavigate,
}: LocationTrailProps) {
  const trail = buildLocationTrail(route, window.location.search);
  const binder = binderMissing ? null : trail.binder;
  const { organizationIsCurrent } = trail;
  const binderRoute =
    route.kind === "binder" || route.kind === "binderDocument" ? route : null;

  return (
    <nav className="app-trail" aria-label="Organization and binder">
      <ol className="app-trail-list">
        {/* Kept as its own box with its old name, because it is wanted at
            every width even where the binder folds away. */}
        <li className="app-trail-org app-topnav-org">
          <OrganizationSwitcher
            currentOrg={org ?? undefined}
            isCurrentPage={organizationIsCurrent}
            onSelect={(next) => onNavigate({ kind: "organization", org: next })}
          />
        </li>
        {binder && binderRoute ? (
          <li className="app-trail-step">
            <span className="app-trail-sep" aria-hidden="true">
              /
            </span>
            {/* Every other binder in the organization, one click away — the
                level people actually move between. */}
            <BinderSwitcher
              org={binderRoute.org}
              binder={binderRoute.binder}
              label={binder.label}
              href={binder.href ?? null}
              onNavigate={onNavigate}
            />
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

/**
 * `Change requests / Change 4 / Compare`, above the page's title.
 *
 * Inside the page, because it is about the page: the top bar holds the scope
 * and the page holds where in it you are — GitLab's file path above the file,
 * not in its header. Drawn only when there is somewhere above the page to go
 * back to: one step would only repeat the title under it.
 */
export function PagePath({ route }: { route: AppRoute }) {
  const { path } = buildLocationTrail(route, window.location.search);
  if (path.length < 2) return null;

  return (
    <nav className="page-path" aria-label="Breadcrumb">
      <ol className="page-path-list">
        {path.map((step, index) => {
          const last = index === path.length - 1;
          return (
            <li key={`${index}-${step.label}`} className="page-path-step">
              {index > 0 ? (
                <span className="page-path-sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              <TrailStepLabel step={step} current={last} prefix="page-path" />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
