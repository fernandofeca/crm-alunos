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

const migrations = [
  "../prisma/migrations/20260421000000_init/migration.sql",
  "../prisma/migrations/20260421000001_plano_estudo/migration.sql",
  "../prisma/migrations/20260421000002_agenda_tarefas/migration.sql",
  "../prisma/migrations/20260421000003_tarefa_responsavel/migration.sql",
  "../prisma/migrations/20260422000000_evento_external_uid/migration.sql",
  "../prisma/migrations/20260422000001_user_google_token/migration.sql",
  "../prisma/migrations/20260422000002_user_permissoes/migration.sql",
  "../prisma/migrations/20260422000003_aluno_dias_atraso/migration.sql",
  "../prisma/migrations/20260422000004_aluno_taxa_acertos/migration.sql",
  "../prisma/migrations/20260422000005_aluno_tutory_created_at/migration.sql",
  "../prisma/migrations/20260422000006_aluno_acompanhar_data_inicio/migration.sql",
  "../prisma/migrations/20260422000007_aluno_tutory_id/migration.sql",
  "../prisma/migrations/20260422000008_aluno_ultimo_contato/migration.sql",
];

for (const file of migrations) {
  const sql = readFileSync(join(__dirname, file), "utf8");
  try {
    await pool.query(sql);
    console.log(`✓ ${file} concluída`);
  } catch (e) {
    if (e.code === "42P07") {
      console.log(`✓ ${file} já aplicada (tabelas existem)`);
    } else {
      console.error(`Erro em ${file}:`, e.message);
      process.exit(1);
    }
  }
}

await pool.end();
console.log("✓ Todas as migrations concluídas");
