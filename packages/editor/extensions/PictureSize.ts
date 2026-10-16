import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";

import { pictureWidth } from "../imageFiles";

/**
 * A picture is sized by dragging its corners, as in Word.
 *
 * Click a picture and it takes a frame with a handle at each corner; drag one
 * and the picture grows or shrinks about the opposite corner, keeping its
 * shape — Word's corner handles do the same, and a policy has no use for a
 * stretched logo. Double-click a handle to put it back to its own size.
 *
 * **Only the width is stored.** The height follows from the picture, so a
 * width is all the reading page needs to draw it the same, and a picture can
 * never be saved squashed. It is stored in CSS pixels at 100% zoom, whatever
 * zoom the author dragged it at, and never wider than the text on the page.
 */

/** Narrower than this and a picture is a speck nobody can click again. */
export const MIN_PICTURE_WIDTH = 24;

/** The four corners, named as the frame's handles are. */
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * The width a drag lands on: the start width moved by the drag, measured on
 * the page — `scale` undoes the zoom — and kept between the smallest a
 * picture may be and the width of the text.
 */
export function draggedWidth({
  startWidth,
  deltaX,
  fromLeft,
  scale,
  maxWidth,
}: {
  startWidth: number;
  deltaX: number;
  /** A left-hand handle: dragging left grows the picture. */
  fromLeft: boolean;
  /** Screen pixels per CSS pixel — the page's zoom. */
  scale: number;
  maxWidth: number;
}): number {
  const moved = (fromLeft ? -deltaX : deltaX) / (scale > 0 ? scale : 1);
  const width = Math.round(startWidth + moved);
  return Math.max(MIN_PICTURE_WIDTH, Math.min(maxWidth, width));
}

class PictureView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: ProseMirrorNode;

  constructor(
    node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.className = "bs-picture";
    this.img = document.createElement("img");
    this.img.draggable = false;
    this.dom.appendChild(this.img);
    for (const corner of CORNERS) {
      const handle = document.createElement("span");
      handle.className = `bs-picture-handle bs-picture-handle--${corner}`;
      handle.dataset.corner = corner;
      handle.setAttribute("aria-hidden", "true");
      handle.addEventListener("pointerdown", (event) =>
        this.startDrag(event, corner),
      );
      handle.addEventListener("dblclick", (event) => {
        event.preventDefault();
        this.commit(null);
      });
      this.dom.appendChild(handle);
    }
    this.render();
  }

  private render() {
    const { src, alt, title, width } = this.node.attrs;
    if (this.img.getAttribute("src") !== src) this.img.src = src ?? "";
    if (alt) this.img.alt = alt;
    else this.img.removeAttribute("alt");
    if (title) this.img.title = title;
    else this.img.removeAttribute("title");
    const px = pictureWidth(width);
    if (px !== null) {
      this.img.setAttribute("width", String(px));
    } else {
      this.img.removeAttribute("width");
    }
  }

  /** The text's width on the page, which a picture may fill but not pass. */
  private maxWidth(): number {
    const text = this.view.dom as HTMLElement;
    return Math.max(MIN_PICTURE_WIDTH, text.clientWidth || Infinity);
  }

  private startDrag(event: PointerEvent, corner: string) {
    if (!this.view.editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = this.img.offsetWidth;
    const shown = this.img.getBoundingClientRect().width;
    const scale = startWidth > 0 ? shown / startWidth : 1;
    const maxWidth = this.maxWidth();
    const fromLeft = corner.endsWith("left");
    let width = startWidth;
    this.dom.classList.add("is-resizing");

    const move = (next: PointerEvent) => {
      width = draggedWidth({
        startWidth,
        deltaX: next.clientX - startX,
        fromLeft,
        scale,
        maxWidth,
      });
      this.img.setAttribute("width", String(width));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      this.dom.classList.remove("is-resizing");
      if (width !== startWidth) this.commit(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  private commit(width: number | null) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      width,
      height: null,
    });
    // Keep the picture selected, so its frame and its tab stay.
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
  }

  stopEvent(event: Event) {
    // The handles are the frame's own; ProseMirror would start a selection.
    return (
      event.target instanceof HTMLElement &&
      event.target.classList.contains("bs-picture-handle")
    );
  }

  ignoreMutation() {
    return true;
  }
}

export const PictureSize = Extension.create({
  name: "pictureSize",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pictureSize"),
        props: {
          nodeViews: {
            image: (node, view, getPos) => new PictureView(node, view, getPos),
          },
        },
      }),
    ];
  },
});
