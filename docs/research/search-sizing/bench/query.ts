import { Database } from "bun:sqlite";
const N = process.argv[2];
const suffix = process.argv[3] ?? "stored";
const D = process.env.FTS5BENCH_DIR ?? "/tmp/fts5bench/db";
const doc = new Database(`${D}/doc1_full_${suffix}_u61_${N}.db`, {
  readonly: false,
});
const pas = new Database(`${D}/pass_full_${suffix}_u61_${N}.db`, {
  readonly: false,
});
const stored = suffix === "stored";
doc.run(
  "create virtual table if not exists temp.v using fts5vocab(main, f, row)",
);
pas.run(
  "create virtual table if not exists temp.v using fts5vocab(main, f, row)",
);
const ndocs =
  (doc.query("select count(*) c from f").get() as any)?.c ?? Number(N);
const vocab = doc
  .query("select term, doc, cnt from temp.v where length(term)>3")
  .all() as any[];
const pick = (frac: number) =>
  vocab.reduce((b, r) =>
    Math.abs(r.doc / ndocs - frac) < Math.abs(b.doc / ndocs - frac) ? r : b,
  );
const terms = {
  "df~90%": pick(0.9),
  "df~50%": pick(0.5),
  "df~5%": pick(0.05),
  "df~0.5%": pick(0.005),
  "df~0.05%": pick(0.0005),
};
const pv = (t: string) =>
  pas.query("select doc, cnt from temp.v where term=?").get(t) as any;
const queries: [string, string][] = Object.entries(terms).map(([k, r]) => [
  k,
  r.term,
]);
queries.push([
  "AND df50%+df5%",
  `${terms["df~50%"].term} ${terms["df~5%"].term}`,
]);
queries.push([
  "OR 3 terms",
  `${terms["df~50%"].term} OR ${terms["df~5%"].term} OR ${terms["df~0.5%"].term}`,
]);
function time(fn: () => any, reps = 15) {
  fn();
  const ts: number[] = [];
  let out;
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    out = fn();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  return { ms: +ts[Math.floor(reps / 2)].toFixed(2), out };
}
const dTop = doc.prepare(
  "select rowid from f where f match ? order by rank limit 10",
);
const dSnip = stored
  ? doc.prepare(
      "select rowid, snippet(f,0,'[',']','…',16) s from f where f match ? order by rank limit 10",
    )
  : null;
const dHl = stored
  ? doc.prepare(
      "select rowid, length(highlight(f,0,'[',']')) s from f where f match ? order by rank limit 10",
    )
  : null;
const dCnt = doc.prepare("select count(*) c from f where f match ?");
const pTop = pas.prepare(
  "select rowid from f where f match ? order by rank limit 10",
);
const pSnip = stored
  ? pas.prepare(
      "select rowid, snippet(f,0,'[',']','…',16) s from f where f match ? order by rank limit 10",
    )
  : null;
const pDocRank = pas.prepare(
  "with m as materialized (select rowid>>10 d, bm25(f) s from f where f match ?) select d, min(s) s from m group by d order by s limit 10",
);
const pCnt = pas.prepare("select count(*) c from f where f match ?");
const pInDoc = pas.prepare(
  `select rowid${stored ? ", snippet(f,0,'[',']','…',16)" : ""} from f where f match ? and rowid between ? and ? order by rank limit 1`,
);
const dContent = stored
  ? doc.prepare("select body from f where rowid=?")
  : null;
for (const [label, q] of queries) {
  const r: any = {
    label,
    q,
    docMatches: dCnt.get(q).c,
    passageMatches: pCnt.get(q).c,
  };
  r.doc_top10 = time(() => dTop.all(q)).ms;
  if (dSnip) r.doc_top10_snippet = time(() => dSnip.all(q)).ms;
  if (dHl) r.doc_top10_highlightWholeDoc = time(() => dHl.all(q)).ms;
  r.doc_count = time(() => dCnt.get(q)).ms;
  r.pass_top10 = time(() => pTop.all(q)).ms;
  if (pSnip) r.pass_top10_snippet = time(() => pSnip.all(q)).ms;
  r.pass_docRank_groupby = time(() => pDocRank.all(q)).ms;
  r.twoStage_docTop10_thenPassageFTS = time(() => {
    const ds = dTop.all(q) as any[];
    return ds.map((d) => pInDoc.get(q, d.rowid * 1024, d.rowid * 1024 + 1023));
  }).ms;
  if (dContent) {
    const words = q
      .split(/\s+/)
      .filter((w) => w !== "OR")
      .map((w) => w.toLowerCase());
    r.twoStage_docTop10_thenJSPassageScan = time(() => {
      const ds = dTop.all(q) as any[];
      return ds.map((d) => {
        const body = (dContent.get(d.rowid) as any).body as string;
        let best = -1,
          bi = 0;
        body.split("\n\n").forEach((p, i) => {
          const lp = p.toLowerCase();
          let s = 0;
          for (const w of words) {
            let k = lp.indexOf(w);
            while (k >= 0) {
              s++;
              k = lp.indexOf(w, k + 1);
            }
          }
          if (s > best) {
            best = s;
            bi = i;
          }
        });
        return bi;
      });
    }).ms;
  }
  console.log(JSON.stringify(r));
}
// update cost: replace 50 docs
function upd(db: Database, isPass: boolean) {
  const segs0 = (db.query("select count(*) c from f_idx").get() as any).c;
  const get = stored
    ? isPass
      ? db.prepare("select rowid, body from f where rowid between ? and ?")
      : db.prepare("select rowid, body from f where rowid = ?")
    : null;
  const del = isPass
    ? db.prepare("delete from f where rowid between ? and ?")
    : db.prepare("delete from f where rowid=?");
  const ins = db.prepare("insert into f(rowid, body) values(?,?)");
  const ts: number[] = [];
  for (let i = 1; i <= 50; i++) {
    const id = i * 97;
    const fake = Array.from(
      { length: 69 },
      (_, j) =>
        `passage ${j} about hand hygiene and infection control policy number ${id} revised`,
    );
    const t = performance.now();
    db.transaction(() => {
      if (isPass) {
        del.run(id * 1024, id * 1024 + 1023);
        fake.forEach((p, j) => ins.run(id * 1024 + j, p));
      } else {
        del.run(id);
        ins.run(id, fake.join("\n\n"));
      }
    })();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  const segs1 = (db.query("select count(*) c from f_idx").get() as any).c;
  return {
    medianMsPerDocReplace: +ts[25].toFixed(2),
    p90: +ts[45].toFixed(2),
    idxRowsBefore: segs0,
    idxRowsAfter: segs1,
  };
}
console.log(
  JSON.stringify({ update_doc: upd(doc, false), update_pass: upd(pas, true) }),
);
console.log(
  JSON.stringify({
    rssMB: (process.memoryUsage().rss / 1048576).toFixed(0),
    terms: Object.fromEntries(
      Object.entries(terms).map(([k, r]) => [
        k,
        {
          term: r.term,
          docs: r.doc,
          cntInDocs: r.cnt,
          passages: pv(r.term)?.doc,
        },
      ]),
    ),
  }),
);
