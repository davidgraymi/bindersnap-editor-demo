/**
 * The document index: the text of every document as it is on `main` today
 * (ADR 0007).
 *
 * A derived index in ADR 0004's sense. It is rebuilt from Gitea by a job and
 * never written by a request handler; every row keys on a blob SHA, so a row
 * is either right or visibly stale; and nothing that proves anything reads
 * it. **It decides what matches, never who may see it**: a search passes the
 * binders Gitea says the reader can read, and the query is limited to those.
 *
 * Its own file, `search.db`, beside `sessions.db` and not in it: Litestream
 * replicates `sessions.db` only, and losing this file loses speed, not
 * evidence. So it is not migrated either. When {@link SCHEMA_VERSION} moves,
 * the file is emptied and the next pass rebuilds it, which is the same loop
 * starting from nothing.
 *
 * **Row numbers in blocks.** Each organization gets a slot, each document a
 * number inside its slot, each passage a number inside its document:
 *
 *     document id = slot × 2²⁰ + n        (a million documents a slot)
 *     passage rowid = document id × 2¹²  + ordinal   (4,096 passages each)
 *
 * so every passage of one organization sits in one range of rowids, and one
 * document's passages in a smaller one. Nothing uses the first yet; it is
 * what lets search be limited to one organization later by changing the
 * query, not by rebuilding (ADR 0007, Amber). The largest rowid stays under
 * 2⁵³, so JavaScript reads every one exactly.
 */

import { Database } from "bun:sqlite";
import { basename, dirname, join } from "node:path";

import { config } from "../config";
import type { Passage } from "../../../packages/utils/documentPassages";

/** Bump when a table changes; the file is emptied and rebuilt. */
const SCHEMA_VERSION = 2;

const DOCUMENT_BITS = 20;
const PASSAGE_BITS = 12;
const DOCUMENTS_PER_SLOT = 2 ** DOCUMENT_BITS;
/** A document's passages past this many are not indexed, and it says so. */
export const MAX_PASSAGES = 2 ** PASSAGE_BITS;

/**
 * Porter over unicode61: "disinfecting" finds "disinfect", and "Café" finds
 * "cafe". The same for both tables, so a title and a passage read a word the
 * same way.
 */
const TOKENIZE = "porter unicode61 remove_diacritics 2";

/** Around the matched words in a snippet. Control characters: no document holds one. */
const MATCH_START = "\u0002";
const MATCH_END = "\u0003";

/** Words either side of the match in a snippet. */
const SNIPPET_WORDS = 14;

export interface IndexedBinder {
  repoId: number;
  orgId: number;
  owner: string;
  name: string;
  /** The `main` commit the index was last built from. */
  mainSha: string;
  indexedAt: number;
}

export interface IndexedDocument {
  id: number;
  repoId: number;
  path: string;
  uid: string | null;
  slugPath: string;
  name: string;
  folder: string;
  blobSha: string;
  passages: number;
  /** More passages than {@link MAX_PASSAGES}: only the first are indexed. */
  truncated: boolean;
  /** Whether its words were read, or only its title (a format not read, or a file that failed). */
  contents: boolean;
}

/** A document as the job hands it in: where it is, and what it says. */
export interface DocumentInput {
  path: string;
  uid: string | null;
  slugPath: string;
  name: string;
  folder: string;
  blobSha: string;
  /** Null when its words were not read: it is found by its title only. */
  passages: readonly Passage[] | null;
  /**
   * The same blob as its row already holds: keep that row's passages. Only
   * the job knows, because only it compared the blobs.
   */
  unchanged?: boolean;
}

/** One stretch of a passage: matched words, or the words around them. */
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchHit {
  document: IndexedDocument;
  /** Whether the title, where it is filed, or the words matched. */
  matched: "title" | "contents";
  /** The best passage that matched, when the words did. */
  snippet: {
    ordinal: number;
    heading: string | null;
    parts: SnippetPart[];
  } | null;
}

export interface IndexCounts {
  documents: number;
  passages: number;
  binders: number;
  bytes: number;
}

interface DocumentRow {
  id: number;
  repo_id: number;
  path: string;
  uid: string | null;
  slug_path: string;
  name: string;
  folder: string;
  blob_sha: string;
  passages: number;
  truncated: number;
  contents: number;
}

function toDocument(row: DocumentRow): IndexedDocument {
  return {
    id: row.id,
    repoId: row.repo_id,
    path: row.path,
    uid: row.uid,
    slugPath: row.slug_path,
    name: row.name,
    folder: row.folder,
    blobSha: row.blob_sha,
    passages: row.passages,
    truncated: row.truncated === 1,
    contents: row.contents === 1,
  };
}

/** Words as the title table reads them: `infection-control` is two. */
function titleWords(value: string): string {
  return value.replace(/[-_/.]+/g, " ");
}

/** The snippet FTS5 marked, as stretches of plain text. */
export function snippetParts(marked: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = marked;
  while (rest !== "") {
    const start = rest.indexOf(MATCH_START);
    if (start === -1) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(MATCH_END, start);
    const stop = end === -1 ? rest.length : end;
    parts.push({ text: rest.slice(start + 1, stop), match: true });
    rest = end === -1 ? "" : rest.slice(end + 1);
  }
  return parts.filter((part) => part.text !== "");
}

/**
 * Where `search.db` lives: beside `sessions.db`, outside its backup. A
 * database by any other name — a test's — gets one of its own beside it.
 */
export function searchDbPath(sessionsDbPath = config.sessionsDbPath): string {
  return basename(sessionsDbPath) === "sessions.db"
    ? join(dirname(sessionsDbPath), "search.db")
    : `${sessionsDbPath}-search.db`;
}

export class SearchStore {
  private db: Database;
  readonly path: string;

  constructor(path: string = searchDbPath()) {
    this.path = path;
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA synchronous=NORMAL");
    this.prepare();
  }

  private prepare(): void {
    const version = (
      this.db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version === SCHEMA_VERSION) return;

    // Anything else is a file an older (or newer) build wrote. It holds
    // nothing that cannot be read again, so it is emptied, not migrated.
    this.db.transaction(() => {
      for (const table of [
        "extractions",
        "passages",
        "titles",
        "documents",
        "binders",
        "organizations",
      ]) {
        this.db.run(`DROP TABLE IF EXISTS ${table}`);
      }
      this.db.run(`
        CREATE TABLE organizations (
          org_id INTEGER PRIMARY KEY,
          slot INTEGER NOT NULL UNIQUE
        );
        CREATE TABLE binders (
          repo_id INTEGER PRIMARY KEY,
          org_id INTEGER NOT NULL,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          main_sha TEXT NOT NULL,
          indexed_at INTEGER NOT NULL
        );
        CREATE TABLE documents (
          id INTEGER PRIMARY KEY,
          repo_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          uid TEXT,
          slug_path TEXT NOT NULL,
          name TEXT NOT NULL,
          folder TEXT NOT NULL,
          blob_sha TEXT NOT NULL,
          passages INTEGER NOT NULL,
          truncated INTEGER NOT NULL,
          contents INTEGER NOT NULL,
          UNIQUE (repo_id, path)
        );
        CREATE INDEX documents_by_repo ON documents (repo_id);
        CREATE TABLE extractions (
          blob_sha TEXT PRIMARY KEY,
          started_at INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE passages USING fts5(
          text,
          heading UNINDEXED,
          detail = full,
          tokenize = '${TOKENIZE}'
        );
        CREATE VIRTUAL TABLE titles USING fts5(
          name,
          place,
          detail = full,
          tokenize = '${TOKENIZE}'
        );
      `);
      this.db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    })();
  }

  // ─── What the job reads and writes ─────────────────────────────────────

  binder(repoId: number): IndexedBinder | null {
    const row = this.db
      .query(
        "SELECT repo_id, org_id, owner, name, main_sha, indexed_at FROM binders WHERE repo_id = ?",
      )
      .get(repoId) as {
      repo_id: number;
      org_id: number;
      owner: string;
      name: string;
      main_sha: string;
      indexed_at: number;
    } | null;
    return row
      ? {
          repoId: row.repo_id,
          orgId: row.org_id,
          owner: row.owner,
          name: row.name,
          mainSha: row.main_sha,
          indexedAt: row.indexed_at,
        }
      : null;
  }

  /** Every binder indexed under an organization. */
  bindersOf(orgId: number): IndexedBinder[] {
    const rows = this.db
      .query("SELECT repo_id FROM binders WHERE org_id = ?")
      .all(orgId) as { repo_id: number }[];
    return rows.flatMap((row) => this.binder(row.repo_id) ?? []);
  }

  /** Every organization with anything indexed. */
  organizationIds(): number[] {
    return (
      this.db.query("SELECT DISTINCT org_id FROM binders").all() as {
        org_id: number;
      }[]
    ).map((row) => row.org_id);
  }

  documentsOf(repoId: number): IndexedDocument[] {
    return (
      this.db
        .query("SELECT * FROM documents WHERE repo_id = ? ORDER BY path")
        .all(repoId) as DocumentRow[]
    ).map(toDocument);
  }

  /** The slot an organization's rowids are numbered in, made on first use. */
  private slotOf(orgId: number): number {
    const found = this.db
      .query("SELECT slot FROM organizations WHERE org_id = ?")
      .get(orgId) as { slot: number } | null;
    if (found) return found.slot;
    const next = (
      this.db
        .query("SELECT coalesce(max(slot), 0) + 1 AS slot FROM organizations")
        .get() as { slot: number }
    ).slot;
    this.db
      .query("INSERT INTO organizations (org_id, slot) VALUES (?, ?)")
      .run(orgId, next);
    return next;
  }

  private nextDocumentId(orgId: number): number {
    const base = this.slotOf(orgId) * DOCUMENTS_PER_SLOT;
    const last = (
      this.db
        .query("SELECT max(id) AS id FROM documents WHERE id >= ? AND id < ?")
        .get(base, base + DOCUMENTS_PER_SLOT) as { id: number | null }
    ).id;
    const next = last === null ? base : last + 1;
    if (next >= base + DOCUMENTS_PER_SLOT) {
      throw new Error(
        `Organization ${orgId} has more documents than one slot of the search index holds.`,
      );
    }
    return next;
  }

  private writeTitle(document: IndexedDocument, binderName: string): void {
    this.db.query("DELETE FROM titles WHERE rowid = ?").run(document.id);
    this.db
      .query("INSERT INTO titles (rowid, name, place) VALUES (?, ?, ?)")
      .run(
        document.id,
        titleWords(document.name),
        titleWords(`${document.folder} ${binderName}`),
      );
  }

  private deletePassages(documentId: number): void {
    const first = documentId * MAX_PASSAGES;
    this.db
      .query("DELETE FROM passages WHERE rowid BETWEEN ? AND ?")
      .run(first, first + MAX_PASSAGES - 1);
  }

  /**
   * One binder as it is at `mainSha`, in one transaction.
   *
   * `documents` is every document on `main`. One marked `unchanged` keeps
   * its passages; one that left `main` is deleted. A document is matched to its row by identity first, so a policy
   * renamed or refiled keeps its number and is not read again.
   */
  writeBinder(params: {
    repoId: number;
    orgId: number;
    owner: string;
    name: string;
    mainSha: string;
    documents: readonly DocumentInput[];
    now?: number;
  }): void {
    const { repoId, orgId, owner, name, mainSha } = params;
    this.db.transaction(() => {
      const existing = this.documentsOf(repoId);
      const byUid = new Map(
        existing.flatMap((row) => (row.uid ? [[row.uid, row] as const] : [])),
      );
      const byPath = new Map(existing.map((row) => [row.path, row]));
      const kept = new Set<number>();

      // Paths are unique per binder, and a rename can hand a path from one
      // row to another — so every row being kept steps aside first.
      const placed: { input: DocumentInput; row: IndexedDocument | null }[] =
        params.documents.map((input) => {
          const row =
            (input.uid ? byUid.get(input.uid) : undefined) ??
            byPath.get(input.path) ??
            null;
          const claimed = row && !kept.has(row.id) ? row : null;
          if (claimed) kept.add(claimed.id);
          return { input, row: claimed };
        });

      for (const row of existing) {
        if (!kept.has(row.id)) {
          this.deletePassages(row.id);
          this.db.query("DELETE FROM titles WHERE rowid = ?").run(row.id);
          this.db.query("DELETE FROM documents WHERE id = ?").run(row.id);
        } else {
          this.db
            .query("UPDATE documents SET path = ? WHERE id = ?")
            .run(`\u0000${row.id}`, row.id);
        }
      }

      for (const { input, row } of placed) {
        const id = row?.id ?? this.nextDocumentId(orgId);
        const reread = !input.unchanged || row === null;
        const passages = input.passages ?? [];
        const indexed = passages.slice(0, MAX_PASSAGES);

        if (reread) {
          this.deletePassages(id);
          const insert = this.db.query(
            "INSERT INTO passages (rowid, text, heading) VALUES (?, ?, ?)",
          );
          for (const passage of indexed) {
            insert.run(
              id * MAX_PASSAGES + passage.ordinal,
              passage.text,
              passage.heading,
            );
          }
        }

        const document: IndexedDocument = {
          id,
          repoId,
          path: input.path,
          uid: input.uid,
          slugPath: input.slugPath,
          name: input.name,
          folder: input.folder,
          blobSha: input.blobSha,
          passages: reread ? indexed.length : (row?.passages ?? 0),
          truncated: reread
            ? passages.length > MAX_PASSAGES
            : (row?.truncated ?? false),
          contents: reread ? input.passages !== null : (row?.contents ?? false),
        };
        this.db
          .query(
            `INSERT INTO documents (id, repo_id, path, uid, slug_path, name, folder, blob_sha, passages, truncated, contents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               path = excluded.path, uid = excluded.uid, slug_path = excluded.slug_path,
               name = excluded.name, folder = excluded.folder, blob_sha = excluded.blob_sha,
               passages = excluded.passages, truncated = excluded.truncated,
               contents = excluded.contents`,
          )
          .run(
            id,
            repoId,
            document.path,
            document.uid,
            document.slugPath,
            document.name,
            document.folder,
            document.blobSha,
            document.passages,
            document.truncated ? 1 : 0,
            document.contents ? 1 : 0,
          );
        this.writeTitle(document, name);
      }

      this.db
        .query(
          `INSERT INTO binders (repo_id, org_id, owner, name, main_sha, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (repo_id) DO UPDATE SET
             org_id = excluded.org_id, owner = excluded.owner, name = excluded.name,
             main_sha = excluded.main_sha, indexed_at = excluded.indexed_at`,
        )
        .run(repoId, orgId, owner, name, mainSha, params.now ?? Date.now());
    })();
  }

  /**
   * A binder renamed, or its organization: the same rows under a new name.
   * The titles carry the binder's name, so they are written again.
   */
  renameBinder(repoId: number, owner: string, name: string): void {
    const binder = this.binder(repoId);
    if (!binder || (binder.owner === owner && binder.name === name)) return;
    this.db.transaction(() => {
      this.db
        .query("UPDATE binders SET owner = ?, name = ? WHERE repo_id = ?")
        .run(owner, name, repoId);
      for (const document of this.documentsOf(repoId)) {
        this.writeTitle(document, name);
      }
    })();
  }

  /** A binder Gitea no longer has, or no longer lets the job read. */
  removeBinder(repoId: number): void {
    this.db.transaction(() => {
      for (const document of this.documentsOf(repoId)) {
        this.deletePassages(document.id);
        this.db.query("DELETE FROM titles WHERE rowid = ?").run(document.id);
      }
      this.db.query("DELETE FROM documents WHERE repo_id = ?").run(repoId);
      this.db.query("DELETE FROM binders WHERE repo_id = ?").run(repoId);
    })();
  }

  /**
   * Note that a file is about to be opened, or say it must not be.
   *
   * A file that takes the process down with it — a Word file that unpacks to
   * gigabytes, a PDF built to exhaust pdf.js — leaves its note behind, and
   * the next pass finds it and does not open that file again: it is found by
   * its title. Without this, one such file would take the API down on every
   * sweep, forever. Emptying `search.db` (a rebuild) clears the notes.
   */
  beginExtraction(blobSha: string, now = Date.now()): boolean {
    const found = this.db
      .query("SELECT 1 FROM extractions WHERE blob_sha = ?")
      .get(blobSha);
    if (found) return false;
    this.db
      .query("INSERT INTO extractions (blob_sha, started_at) VALUES (?, ?)")
      .run(blobSha, now);
    return true;
  }

  /** The file was opened and closed, whether or not its words came out. */
  endExtraction(blobSha: string): void {
    this.db.query("DELETE FROM extractions WHERE blob_sha = ?").run(blobSha);
  }

  // ─── What a search reads ───────────────────────────────────────────────

  /** Which of these binders the index has read at least once. */
  indexedRepoIds(repoIds: readonly number[]): Set<number> {
    const rows = this.db
      .query(
        "SELECT repo_id FROM binders WHERE repo_id IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(repoIds)) as { repo_id: number }[];
    return new Set(rows.map((row) => row.repo_id));
  }

  /**
   * The documents that match, best first, in these binders only.
   *
   * A match on a document's title or where it is filed comes before a match
   * in its words: somebody who typed a policy's name wants that policy, not
   * every policy that mentions it. Within each, BM25 decides; a title weighs
   * its name ten times where it is filed. Each document appears once, with
   * the best passage that matched as its snippet.
   */
  search(params: {
    query: string;
    repoIds: readonly number[];
    limit: number;
  }): { hits: SearchHit[]; hasMore: boolean } {
    const { query, limit } = params;
    if (params.repoIds.length === 0) return { hits: [], hasMore: false };
    const repos = JSON.stringify(params.repoIds);
    const take = limit + 1;

    const titleRows = this.db
      .query(
        `SELECT d.* FROM titles t JOIN documents d ON d.id = t.rowid
         WHERE titles MATCH ?1
           AND d.repo_id IN (SELECT value FROM json_each(?2))
         ORDER BY bm25(titles, 10.0, 1.0)
         LIMIT ?3`,
      )
      .all(query, repos, take) as DocumentRow[];

    // One row per document: its best passage's score. The scan is every
    // matching passage in the reader's binders — what grows with the
    // deployment (ADR 0007, "What grows is query time").
    const contentRows = this.db
      .query(
        `SELECT d.*, best.rowid AS best_rowid FROM (
           SELECT p.rowid AS rowid, p.rowid / ${MAX_PASSAGES} AS document_id,
                  min(p.rank) AS score
           FROM passages p
           WHERE passages MATCH ?1
             AND p.rowid / ${MAX_PASSAGES} IN (
               SELECT id FROM documents
               WHERE repo_id IN (SELECT value FROM json_each(?2))
             )
           GROUP BY document_id
           ORDER BY score
           LIMIT ?3
         ) best JOIN documents d ON d.id = best.document_id
         ORDER BY best.score`,
      )
      .all(query, repos, take * 2) as (DocumentRow & { best_rowid: number })[];

    const best = new Map(contentRows.map((row) => [row.id, row.best_rowid]));
    const seen = new Set<number>();
    const ordered: { row: DocumentRow; matched: "title" | "contents" }[] = [];
    for (const row of titleRows) {
      seen.add(row.id);
      ordered.push({ row, matched: "title" });
    }
    for (const row of contentRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      ordered.push({ row, matched: "contents" });
    }

    const snippet = this.db.query(
      `SELECT heading, snippet(passages, 0, '${MATCH_START}', '${MATCH_END}', '…', ${SNIPPET_WORDS}) AS marked
       FROM passages WHERE passages MATCH ?1 AND rowid = ?2`,
    );

    const hits = ordered.slice(0, limit).map(({ row, matched }): SearchHit => {
      const rowid = best.get(row.id);
      const found =
        rowid === undefined
          ? null
          : (snippet.get(query, rowid) as {
              heading: string | null;
              marked: string;
            } | null);
      return {
        document: toDocument(row),
        matched,
        snippet:
          found && rowid !== undefined
            ? {
                ordinal: rowid % MAX_PASSAGES,
                heading: found.heading,
                parts: snippetParts(found.marked),
              }
            : null,
      };
    });

    return { hits, hasMore: ordered.length > limit };
  }

  counts(): IndexCounts {
    const one = (sql: string) => (this.db.query(sql).get() as { n: number }).n;
    return {
      documents: one("SELECT count(*) AS n FROM documents"),
      passages: one("SELECT coalesce(sum(passages), 0) AS n FROM documents"),
      binders: one("SELECT count(*) AS n FROM binders"),
      bytes: one(
        "SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()",
      ),
    };
  }

  close(): void {
    this.db.close();
  }
}

let store: SearchStore | null = null;

export function searchStore(): SearchStore {
  store ??= new SearchStore();
  return store;
}
