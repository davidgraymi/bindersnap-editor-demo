import { convertibleKind } from "../convertToEditor";

/**
 * "Edit it in Bindersnap" on an upload.
 *
 * Offered only when something being uploaded can be converted — a `.docx` or a
 * PDF — and **off by default**: a Word file is often uploaded to be kept
 * exactly as it is, and a conversion changes what the record holds. The choice
 * is the person's, made per upload, and never remembered.
 */

/** Whether any of these files could be converted. */
export function anyConvertible(fileNames: readonly string[]): boolean {
  return fileNames.some((name) => convertibleKind(name) !== null);
}

export function ConvertOnUploadField({
  checked,
  onChange,
  disabled = false,
  plural = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** More than one file: the Word files and PDFs among them. */
  plural?: boolean;
}) {
  return (
    <div className="bs-field">
      <label className="app-check-row">
        <input
          className="app-check-input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {plural
            ? "Make the Word files and PDFs editable in Bindersnap"
            : "Make it editable in Bindersnap"}
        </span>
      </label>
      <p className="bs-field-hint">
        {checked
          ? "Read in your browser and added as a document you can edit. Layout does not come across, so read it through before it is reviewed."
          : "Left unticked, it is kept exactly as the file you chose."}
      </p>
    </div>
  );
}
