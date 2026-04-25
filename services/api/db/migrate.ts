import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./client";
import { migrationsFolder } from "./migration-journal";

async function main() {
  await migrate(db, { migrationsFolder });
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
