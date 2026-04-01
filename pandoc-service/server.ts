/**
 * Bindersnap Pandoc conversion service.
 *
 * Routes:
 *   GET  /health               — liveness probe
 *   POST /convert/docx-to-json — multipart/form-data { file: .docx } → ProseMirror JSON
 *   POST /convert/json-to-docx — { doc: ProseMirrorJSON } → .docx binary
 */

import { $ } from 'bun';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';

import { pandocToProseMirror, proseMirrorToPandoc, type PMDoc } from './transform';

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function errorJson(message: string, status = 500): Response {
  return json({ error: message }, status);
}

async function docxToJson(req: Request): Promise<Response> {
  let tmpInput: string | null = null;

  try {
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return errorJson('Missing "file" field in multipart form data.', 400);
    }

    if (!file.name.endsWith('.docx')) {
      return errorJson('Only .docx files are supported.', 400);
    }

    tmpInput = join(tmpdir(), `${randomUUID()}.docx`);
    await Bun.write(tmpInput, await file.arrayBuffer());

    const result = await $`pandoc ${tmpInput} -f docx -t json`.text();
    const pandocAst = JSON.parse(result);
    const doc = pandocToProseMirror(pandocAst);

    return json({ doc });
  } catch (err) {
    console.error('[docx-to-json]', err);
    return errorJson(err instanceof Error ? err.message : 'Conversion failed.');
  } finally {
    if (tmpInput) {
      await unlink(tmpInput).catch(() => undefined);
    }
  }
}

async function jsonToDocx(req: Request): Promise<Response> {
  let tmpInput: string | null = null;
  let tmpOutput: string | null = null;

  try {
    const body = (await req.json()) as { doc?: unknown };
    if (!body.doc || typeof body.doc !== 'object') {
      return errorJson('Missing "doc" field in request body.', 400);
    }

    const pandocAst = proseMirrorToPandoc(body.doc as PMDoc);
    const id = randomUUID();
    tmpInput = join(tmpdir(), `${id}.json`);
    tmpOutput = join(tmpdir(), `${id}.docx`);

    await Bun.write(tmpInput, JSON.stringify(pandocAst));
    await $`pandoc ${tmpInput} -f json -t docx -o ${tmpOutput}`;

    const docxBytes = await Bun.file(tmpOutput).arrayBuffer();

    return new Response(docxBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="document.docx"',
        ...corsHeaders(),
      },
    });
  } catch (err) {
    console.error('[json-to-docx]', err);
    return errorJson(err instanceof Error ? err.message : 'Conversion failed.');
  } finally {
    await Promise.all([
      tmpInput ? unlink(tmpInput).catch(() => undefined) : Promise.resolve(),
      tmpOutput ? unlink(tmpOutput).catch(() => undefined) : Promise.resolve(),
    ]);
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      return json({ ok: true });
    }

    if (url.pathname === '/convert/docx-to-json' && req.method === 'POST') {
      return docxToJson(req);
    }

    if (url.pathname === '/convert/json-to-docx' && req.method === 'POST') {
      return jsonToDocx(req);
    }

    return json({ error: 'Not found' }, 404);
  },
});

console.log(`Pandoc service running on port ${PORT}`);
