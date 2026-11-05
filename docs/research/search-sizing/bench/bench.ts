import { Database } from "bun:sqlite";
import { readFileSync, statSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";

const REPO = process.argv[2];
const N = Number(process.argv[3]);
const VARIANTS = process.argv[4].split(",");
const DIR = process.env.FTS5BENCH_DIR ?? "/tmp/fts5bench/db";

// ---- corpus: real English sentences from repo markdown + rare words ----
const files = execSync(
  `find ${REPO} -name node_modules -prune -o -name .git -prune -o -path "*/docs/research" -prune -o -name '*.md' -print`,
)
  .toString()
  .trim()
  .split("\n");
let prose = files.map((f) => readFileSync(f, "utf8")).join("\n");
prose = prose
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/`[^`]*`/g, " ")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/[#*>|_\-]{1,}/g, " ");
const sentences = prose
  .split(/(?<=[.!?])\s+/)
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(
    (s) =>
      s.split(" ").length >= 6 && s.split(" ").length <= 40 && /^[A-Z]/.test(s),
  );
const dict = readFileSync("/usr/share/dict/words", "utf8")
  .split("\n")
  .filter((w) => w.length > 3);
let seed = 12345;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
// each doc has its own ~40 "local" rare words (drug names, unit names, etc.) used repeatedly
function makeDoc(): { title: string; passages: string[] } {
  const local = Array.from({ length: 40 }, () => pick(dict));
  const passages: string[] = [];
  let words = 0;
  const target = 2000 + Math.floor(rnd() * 2000);
  while (words < target) {
    if (passages.length % 6 === 0) {
      const h = pick(sentences)
        .split(" ")
        .slice(0, 3 + Math.floor(rnd() * 4))
        .join(" ");
      passages.push(h);
      words += h.split(" ").length;
      continue;
    }
    const k = 2 + Math.floor(rnd() * 3);
    const ss: string[] = [];
    for (let i = 0; i < k; i++)
      ss.push(
        pick(sentences)
          .split(" ")
          .map((w) => (rnd() < 0.03 ? pick(local) : w))
          .join(" "),
      );
    const p = ss.join(" ");
    passages.push(p);
    words += p.split(" ").length;
  }
  return { title: pick(sentences).split(" ").slice(0, 5).join(" "), passages };
}

function sizes(db: Database) {
  const rows = db
    .query(
      "select name, sum(pgsize) s from dbstat group by name order by s desc",
    )
    .all() as any[];

  const o: Record<string, number> = {};
  for (const r of rows) o[r.name] = r.s;
  return o;
}
const MB = (b: number) => (b / 1048576).toFixed(1);

const docs: { title: string; passages: string[] }[] = [];
for (let i = 0; i < N; i++) docs.push(makeDoc());
let tw = 0,
  tp = 0,
  tb = 0;
const vocab = new Set<string>();
let uniqPerDoc = 0;
for (const d of docs.slice(0, 200)) {
  const toks = d.passages
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9]+/g)!;
  const u = new Set(toks);
  uniqPerDoc += u.size;
}
for (const d of docs) {
  tp += d.passages.length;
  for (const p of d.passages) {
    tw += p.split(" ").length;
    tb += p.length;
  }
}
console.log(
  JSON.stringify({
    N,
    sentences: sentences.length,
    avgWords: tw / N,
    avgPassages: tp / N,
    avgBytes: tb / N + tp / N,
    uniqTokensPerDoc: uniqPerDoc / 200,
    totalTextMB: MB(tb + tp),
  }),
);

for (const v of VARIANTS) {
  // v = level_detail_content_tok   e.g. doc_full_stored_u61 , pass_full_none_porter
  const [level, detail, content, tok] = v.split("_");
  const file = `${DIR}/${v}_${N}.db`;
  for (const s of ["", "-wal", "-shm"])
    if (existsSync(file + s)) rmSync(file + s);
  const db = new Database(file);
  db.run("pragma journal_mode=wal");
  db.run("pragma synchronous=normal");
  const tokenize =
    tok === "porter"
      ? "porter unicode61"
      : tok === "tri"
        ? "trigram"
        : "unicode61";
  const contentOpt =
    content === "stored"
      ? ""
      : content === "cl"
        ? ", content='', contentless_delete=1"
        : ", content='', columnsize=0";
  const cols = level === "doc" ? "title, body" : "body";
  db.run(
    `create virtual table f using fts5(${cols}, tokenize='${tokenize}', detail=${detail}${contentOpt})`,
  );
  const ins =
    level === "doc1"
      ? db.prepare("insert into f(rowid,body) values(?,?)")
      : level === "doc"
        ? db.prepare("insert into f(rowid,title,body) values(?,?,?)")
        : db.prepare("insert into f(rowid,body) values(?,?)");
  let t0 = performance.now();
  const batch = db.transaction((from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const d = docs[i];
      if (level === "doc") ins.run(i + 1, d.title, d.passages.join("\n\n"));
      else if (level === "doc1") ins.run(i + 1, d.passages.join("\n\n"));
      else d.passages.forEach((p, j) => ins.run((i + 1) * 1024 + j, p));
    }
  });
  for (let i = 0; i < N; i += 100) batch(i, Math.min(N, i + 100)); // 100 docs per commit
  const tIns = performance.now() - t0;
  db.run("pragma wal_checkpoint(truncate)");
  const before = sizes(db);
  const fileBefore = statSync(file).size;
  const segs = (db.query("select count(*) c from f_idx").get() as any).c;
  t0 = performance.now();
  db.run("insert into f(f) values('optimize')");
  const tOpt = performance.now() - t0;
  db.run("pragma wal_checkpoint(truncate)");
  db.run("vacuum");
  const after = sizes(db);
  const fileAfter = statSync(file).size;

  console.log(
    JSON.stringify({
      v,
      N,
      insertSec: +(tIns / 1000).toFixed(1),
      optimizeSec: +(tOpt / 1000).toFixed(1),
      fileMBbeforeOpt: MB(fileBefore),
      fileMBafterOptVacuum: MB(fileAfter),
      tables: Object.fromEntries(
        Object.entries(after).map(([k, s]) => [k, MB(s)]),
      ),
      tablesBeforeOpt: Object.fromEntries(
        Object.entries(before)
          .filter(([k]) => k.startsWith("f_"))
          .map(([k, s]) => [k, MB(s)]),
      ),
    }),
  );
  db.close();
}
