/**
 * pdf.js ships its worker as a plain module with no types beside it.
 *
 * `pdfText.ts` imports it only to hand to pdf.js as `globalThis.pdfjsWorker`,
 * so the one export it needs is the handler pdf.js looks for by name.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
