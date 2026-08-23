import { SkeletonGroup, SkeletonLine, SkeletonShape } from "./Skeleton";

/**
 * The workspace, before the session comes back.
 *
 * This is the first thing a returning reader sees, so it is the shape of the
 * app they are about to get — nav, greeting, and the rows of changes — not a
 * box announcing that we are checking something.
 */
export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="app-shell app-shell--skeleton">
      <header className="app-topnav">
        <SkeletonShape variant="pill" />
        <span className="app-topnav-spacer" />
        <span className="app-topnav-right">
          <SkeletonShape variant="pill" />
          <SkeletonShape variant="avatar" />
        </span>
      </header>

      <div className="app-body-wrap">
        <div className="app-main-area">
          <main className="app-main app-main--workspace">
            <div className="home-page">
              <SkeletonLine width="medium" heading />
              <div className="bs-skeleton-stack">
                <SkeletonLine width="short" />
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="bs-skeleton-row" key={index}>
                    <SkeletonShape variant="icon" />
                    <span className="bs-skeleton-lines">
                      <SkeletonLine width="wide" />
                      <SkeletonLine width="short" />
                    </span>
                    <SkeletonShape variant="badge" />
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    </SkeletonGroup>
  );
}
