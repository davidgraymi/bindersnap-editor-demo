import { describeGroupName } from "../../../packages/utils/groupName";
import { followInApp } from "../appLink";
import { routeToPath, type AppRoute } from "../routes";

/**
 * A group's name, as a link to the group's page.
 *
 * One component for every group name in the app — the sign-off panel, the
 * approvals table, reviewers' tags, Settings, People — so "what does this
 * group approve?" is one click from anywhere a group is named.
 */
export function GroupLink({
  org,
  group,
  onNavigate,
  className,
}: {
  org: string;
  /** The group's handle, `infection-control`. */
  group: string;
  onNavigate: (route: AppRoute) => void;
  className?: string;
}) {
  const to: AppRoute = { kind: "organization", org, tab: "people", group };
  return (
    <a
      className={`group-link${className ? ` ${className}` : ""}`}
      href={routeToPath(to)}
      onClick={(event) => followInApp(event, () => onNavigate(to))}
    >
      {describeGroupName(group)}
    </a>
  );
}
