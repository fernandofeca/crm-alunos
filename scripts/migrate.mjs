import pg from "pg";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL não definida, pulando migration.");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sql = readFileSync(
  join(__dirname, "../prisma/migrations/20260421000000_init/migration.sql"),
  "utf8"
);

try {
  await pool.query(sql);
  console.log("✓ Migration concluída com sucesso");
} catch (e) {
  if (e.code === "42P07") {
    console.log("✓ Tabelas já existem, pulando migration");
  } else {
    console.error("Erro na migration:", e.message);
    process.exit(1);
  }
} finally {
  await pool.end();
}
