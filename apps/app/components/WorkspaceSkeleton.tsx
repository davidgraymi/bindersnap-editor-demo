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
        <span className="bs-skeleton-shape bs-skeleton-shape--pill" />
        <span className="app-topnav-spacer" />
        <span className="bs-skeleton-shape bs-skeleton-shape--pill" />
        <SkeletonShape variant="avatar" />
      </header>

      <main className="app-main">
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
    </SkeletonGroup>
  );
}
