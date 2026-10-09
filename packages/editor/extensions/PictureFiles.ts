import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import {
  PictureError,
  describeFromFileName,
  isPictureFile,
  pictureToDataUrl,
} from "../imageFiles";

export interface PictureFilesOptions {
  /** Why a picture was not put in, for the page to say. */
  onError: (message: string) => void;
}

/**
 * Pictures pasted or dropped onto the page go in as pictures.
 *
 * Without this the browser's own handling applies: a dropped file navigates
 * the tab away from the unsaved document to the picture, and a pasted
 * screenshot does nothing at all. Both now read the file, scale it (see
 * `imageFiles.ts`) and put it where it was pasted or dropped.
 *
 * **A paste that carries text is a text paste.** Word puts a picture of the
 * copied words on the clipboard beside their HTML; treating that as a picture
 * paste would turn every paragraph copied out of Word into a screenshot of
 * itself.
 */
export const PictureFiles = Extension.create<PictureFilesOptions>({
  name: "pictureFiles",

  addOptions() {
    return { onError: () => undefined };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { onError } = this.options;

    const insert = async (files: File[], at: number | null) => {
      for (const file of files) {
        try {
          const src = await pictureToDataUrl(file);
          if (editor.isDestroyed) return;
          const content = {
            type: "image",
            attrs: { src, alt: describeFromFileName(file.name) },
          };
          if (at === null) editor.chain().focus().insertContent(content).run();
          else editor.chain().focus().insertContentAt(at, content).run();
        } catch (err) {
          onError(
            err instanceof PictureError
              ? err.message
              : "That picture could not be put in the document.",
          );
        }
      }
    };

    return [
      new Plugin({
        key: new PluginKey("pictureFiles"),
        props: {
          handlePaste(_view, event) {
            const data = event.clipboardData;
            if (!data || !editor.isEditable) return false;
            if (data.getData("text/html") || data.getData("text/plain")) {
              return false;
            }
            const files = Array.from(data.files);
            if (files.length === 0) return false;
            const pictures = files.filter(isPictureFile);
            if (pictures.length === 0) {
              onError(
                "Only PNG, JPEG, GIF and WebP pictures can go in a document.",
              );
              return true;
            }
            event.preventDefault();
            void insert(pictures, null);
            return true;
          },

          handleDrop(view, event, _slice, moved) {
            if (moved || !editor.isEditable) return false;
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            event.preventDefault();
            const pictures = files.filter(isPictureFile);
            if (pictures.length === 0) {
              onError(
                "Only pictures can be dropped into a document. To add a file to the binder, use Add a document.",
              );
              return true;
            }
            const at =
              view.posAtCoords({ left: event.clientX, top: event.clientY })
                ?.pos ?? null;
            void insert(pictures, at);
            return true;
          },
        },
      }),
    ];
  },
});
