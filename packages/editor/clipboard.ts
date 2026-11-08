import type { Editor } from "@tiptap/core";

/**
 * Cut, Copy and Paste from a button rather than the keyboard: the ribbon's,
 * the selection toolbar's and the page's right-click menu all take these.
 */

/** Cut or copy what is selected, as Ctrl+X and Ctrl+C do. */
export function cutOrCopy(editor: Editor, act: "cut" | "copy"): void {
  editor.commands.focus();
  document.execCommand(act);
}

/**
 * The Paste button, as Word's: what was copied, as it was copied — or, from
 * its menu, the words alone.
 *
 * Both go through the editor's own paste, the one Ctrl+V takes, so what is
 * pasted is held to the document's schema and a line break is a new
 * paragraph. A picture on the clipboard is handed to the page as a paste,
 * where the picture handling that Ctrl+V reaches says why one did not go in.
 */
export async function paste(
  editor: Editor,
  how: "source" | "text",
): Promise<void> {
  editor.commands.focus();
  const { view } = editor;
  try {
    if (how === "source" && typeof navigator.clipboard.read === "function") {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/html")) {
          const html = await (await item.getType("text/html")).text();
          if (view.pasteHTML(html)) return;
        }
        const picture = item.types.find((type) => type.startsWith("image/"));
        if (picture) {
          const blob = await item.getType(picture);
          const data = new DataTransfer();
          data.items.add(
            new File([blob], `Pasted picture.${picture.slice(6)}`, {
              type: picture,
            }),
          );
          view.dom.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
      }
    }
    const text = await navigator.clipboard.readText();
    if (text) view.pasteText(text);
  } catch {
    // The browser said no to reading the clipboard. Ctrl+V still works, and
    // the cursor is back in the page for it.
  }
}
