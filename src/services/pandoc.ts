/**
 * Client-side interface to the Pandoc conversion service.
 */

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const PANDOC_URL = (appEnv?.BUN_PUBLIC_PANDOC_SERVICE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export type ProseMirrorDoc = Record<string, unknown>;

/**
 * Upload a .docx file and receive a ProseMirror JSON document.
 */
export async function importDocx(file: File): Promise<ProseMirrorDoc> {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${PANDOC_URL}/convert/docx-to-json`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(err.error ?? `Pandoc service error (${response.status})`);
  }

  const data = await response.json() as { doc?: ProseMirrorDoc };
  if (!data.doc) throw new Error('Pandoc service returned no document.');
  return data.doc;
}

/**
 * Send a ProseMirror JSON document and trigger a .docx file download.
 */
export async function exportDocx(doc: ProseMirrorDoc, filename = 'document.docx'): Promise<void> {
  const response = await fetch(`${PANDOC_URL}/convert/json-to-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    body: JSON.stringify({ doc }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(err.error ?? `Pandoc service error (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
