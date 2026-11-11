import { useQuery } from "@tanstack/react-query";

import { binderSignOffQuery } from "../data/queries";
import { routeToPath, type AppRoute } from "../routes";
import {
  buildSignOffPanel,
  type PanelOrigin,
  type SignOffPlace,
} from "../signOffPanel";
import { SignOffPanel } from "./SignOffPanel";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * "Who signs off here" for a page in the binder view: read on `main`, where
 * the rules in force are, and drawn for the place the page is about. An
 * origin link goes to the folder or the binder page that sets the rule.
 */
export function SignOffRail({
  org,
  binder,
  binderName,
  place,
  onNavigate,
}: {
  org: string;
  binder: string;
  binderName: string;
  place: SignOffPlace;
  onNavigate: (route: AppRoute) => void;
}) {
  const read = useQuery(binderSignOffQuery(org, binder));

  const originRoute = (origin: PanelOrigin): AppRoute =>
    origin.kind === "binder"
      ? { kind: "binder", org, binder }
      : origin.kind === "folder"
        ? { kind: "binder", org, binder, folder: origin.path }
        : {
            kind: "binderDocument",
            org,
            binder,
            documentPath: origin.path,
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
