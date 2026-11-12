import { useQuery } from "@tanstack/react-query";

import { binderSignOffQuery, type SignOffAt } from "../data/queries";
import { routeToPath, type AppRoute } from "../routes";
import {
  buildSignOffPanel,
  type PanelOrigin,
  type SignOffPlace,
} from "../signOffPanel";
import { SignOffPanel } from "./SignOffPanel";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * "Who signs off here" for a page in the binder view, drawn for the place the
 * page is about and read where the page is: `main` for the record, or the
 * branch on screen — a draft read at `/-/tree/{draft}` shows the rules in
 * that draft, the way it shows its documents. An origin link goes to the
 * folder or the binder page that sets the rule, on the same branch.
 */
export function SignOffRail({
  org,
  binder,
  binderName,
  place,
  at = {},
  onNavigate,
}: {
  org: string;
  binder: string;
  binderName: string;
  place: SignOffPlace;
  /** Where the page is read; nothing is `main`. */
  at?: SignOffAt;
  onNavigate: (route: AppRoute) => void;
}) {
  const read = useQuery(binderSignOffQuery(org, binder, at));

  // Following a rule to where it is set stays on the branch being read.
  const branch = at.ref ? { ref: at.ref } : {};
  const originRoute = (origin: PanelOrigin): AppRoute =>
    origin.kind === "binder"
      ? { kind: "binder", org, binder, ...branch }
      : origin.kind === "folder"
        ? { kind: "binder", org, binder, folder: origin.path, ...branch }
        : {
            kind: "binderDocument",
            org,
            binder,
            documentPath: origin.path,
            ...branch,
            ...(at.draft ? { draft: at.draft } : {}),
            ...(at.change ? { change: at.change } : {}),
          };

  if (read.error) {
    return (
      <section className="bs-panel signoff">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Who signs off here</h2>
        </div>
        <p className="doc-rail-empty">
          Unable to read who signs off here right now.
        </p>
      </section>
    );
  }
  if (!read.data) {
    return (
      <section className="bs-panel signoff">
        <div className="bs-panel-bar">
          <h2 className="bs-panel-bar-title">Who signs off here</h2>
        </div>
        <SkeletonGroup label="Reading who signs off">
          <div className="bs-row">
            <SkeletonLine width="medium" />
          </div>
        </SkeletonGroup>
      </section>
    );
  }

  return (
    <SignOffPanel
      org={org}
      view={buildSignOffPanel({ payload: read.data, place, binderName })}
      onNavigate={onNavigate}
      onOpenOrigin={(origin) => onNavigate(originRoute(origin))}
      originHref={(origin) => routeToPath(originRoute(origin))}
    />
  );
}
