import { Database } from "bun:sqlite";
const doc = new Database(
  `${process.env.FTS5BENCH_DIR ?? "/tmp/fts5bench/db"}/doc1_full_stored_u61_25000.db`,
  { readonly: true },
);
const pas = new Database(
  `${process.env.FTS5BENCH_DIR ?? "/tmp/fts5bench/db"}/pass_full_stored_u61_25000.db`,
  { readonly: true },
);
const t = (fn: () => any) => {
  fn();
  const a: number[] = [];
  for (let i = 0; i < 15; i++) {
    const s = performance.now();
    fn();
    a.push(performance.now() - s);
  }
  a.sort((x, y) => x - y);
  return +a[7].toFixed(2);
};
for (const q of ["content", "deliberately", "borders"])
  for (const orgDocs of [200, 1000, 5000]) {
    const lo = 12000,
      hi = lo + orgDocs - 1;
    const d = doc.prepare(
      "select rowid from f where f match ? and rowid between ? and ? order by rank limit 10",
    );
    const p = pas.prepare(
      "select rowid from f where f match ? and rowid between ? and ? order by rank limit 10",
    );
    console.log(
      JSON.stringify({
        q,
        orgDocs,
        doc_ms: t(() => d.all(q, lo, hi)),
        pass_ms: t(() => p.all(q, lo * 1024, hi * 1024 + 1023)),
      }),
    );
  }
