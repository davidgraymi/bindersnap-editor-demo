import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { DocumentDetail } from "./DocumentDetail";
import type { AppRoute } from "../routes";

interface AnonymousDocumentShellProps {
  route: AppRoute & { kind: "document" };
  onNavigate: (route: AppRoute, replace?: boolean) => void;
}

export function AnonymousDocumentShell({
  route,
  onNavigate,
}: AnonymousDocumentShellProps) {
  return (
    <div className="app-shell">
      <header className="app-topnav">
        <div className="app-topnav-logo">
          <button
            type="button"
            className="app-topnav-logo-mark"
            onClick={() => onNavigate({ kind: "home" })}
            aria-label="Go to Bindersnap home"
          >
            <BindersnapLogoMark
              width={14}
              height={14}
              style={{ color: "white" }}
              aria-hidden="true"
            />
          </button>
          <span>Bindersnap</span>
        </div>

        <div className="app-topnav-spacer" />

        <div className="app-topnav-right">
          <button
            type="button"
            className="app-topnav-link"
            onClick={() => onNavigate({ kind: "login" })}
          >
            Sign in
          </button>
          <button
            type="button"
            className="bs-btn bs-btn-primary app-topnav-new-btn"
            onClick={() => onNavigate({ kind: "signup" })}
          >
            Sign up
          </button>
        </div>
      </header>

      <div className="app-body-wrap">
        <div className="app-main-area">
          <main className="app-main app-main--page">
            <DocumentDetail
              owner={route.owner}
              repo={route.repo}
              uploaderSlug={null}
              // Signed-out readers get the record, not the controls: team and
              // settings fall back to the document itself.
              activeView={
                route.tab === "permissions" || route.tab === "collaborators"
                  ? "overview"
                  : route.tab
              }
              activeChangeNumber={route.changeNumber ?? null}
              onTabChange={(tab) =>
                onNavigate({
                  kind: "document",
                  owner: route.owner,
                  repo: route.repo,
                  tab,
                })
              }
              onOpenChange={(pullNumber) =>
                onNavigate({
                  kind: "document",
                  owner: route.owner,
                  repo: route.repo,
                  tab: "changes",
                  ...(pullNumber === null ? {} : { changeNumber: pullNumber }),
                })
              }
              onBack={() => onNavigate({ kind: "home" })}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
