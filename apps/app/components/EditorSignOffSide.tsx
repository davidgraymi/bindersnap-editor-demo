import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { setBinderSignOffRule } from "../api";
import { binderSignOffQuery, queryKeys } from "../data/queries";
import type { AppRoute } from "../routes";
import {
  buildSignOffPanel,
  describeDocumentPath,
  describeFolder,
  withOwner,
  withoutOwner,
  type PanelOrigin,
  type SignOffPlace,
} from "../signOffPanel";
import { useRememberedToggle } from "../useRememberedToggle";
import { SignOffAdd } from "./SignOffAdd";
import { SignOffPanel } from "./SignOffPanel";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

const STORAGE_KEY = "bindersnap.editor.signoff.collapsed";

/**
 * The width the file panel, a sheet of Letter at 100% and this panel need
 * together, with the desk's margins: measured in the mocks, the page ends
 * where this panel starts at 1440px.
 */
const ROOM_FOR_BOTH = 1440;

function subscribeWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
function hasRoom(): boolean {
  return window.innerWidth >= ROOM_FOR_BOTH;
}

/**
 * "Who signs off here", the editor's right-hand panel (D16).
 *
 * It mirrors the file panel on the left: floating over the desk under the
 * ribbon, shut to a small button with the same remembered toggle. It shows the
 * rules for whatever is open, a folder or a document, read at the draft, and
 * **Set here is edited here**: each edit is one act in the draft, like a
 * rename. From above is read only, and its origin links move the desk.
 *
 * It starts shut when the window cannot hold both panels and the page, and
 * otherwise remembers what the person last did. It never shrinks the page.
 */
export function EditorSignOffSide({
  org,
  binder,
  binderName,
  draft,
  place,
  canEdit,
  onNavigate,
  onOpenOrigin,
  originHref,
}: {
  org: string;
  binder: string;
  binderName: string;
  /** The draft the rules are read at and written into. */
  draft: string;
  place: SignOffPlace;
  /** False on a change request edited in place: rules go into a draft. */
  canEdit: boolean;
  onNavigate: (route: AppRoute) => void;
  onOpenOrigin: (origin: PanelOrigin) => void;
  originHref: (origin: PanelOrigin) => string;
}) {
  const queryClient = useQueryClient();
  const remembered = useRememberedToggle(STORAGE_KEY);
  const roomy = useSyncExternalStore(subscribeWidth, hasRoom, () => true);
  /** Opened on a narrow window this sitting, overriding the starting rule. */
  const [openedNarrow, setOpenedNarrow] = useState(false);
  useEffect(() => {
    if (roomy) setOpenedNarrow(false);
  }, [roomy]);
  const shut = roomy ? remembered.on : !openedNarrow;
  const toggle = roomy
    ? remembered.toggle
    : () => setOpenedNarrow((was) => !was);

  const read = useQuery(binderSignOffQuery(org, binder, { draft }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (shut) {
    return (
      <div className="doc-signoff-anchor">
        <button
          type="button"
          className="doc-files-launcher doc-signoff-launcher"
          aria-expanded={false}
          aria-label="Show who signs off here"
          title="Who signs off here"
          onClick={toggle}
        >
          <AppIcon icon={ICON.rules} size="md" />
        </button>
      </div>
    );
  }

  const where =
    place.kind === "binder" ? (
      <>
        For <strong>{binderName}</strong>
      </>
    ) : place.kind === "folder" ? (
      <>
        For <strong>{describeFolder(place.path)}</strong>
      </>
    ) : (
      <>
        For <strong>{describeDocumentPath(place.path)}</strong>
        {place.path.includes("/") ? (
          <>
            , in{" "}
            {describeFolder(place.path.slice(0, place.path.lastIndexOf("/")))}
          </>
        ) : null}
      </>
    );

  const edit = async (next: Parameters<typeof setBinderSignOffRule>[2]) => {
    setBusy(true);
    setError(null);
    try {
      await setBinderSignOffRule(org, binder, next, { draft });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.binderSignOff(org, binder, { draft }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.binder(org, binder),
      });
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to change who signs off here.",
      );
    } finally {
      setBusy(false);
    }
  };

  const view = read.data
    ? buildSignOffPanel({
        payload: read.data,
        place,
        binderName,
        editing: true,
      })
    : null;

  return (
    <div className="doc-signoff-anchor">
      <aside className="doc-signoff-float" aria-label="Who signs off here">
        <div className="doc-signoff-head">
          <h2 className="doc-signoff-title">Who signs off here</h2>
          <button
            type="button"
            className="app-explorer-toggle"
            aria-expanded
            aria-label="Hide who signs off here"
            title="Hide who signs off here"
            onClick={toggle}
          >
            <AppIcon icon={ICON.hidePanel} size="md" />
          </button>
        </div>
        <p className="doc-signoff-where">{where}</p>
        {error ? (
          <p className="bs-note bs-note--danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="doc-signoff-body">
          {read.error ? (
            <p className="doc-rail-empty">
              Unable to read who signs off here right now.
            </p>
          ) : !view ? (
            <SkeletonGroup label="Reading who signs off">
              <SkeletonLine width="medium" />
            </SkeletonGroup>
          ) : (
            <SignOffPanel
              org={org}
              view={view}
              framed={false}
              onNavigate={onNavigate}
              onOpenOrigin={onOpenOrigin}
              originHref={originHref}
              {...(canEdit && read.data?.canEdit && view.ownTarget
                ? {
                    editing: {
                      busy,
                      onRemove: (row) => {
                        if (!row.rule || !row.owner) return;
                        void edit(withoutOwner(row.rule, row.owner));
                      },
                      add: (
                        <SignOffAdd
                          org={org}
                          binder={binder}
                          busy={busy}
                          already={{
                            groups: view.ownRule?.teams ?? [],
                            people: view.ownRule?.users ?? [],
                          }}
                          onAdd={(owner) =>
                            void edit(
                              withOwner(view.ownRule, view.ownTarget!, owner),
                            )
                          }
                        />
                      ),
                    },
                  }
                : {})}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
