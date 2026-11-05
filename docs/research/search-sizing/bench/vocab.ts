import { Database } from "bun:sqlite";
for (const f of ["doc1_full_cl_u61_10000", "pass_full_cl_u61_10000"]) {
  const db = new Database(
    `${process.env.FTS5BENCH_DIR ?? "/tmp/fts5bench/db"}/${f}.db`,
    { readonly: true },
  );
  db.run("create virtual table temp.v using fts5vocab(main, f, row)");
  const r = db
    .query("select count(*) terms, sum(doc) pairs, sum(cnt) tokens from temp.v")
    .get() as any;
  const rows = (db.query("select count(*) c from f_docsize").get() as any).c;
  const data = (
    db.query("select sum(length(block)) b from f_data").get() as any
  ).b;
  console.log(
    f,
    JSON.stringify({
      ...r,
      rows,
      dataBlobBytes: data,
      bytesPerToken: (data / r.tokens).toFixed(3),
      bytesPerPair: (data / r.pairs).toFixed(3),
    }),
  );
}
